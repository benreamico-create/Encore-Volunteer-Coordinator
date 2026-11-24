import { Router } from "express";
import { Readable } from "node:stream";
import {
  CreateMapItemBody, CreateMapItemResponse, DeleteMapItemResponse, GetEventMapResponse, GetVolunteerMapResponse,
  RequestMapUploadUrlBody, RequestMapUploadUrlResponse, SaveEventMapBody, UpdateMapSharingBody,
  SaveEventMapResponse, UpdateMapItemBody, UpdateMapItemResponse, UpdateMapSharingResponse,
} from "@workspace/api-zod";
import { HttpError, id, one, required, rows } from "../lib/store";
import { ownedEvent, wire } from "../lib/events";
import { rateLimit, userId } from "../lib/security";
import { ObjectStorageService } from "../lib/objectStorage";
import { publicEvent } from "./public";

const router = Router();
const storage = new ObjectStorageService();
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg"]);
const imageUrl = (eventId: number) => `/api/events/${eventId}/map/image`;

async function mapBundle(eventId: number) {
  const map = await one("SELECT * FROM maps WHERE event_id=$1", [eventId]);
  const items = map ? await rows("SELECT * FROM map_items WHERE map_id=$1 ORDER BY sort_order,id", [map.id]) : [];
  const event = await one("SELECT map_shared FROM events WHERE id=$1", [eventId]);
  return GetEventMapResponse.parse(wire({
    map: map ? {
      id: map.id, event_id: eventId, source: map.source,
      image_name: map.image_name ?? null, image_mime: map.image_mime ?? null,
      image_width: map.image_width ?? null, image_height: map.image_height ?? null,
      image_url: map.image_path ? imageUrl(eventId) : null,
    } : null,
    items, map_shared: !!event?.map_shared,
  }));
}

function validateGeometry(item: Record<string, unknown>) {
  const x = Number(item.x_pct), y = Number(item.y_pct), w = Number(item.w_pct), h = Number(item.h_pct);
  if (x + w > 100 || y + h > 100) throw new HttpError(400, "Keep the item inside the map.");
}
async function validateRole(eventId: number, kind: string, roleId: number | null | undefined) {
  if (kind !== "station" && roleId != null) throw new HttpError(400, "Only a station can be linked to a volunteer role.");
  if (roleId != null) required(await one("SELECT id FROM roles WHERE id=$1 AND event_id=$2", [roleId, eventId]), "That role is not part of this event.");
}
async function validateResource(eventId:number,kind:string,resourceId:number|null|undefined) {
  if(kind!=="booth"&&resourceId!=null) throw new HttpError(400,"Only a booth can use a vendor resource.");
  if(resourceId!=null) required(await one("SELECT id FROM resources WHERE id=$1 AND event_id=$2 AND kind='vendor'",[resourceId,eventId]),"That vendor resource is not part of this event.");
}
function cleanItem(data: Record<string, any>) {
  return {
    kind: data.kind, label: data.label.trim(),
    x_pct: data.x_pct, y_pct: data.y_pct, w_pct: data.w_pct, h_pct: data.h_pct,
    vendor_name: data.kind === "booth" ? (data.vendor_name?.trim() || null) : null,
    needs_text: data.kind === "booth" ? (data.needs_text?.trim() || null) : null,
    role_id: data.kind === "station" ? (data.role_id ?? null) : null,
    resource_id: data.kind === "booth" ? (data.resource_id ?? null) : null,
  };
}

router.get("/events/:id/map", async (req, res) => {
  const eventId = id(req.params.id);
  await ownedEvent(userId(req), eventId);
  res.json(await mapBundle(eventId));
});

router.post("/events/:id/map/upload-url", async (req, res) => {
  const uid = userId(req), eventId = id(req.params.id);
  await ownedEvent(uid, eventId);
  const data = RequestMapUploadUrlBody.parse(req.body);
  const extOk = data.contentType === "image/png"
    ? /\.png$/i.test(data.name)
    : /\.(jpe?g)$/i.test(data.name);
  if (!IMAGE_TYPES.has(data.contentType) || data.size > MAX_IMAGE_BYTES || !extOk) {
    throw new HttpError(400, "Choose a PNG or JPG image no larger than 5 MB.");
  }
  const uploadURL = await storage.getObjectEntityUploadURL();
  const objectPath = storage.normalizeObjectEntityPath(uploadURL);
  await one(
    "INSERT INTO map_image_uploads(object_path,event_id,owner_id,file_name,content_type,size_bytes) VALUES($1,$2,$3,$4,$5,$6)",
    [objectPath, eventId, uid, data.name.slice(0, 255), data.contentType, data.size],
  );
  res.json(RequestMapUploadUrlResponse.parse({ uploadURL, objectPath }));
});

router.put("/events/:id/map", async (req, res) => {
  const uid = userId(req), eventId = id(req.params.id), data = SaveEventMapBody.parse(req.body);
  await ownedEvent(uid, eventId);
  const previousMap = await one("SELECT image_path FROM maps WHERE event_id=$1", [eventId]);
  let imagePath: string | null = null, imageName: string | null = null, mime: string | null = null;
  if (data.source === "upload") {
    if (!data.objectPath || !data.image_width || !data.image_height) throw new HttpError(400, "Upload the PNG or JPG before saving the map.");
    const intent = required(await one(
      "SELECT * FROM map_image_uploads WHERE object_path=$1 AND event_id=$2 AND owner_id=$3",
      [data.objectPath, eventId, uid],
    ), "That uploaded image is not available for this event.");
    let validationStage = "image download";
    try {
      const response = await storage.downloadObjectEntity(data.objectPath);
      if (!response.ok || !response.body) throw new HttpError(400, "The uploaded image could not be opened. Please upload it again.");
      const headerSize = Number(response.headers.get("content-length"));
      if (Number.isFinite(headerSize) && headerSize > MAX_IMAGE_BYTES) throw new HttpError(400, "Choose a PNG or JPG image no larger than 5 MB.");
      const contentType = response.headers.get("content-type")?.split(";")[0];
      const bytes = Buffer.from(await response.arrayBuffer());
      const actualSize = bytes.length;
      if (actualSize !== Number(intent.size_bytes) || actualSize > MAX_IMAGE_BYTES || contentType !== intent.content_type) {
        throw new HttpError(400, "The uploaded image did not match the selected PNG or JPG file.");
      }
      validationStage = "file signature";
      const signature = bytes.subarray(0, 8);
      const validPng = intent.content_type === "image/png" && signature.length >= 8 &&
        signature.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      const validJpeg = intent.content_type === "image/jpeg" && signature.length >= 3 &&
        signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff;
      if (!validPng && !validJpeg) throw new HttpError(400, "That file is not a valid PNG or JPG image.");
    } catch (error) {
      if (error instanceof HttpError) throw error;
      req.log.error({ stage: validationStage, errorName: error instanceof Error ? error.name : "unknown", code: (error as { code?: unknown })?.code }, "Map image upload validation failed");
      throw error;
    }
    imagePath = data.objectPath;
    imageName = intent.file_name;
    mime = intent.content_type;
    await one("DELETE FROM map_image_uploads WHERE object_path=$1", [data.objectPath]);
  } else if (data.objectPath) {
    throw new HttpError(400, "A blank grid does not use an uploaded image.");
  }

  await one(
    `INSERT INTO maps(event_id,source,image_path,image_name,image_mime,image_width,image_height)
     VALUES($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT(event_id) DO UPDATE SET source=EXCLUDED.source,image_path=EXCLUDED.image_path,
     image_name=EXCLUDED.image_name,image_mime=EXCLUDED.image_mime,image_width=EXCLUDED.image_width,image_height=EXCLUDED.image_height
     RETURNING id`,
    [eventId, data.source, imagePath, imageName, mime, data.source === "upload" ? data.image_width : null, data.source === "upload" ? data.image_height : null],
  );
  if (previousMap?.image_path && previousMap.image_path !== imagePath) {
    const stillUsed = await one("SELECT count(*)::int AS n FROM maps WHERE image_path=$1", [previousMap.image_path]);
    if (Number(stillUsed?.n ?? 0) === 0) {
      try { await storage.deleteObjectEntity(previousMap.image_path); }
      catch (error) { req.log.warn({ err: error }, "Could not remove replaced map image"); }
    }
  }
  res.json(SaveEventMapResponse.parse(await mapBundle(eventId)));
});

router.post("/events/:id/map/items", async (req, res) => {
  const eventId = id(req.params.id), data = CreateMapItemBody.parse(req.body);
  await ownedEvent(userId(req), eventId);
  const map = required(await one("SELECT id FROM maps WHERE event_id=$1", [eventId]), "Create a map before placing items.");
  const item = cleanItem(data);
  validateGeometry(item);
  await validateRole(eventId, item.kind, item.role_id);
  await validateResource(eventId,item.kind,item.resource_id);
  const order = await one("SELECT coalesce(max(sort_order),0)+1 AS n FROM map_items WHERE map_id=$1", [map.id]);
  const saved = await one(
    `INSERT INTO map_items(map_id,kind,label,x_pct,y_pct,w_pct,h_pct,vendor_name,needs_text,role_id,sort_order,resource_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [map.id, item.kind, item.label, item.x_pct, item.y_pct, item.w_pct, item.h_pct, item.vendor_name, item.needs_text, item.role_id, order!.n,item.resource_id],
  );
  res.json(CreateMapItemResponse.parse(wire(saved)));
});

router.patch("/events/:id/map/items/:itemId", async (req, res) => {
  const eventId = id(req.params.id), itemId = id(req.params.itemId), data = UpdateMapItemBody.parse(req.body);
  await ownedEvent(userId(req), eventId);
  const map = required(await one("SELECT id FROM maps WHERE event_id=$1", [eventId]));
  const existing = required(await one("SELECT * FROM map_items WHERE id=$1 AND map_id=$2", [itemId, map.id]), "Map item not found.");
  const merged = cleanItem({ ...existing, ...data });
  validateGeometry(merged);
  await validateRole(eventId, merged.kind, merged.role_id);
  await validateResource(eventId,merged.kind,merged.resource_id);
  const columns: Record<string, unknown> = merged;
  const keys = Object.keys(data).filter((key) => ["kind", "label", "x_pct", "y_pct", "w_pct", "h_pct", "vendor_name", "needs_text", "role_id","resource_id"].includes(key));
  // Kind-dependent fields must be reset when an item changes type.
  if (data.kind !== undefined) keys.push("vendor_name", "needs_text", "role_id","resource_id");
  const uniqueKeys = [...new Set(keys)];
  const params: unknown[] = [itemId, map.id];
  const set = uniqueKeys.map((key) => { params.push(columns[key]); return `${key}=$${params.length}`; }).join(",");
  const updated = uniqueKeys.length
    ? await one(`UPDATE map_items SET ${set} WHERE id=$1 AND map_id=$2 RETURNING *`, params)
    : existing;
  res.json(UpdateMapItemResponse.parse(wire(updated)));
});

router.delete("/events/:id/map/items/:itemId", async (req, res) => {
  const eventId = id(req.params.id), itemId = id(req.params.itemId);
  await ownedEvent(userId(req), eventId);
  const map = required(await one("SELECT id FROM maps WHERE event_id=$1", [eventId]));
  required(await one("DELETE FROM map_items WHERE id=$1 AND map_id=$2 RETURNING id", [itemId, map.id]), "Map item not found.");
  res.json(DeleteMapItemResponse.parse({ ok: true }));
});

router.patch("/events/:id/map-sharing", async (req, res) => {
  const eventId = id(req.params.id), data = UpdateMapSharingBody.parse(req.body);
  await ownedEvent(userId(req), eventId);
  if (data.map_shared) required(await one("SELECT id FROM maps WHERE event_id=$1", [eventId]), "Create a map before sharing it.");
  await one("UPDATE events SET map_shared=$1,updated_at=now() WHERE id=$2", [data.map_shared, eventId]);
  res.json(UpdateMapSharingResponse.parse({ ok: true }));
});

async function sendImage(objectPath: string, res: import("express").Response) {
  const response = await storage.downloadObjectEntity(objectPath);
  if (!response.ok) {
    if (response.status === 404) throw new HttpError(404, "Map image not found.");
    throw new HttpError(502, "The map image could not be loaded right now.");
  }
  res.status(response.status);
  res.setHeader("Content-Type", response.headers.get("content-type") || "application/octet-stream");
  if (response.headers.has("content-length")) res.setHeader("Content-Length", response.headers.get("content-length")!);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (response.body) Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
  else res.end();
}
router.get("/events/:id/map/image", async (req, res) => {
  const eventId = id(req.params.id);
  await ownedEvent(userId(req), eventId);
  const map = required(await one("SELECT image_path FROM maps WHERE event_id=$1", [eventId]));
  if (!map.image_path) throw new HttpError(404, "This map uses the blank grid.");
  await sendImage(map.image_path, res);
});

router.get("/public/v/:token/map", async (req, res) => {
  await rateLimit(req, "public-read", 1000);
  const volunteer = required(await one("SELECT * FROM volunteers WHERE token=$1 AND status='confirmed'", [String(req.params.token)]), "This private link was not found.");
  const event = required(await one("SELECT * FROM events WHERE id=$1", [volunteer.event_id]));
  const role = required(await one(
    "SELECT r.*,(SELECT count(*)::int FROM volunteers v WHERE v.role_id=r.id AND v.status='confirmed') AS filled FROM roles r WHERE r.id=$1 AND r.event_id=$2",
    [volunteer.role_id, event.id],
  ));
  const map = await one("SELECT * FROM maps WHERE event_id=$1", [event.id]);
  const station = map && event.map_shared
    ? await one("SELECT * FROM map_items WHERE map_id=$1 AND kind='station' AND role_id=$2 ORDER BY sort_order,id LIMIT 1", [map.id, role.id])
    : undefined;
  const available = !!(map && event.map_shared && station);
  const items = available ? await rows("SELECT * FROM map_items WHERE map_id=$1 ORDER BY sort_order,id", [map.id]) : [];
  const announcement = await one(
    "SELECT id,body,created_at FROM announcements WHERE event_id=$1 ORDER BY id DESC LIMIT 1",
    [event.id],
  );
  const data = {
    available, event: publicEvent(event, true), role, announcement: announcement ?? null,
    map: available ? {
      id: map.id, event_id: event.id, source: map.source,
      image_name: map.image_name ?? null, image_mime: map.image_mime ?? null,
      image_width: map.image_width ?? null, image_height: map.image_height ?? null,
      image_url: map.image_path ? `/api/public/v/${encodeURIComponent(String(req.params.token))}/map/image` : null,
    } : null,
    items, own_station_id: station?.id ?? null,
  };
  res.json(GetVolunteerMapResponse.parse(wire(data)));
});
router.get("/public/v/:token/map/image", async (req, res) => {
  await rateLimit(req, "public-read", 1000);
  const volunteer = required(await one("SELECT * FROM volunteers WHERE token=$1 AND status='confirmed'", [String(req.params.token)]), "This private link was not found.");
  const event = required(await one("SELECT * FROM events WHERE id=$1 AND map_shared=true", [volunteer.event_id]), "The organizer has not shared a map yet.");
  const station = await one(
    `SELECT m.image_path FROM maps m JOIN map_items i ON i.map_id=m.id
     WHERE m.event_id=$1 AND i.kind='station' AND i.role_id=$2 ORDER BY i.sort_order,i.id LIMIT 1`,
    [event.id, volunteer.role_id],
  );
  if (!station?.image_path) throw new HttpError(404, "The organizer has not shared a map yet.");
  await sendImage(station.image_path, res);
});

export default router;
