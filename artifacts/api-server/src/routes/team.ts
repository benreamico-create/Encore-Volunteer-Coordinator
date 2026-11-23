import { Router } from "express";
import {
  CreateEventMessageBody,
  CreateEventAnnouncementBody,
  CreateEventAnnouncementResponse,
  DraftAnnouncementBody,
  DraftAnnouncementResponse,
  GetEventAnnouncementResponse,
  ListEventMessagesResponse,
} from "@workspace/api-zod";
import { z } from "zod";
import { draft } from "../lib/ai";
import { bundle, ownedEvent } from "../lib/events";
import { rateLimitByUser, userId } from "../lib/security";
import { HttpError, id, one, required, rows } from "../lib/store";

const router = Router();
const messageLimit = 100;

function normalizedText(value: string, max: number, label: string) {
  const body = value.trim();
  if (!body) throw new HttpError(400, `Write a ${label} first.`);
  if (body.length > max) throw new HttpError(400, `Keep the ${label} under ${max} characters.`);
  return body;
}

function messageRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    event_id: row.event_id,
    user_id: row.user_id,
    user_name: row.user_name,
    body: row.deleted_at ? "" : row.body,
    created_at: row.created_at,
    deleted_at: row.deleted_at,
  };
}

router.get("/events/:id/messages", async (req, res): Promise<void> => {
  const uid = userId(req);
  const eventId = id(req.params.id);
  await ownedEvent(uid, eventId);
  const parsedAfter = z.coerce.number().int().min(0).safeParse(req.query.after ?? 0);
  if (!parsedAfter.success) throw new HttpError(400, "Invalid message cursor.");
  const after = parsedAfter.data;
  const found = after > 0
    ? await rows(
      `SELECT m.*,u.name AS user_name FROM messages m JOIN users u ON u.id=m.user_id
       WHERE m.event_id=$1 AND (
         m.id>$2 OR (m.deleted_at IS NOT NULL AND m.deleted_at>now()-interval '7 days')
       ) ORDER BY m.id LIMIT $3`,
      [eventId, after, messageLimit],
    )
    : await rows(
      `SELECT * FROM (
         SELECT m.*,u.name AS user_name FROM messages m JOIN users u ON u.id=m.user_id
         WHERE m.event_id=$1 ORDER BY m.id DESC LIMIT $2
       ) latest ORDER BY id`,
      [eventId, messageLimit],
    );
  res.json(ListEventMessagesResponse.parse(found.map(messageRow)));
});

router.post("/events/:id/messages", async (req, res): Promise<void> => {
  const uid = userId(req);
  const eventId = id(req.params.id);
  await ownedEvent(uid, eventId);
  const parsed = CreateEventMessageBody.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Write a message of up to 2,000 characters.");
  const body = normalizedText(parsed.data.body, 2000, "message");
  await rateLimitByUser(uid, "event-message", 60);
  const created = required(await one(
    `INSERT INTO messages(event_id,user_id,body) VALUES($1,$2,$3)
     RETURNING id,event_id,user_id,body,created_at,deleted_at`,
    [eventId, uid, body],
  ));
  const user = required(await one("SELECT name FROM users WHERE id=$1", [uid]));
  res.status(201).json({
    ...ListEventMessagesResponse.element.parse(messageRow({ ...created, user_name: user.name })),
  });
});

router.delete("/events/:id/messages/:itemId", async (req, res): Promise<void> => {
  const uid = userId(req);
  const eventId = id(req.params.id);
  await ownedEvent(uid, eventId);
  const deleted = required(await one(
    `UPDATE messages SET deleted_at=now()
     WHERE id=$1 AND event_id=$2 AND user_id=$3 AND deleted_at IS NULL
     RETURNING id,event_id,user_id,body,created_at,deleted_at`,
    [id(req.params.itemId), eventId, uid],
  ), "Message not found.");
  const user = required(await one("SELECT name FROM users WHERE id=$1", [uid]));
  res.json(ListEventMessagesResponse.element.parse(messageRow({ ...deleted, user_name: user.name })));
});

router.get("/events/:id/announcements", async (req, res): Promise<void> => {
  const uid = userId(req);
  const eventId = id(req.params.id);
  await ownedEvent(uid, eventId);
  const announcement = await one(
    "SELECT * FROM announcements WHERE event_id=$1 ORDER BY id DESC LIMIT 1",
    [eventId],
  );
  res.json(GetEventAnnouncementResponse.parse(announcement ?? null));
});

router.post("/events/:id/announcements", async (req, res): Promise<void> => {
  const uid = userId(req);
  const eventId = id(req.params.id);
  await ownedEvent(uid, eventId);
  const parsed = CreateEventAnnouncementBody.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Write an announcement of up to 500 characters.");
  const body = normalizedText(parsed.data.body, 500, "announcement");
  const created = await one(
    "INSERT INTO announcements(event_id,user_id,body) VALUES($1,$2,$3) RETURNING *",
    [eventId, uid, body],
  );
  res.status(201).json(CreateEventAnnouncementResponse.parse(created));
});

router.post("/ai/announcement", async (req, res): Promise<void> => {
  const uid = userId(req);
  const parsed = DraftAnnouncementBody.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Choose an event first.");
  const eventId = id(parsed.data.event_id);
  const snapshot = await bundle(uid, eventId);
  const event = snapshot.event;
  const date = new Intl.DateTimeFormat("en", {
    timeZone: event.timezone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(event.starts_at));
  const time = new Intl.DateTimeFormat("en", {
    timeZone: event.timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(event.starts_at));
  const organizer = snapshot.organizers[0]?.name || "The organizers";
  const template = `Hi team, ${event.name} is on ${date} at ${time}${event.place_text ? ` at ${event.place_text.slice(0, 100)}` : ""}. Please arrive 15 minutes early and check your private page for shift details. Thank you for helping. — ${organizer}`.slice(0, 500);
  const responseSchema = DraftAnnouncementResponse.omit({ notice: true, ai_remaining: true });
  const result = await draft(
    uid,
    "volunteer event announcement",
    {
      event: { name: event.name, date, time, place: event.place_text, city: event.city },
      roles: snapshot.roles.map((role: Record<string, unknown>) => role.name),
      task_count: snapshot.tasks.length,
    },
    "A warm, concise volunteer announcement. Never include private links or invent event details. Return {body:string}; body must be at most 500 characters.",
    responseSchema,
    responseSchema.parse({ body: template }),
  );
  res.json(result);
});

export default router;
