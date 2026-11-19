import { useRef, useState, useMemo, useEffect, type PointerEvent as ReactPointerEvent, type TouchEvent as ReactTouchEvent } from "react";
import { useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetEventMapQueryKey, useGetEventMap, useSaveEventMap, useRequestMapUploadUrl,
  useCreateMapItem, useUpdateMapItem, useDeleteMapItem, useUpdateMapSharing,
  type MapItem, type MapItemInput,
} from "@workspace/api-client-react";
import { Shell, PageHeader } from "@/components/shell";
import { ErrorPanel, Icon, Skel } from "@/components/brand";
import { Switch } from "@/components/ui/switch";
import { useEventBundle } from "@/lib/use-event";
import { errorMessage, errorStatus, fmtInTz } from "@/lib/encore";
import { useToast } from "@/hooks/use-toast";

type Tool = "select" | MapItem["kind"];
type ToolIcon = "plan" | "map" | "pin" | "tag" | "arrow";
type Gesture = { type: "move" | "resize" | "draw" | "pan"; pointerId: number; item?: MapItem; x: number; y: number; startX: number; startY: number; originX: number; originY: number; originW: number; originH: number };
const tools: { id: Tool; label: string; icon: ToolIcon }[] = [
  { id: "select", label: "Select", icon: "plan" }, { id: "booth", label: "Booth", icon: "map" },
  { id: "station", label: "Station", icon: "pin" }, { id: "zone", label: "Zone", icon: "tag" },
  { id: "stage", label: "Stage", icon: "plan" }, { id: "entrance", label: "Entrance", icon: "arrow" },
];

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export default function BlueprintPage() {
  const { id: rawId = "" } = useParams<{ id: string }>();
  const id = Number(rawId);
  const qc = useQueryClient();
  const { toast } = useToast();
  const bundle = useEventBundle(id);
  const mapQuery = useGetEventMap(id, { query: { enabled: !!id, queryKey: getGetEventMapQueryKey(id) } });
  const saveMap = useSaveEventMap();
  const requestUpload = useRequestMapUploadUrl();
  const createItem = useCreateMapItem();
  const updateItem = useUpdateMapItem();
  const deleteItem = useDeleteMapItem();
  const updateSharing = useUpdateMapSharing();
  const stageRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const touchDistance = useRef<number | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [zoom, setZoom] = useState(100);
  const [previewRect, setPreviewRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [detailDraft, setDetailDraft] = useState({ label: "", vendor_name: "", needs_text: "", role_id: "" });
  const [uploading, setUploading] = useState(false);
  const items = mapQuery.data?.items ?? [];
  const selected = items.find((item) => item.id === selectedId) ?? null;
  const roles = bundle.data?.roles ?? [];
  const imageRatio = useMemo(() => {
    const m = mapQuery.data?.map;
    return m?.image_width && m?.image_height ? m.image_width / m.image_height : 1.45;
  }, [mapQuery.data?.map?.image_width, mapQuery.data?.map?.image_height]);
  const key = getGetEventMapQueryKey(id);
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const fail = (title: string) => (e: unknown) => toast({ title, description: errorMessage(e), variant: "destructive" });

  useEffect(() => {
    if (selectedId !== null && !items.some((item) => item.id === selectedId)) setSelectedId(null);
  }, [items, selectedId]);
  useEffect(() => {
    if (selected) setDetailDraft({ label: selected.label, vendor_name: selected.vendor_name ?? "", needs_text: selected.needs_text ?? "", role_id: selected.role_id ? String(selected.role_id) : "" });
  }, [selected?.id]);

  const screenPoint = (clientX: number, clientY: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: clamp((clientX - rect.left) / rect.width * 100, 0, 100), y: clamp((clientY - rect.top) / rect.height * 100, 0, 100) };
  };
  const savePosition = (item: MapItem, rect: { x: number; y: number; w: number; h: number }) => {
    const x = clamp(rect.x, 0, 98), y = clamp(rect.y, 0, 98);
    updateItem.mutate({ id, itemId: item.id, data: { x_pct: Number(x.toFixed(2)), y_pct: Number(y.toFixed(2)), w_pct: Number(clamp(rect.w, 2, 100 - x).toFixed(2)), h_pct: Number(clamp(rect.h, 2, 100 - y).toFixed(2)) } }, { onSuccess: refresh, onError: fail("Could not move item") });
  };
  const create = async (kind: MapItem["kind"], rect = { x: 42, y: 42, w: 16, h: 12 }) => {
    try {
      if (!mapQuery.data?.map) await saveMap.mutateAsync({ id, data: { source: "blank" } });
      const n = items.filter((x) => x.kind === kind).length + 1;
      const input: MapItemInput = {
        kind, label: kind === "booth" ? `Booth ${n}` : kind === "station" ? "Volunteer post" : kind === "zone" ? "New zone" : kind === "stage" ? "Stage" : "Entrance",
        x_pct: Number(clamp(rect.x, 0, 98).toFixed(2)), y_pct: Number(clamp(rect.y, 0, 98).toFixed(2)),
        w_pct: Number(clamp(rect.w, 2, 100 - rect.x).toFixed(2)), h_pct: Number(clamp(rect.h, 2, 100 - rect.y).toFixed(2)),
        vendor_name: null, needs_text: null, role_id: null,
      };
      const item = await createItem.mutateAsync({ id, data: input });
      setTool("select");
      await refresh();
      setSelectedId(item.id);
    } catch (e) { fail("Could not add item")(e); }
  };
  const saveDetails = () => {
    if (!selected) return;
    const patch: Record<string, unknown> = {};
    if (detailDraft.label.trim() && detailDraft.label.trim() !== selected.label) patch.label = detailDraft.label.trim();
    if (selected.kind === "booth") {
      if (detailDraft.vendor_name !== (selected.vendor_name ?? "")) patch.vendor_name = detailDraft.vendor_name.trim() || null;
      if (detailDraft.needs_text !== (selected.needs_text ?? "")) patch.needs_text = detailDraft.needs_text.trim() || null;
    }
    if (selected.kind === "station" && detailDraft.role_id !== String(selected.role_id ?? "")) patch.role_id = detailDraft.role_id ? Number(detailDraft.role_id) : null;
    if (!Object.keys(patch).length) return;
    updateItem.mutate({ id, itemId: selected.id, data: patch }, { onSuccess: refresh, onError: fail("Could not save item") });
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLElement>, item?: MapItem, resize = false) => {
    if (e.button !== 0) return;
    const pt = screenPoint(e.clientX, e.clientY);
    if (tool !== "select" && !item) {
      const kind = tool as MapItem["kind"];
      gesture.current = { type: "draw", pointerId: e.pointerId, x: pt.x, y: pt.y, startX: pt.x, startY: pt.y, originX: pt.x, originY: pt.y, originW: 2, originH: 2 };
      setPreviewRect({ x: pt.x, y: pt.y, w: 2, h: 2 });
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (item) {
      setSelectedId(item.id);
      if (tool !== "select") return;
      gesture.current = { type: resize ? "resize" : "move", pointerId: e.pointerId, item, x: pt.x, y: pt.y, startX: pt.x, startY: pt.y, originX: item.x_pct, originY: item.y_pct, originW: item.w_pct, originH: item.h_pct };
    } else if (tool === "select") {
      setSelectedId(null);
      gesture.current = { type: "pan", pointerId: e.pointerId, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, originX: pan.x, originY: pan.y, originW: 0, originH: 0 };
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    if (g.type === "pan") setPan({ x: g.originX + e.clientX - g.startX, y: g.originY + e.clientY - g.startY });
    else {
      const pt = screenPoint(e.clientX, e.clientY);
      const dx = pt.x - g.startX, dy = pt.y - g.startY;
      if (g.type === "draw") setPreviewRect({ x: Math.min(g.startX, pt.x), y: Math.min(g.startY, pt.y), w: Math.max(2, Math.abs(dx)), h: Math.max(2, Math.abs(dy)) });
      else if (g.item) {
        const x = g.type === "move" ? clamp(g.originX + dx, 0, 98) : g.originX;
        const y = g.type === "move" ? clamp(g.originY + dy, 0, 98) : g.originY;
        const w = g.type === "resize" ? clamp(g.originW + dx, 2, 100 - x) : g.originW;
        const h = g.type === "resize" ? clamp(g.originH + dy, 2, 100 - y) : g.originH;
        setPreviewRect({ x, y, w, h });
      }
    }
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    if (g.type === "draw" && previewRect) void create(tool as MapItem["kind"], previewRect);
    if ((g.type === "move" || g.type === "resize") && g.item && previewRect) savePosition(g.item, previewRect);
    gesture.current = null;
    setPreviewRect(null);
  };
  const handleKeys = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") { setSelectedId(null); return; }
    if ((e.key === "Delete" || e.key === "Backspace") && selected) {
      e.preventDefault();
      if (window.confirm(`Delete “${selected.label}”?`)) deleteItem.mutate({ id, itemId: selected.id }, { onSuccess: () => { setSelectedId(null); refresh(); }, onError: fail("Could not delete item") });
      return;
    }
    if (selected && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
      e.preventDefault();
      const x = clamp(selected.x_pct + (e.key === "ArrowLeft" ? -.5 : e.key === "ArrowRight" ? .5 : 0), 0, 98);
      const y = clamp(selected.y_pct + (e.key === "ArrowUp" ? -.5 : e.key === "ArrowDown" ? .5 : 0), 0, 98);
      updateItem.mutate({ id, itemId: selected.id, data: { x_pct: Number(x.toFixed(2)), y_pct: Number(y.toFixed(2)) } }, { onSuccess: refresh, onError: fail("Could not move item") });
    }
  };
  const uploadImage = async (file?: File) => {
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type) || file.size > 5 * 1024 * 1024) {
      toast({ title: "Choose a PNG or JPG under 5 MB", variant: "destructive" });
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setUploading(true);
    const objectUrl = URL.createObjectURL(file);
    try {
      const dims = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
        image.onerror = () => reject(new Error("This image could not be opened."));
        image.src = objectUrl;
      });
      const upload = await requestUpload.mutateAsync({ id, data: { name: file.name, size: file.size, contentType: file.type as "image/png" | "image/jpeg" } });
      const result = await fetch(upload.uploadURL, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!result.ok) throw new Error("The image upload did not complete. Try again.");
      await saveMap.mutateAsync({ id, data: { source: "upload", objectPath: upload.objectPath, image_width: dims.width, image_height: dims.height } });
      await refresh();
      toast({ title: "Map background updated", description: `${dims.width} × ${dims.height} px · your items are still in place.` });
    } catch (e) { fail("Could not upload map")(e); }
    finally { URL.revokeObjectURL(objectUrl); setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  };
  const zoomBy = (amount: number) => setZoom((z) => clamp(z + amount, 50, 300));
  const handleTouchStart = (e: ReactTouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2) {
      touchDistance.current = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      gesture.current = null;
      setPreviewRect(null);
    }
  };
  const handleTouchMove = (e: ReactTouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 2 || !touchDistance.current) return;
    e.preventDefault();
    const next = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    zoomBy(next > touchDistance.current ? 10 : -10);
    touchDistance.current = next;
  };

  if (bundle.isLoading || mapQuery.isLoading) return <Shell><div data-testid="status-loading-blueprint"><Skel className="h-10 w-56 mb-3" /><Skel className="h-5 w-80 mb-7" /><Skel className="h-[480px] !rounded-2xl" /></div></Shell>;
  if (bundle.isError || !bundle.data || mapQuery.isError) {
    const err = bundle.error ?? mapQuery.error;
    const nf = errorStatus(err) === 404 || errorStatus(err) === 403;
    return <Shell><ErrorPanel title={nf ? "Event not found" : "Blueprint could not load"} message={nf ? "This event does not exist or belongs to someone else." : errorMessage(err)} onRetry={nf ? undefined : () => { void bundle.refetch(); void mapQuery.refetch(); }} /></Shell>;
  }
  const event = bundle.data.event;
  const map = mapQuery.data?.map;

  return (
    <Shell event={{ id, name: event.name }}>
      <PageHeader eyebrow="Venue layout" title="Blueprint" subtitle={`${event.name} · ${mapQuery.data?.items.filter((item) => item.kind === "booth" && !!item.vendor_name).length ?? 0} of ${mapQuery.data?.items.filter((item) => item.kind === "booth").length ?? 0} booths have a vendor · ${mapQuery.data?.items.filter((item) => item.kind === "station").length ?? 0} volunteer posts`} />
      <div className="grid xl:grid-cols-[minmax(0,1fr)_300px] gap-5 items-start" data-testid="blueprint-workspace">
        <section className="glass !p-3 sm:!p-4 min-w-0" data-testid="panel-blueprint-canvas">
          <div className="flex flex-wrap items-center justify-between gap-3 px-1 pb-3">
            <div className="flex items-center gap-2">
              <span className="mono-label">Canvas</span>
              {map?.image_name && <span className="text-[12px] text-muted-ink truncate max-w-40">{map.image_name}</span>}
            </div>
            <div className="flex items-center gap-1">
              <button className="icon-btn text-xl" aria-label="Zoom out" title="Zoom out" onClick={() => zoomBy(-10)} data-testid="button-zoom-out">−</button>
              <span className="font-mono-ui text-[12px] min-w-[48px] text-center" data-testid="text-zoom">{zoom}%</span>
              <button className="icon-btn" aria-label="Zoom in" title="Zoom in" onClick={() => zoomBy(10)} data-testid="button-zoom-in"><Icon name="plus" size={17} /></button>
              <button className="btn btn-secondary btn-sm ml-1" onClick={() => setZoom(100)} data-testid="button-zoom-reset">Reset</button>
            </div>
          </div>
          <div className="blueprint-viewport" data-testid="map-viewport">
            <div
              ref={stageRef}
              className="blueprint-stage"
              role="application"
              aria-label="Event venue map. Use the tool picker to draw items. Select an item and use arrow keys to nudge it."
              tabIndex={0}
              data-testid="blueprint-canvas"
              onPointerDown={(e) => onPointerDown(e)}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onKeyDown={handleKeys}
              onWheel={(e) => { e.preventDefault(); zoomBy(e.deltaY < 0 ? 5 : -5); }}
              onTouchStart={handleTouchStart}
              onTouchMove={handleTouchMove}
              onTouchEnd={() => { touchDistance.current = null; }}
              style={{ aspectRatio: String(imageRatio), backgroundImage: map?.image_url ? `url("${map.image_url}")` : undefined, backgroundSize: "100% 100%", transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom / 100})` }}
            >
              {items.map((item) => {
                const rect = previewRect && selectedId === item.id ? previewRect : previewRect && gesture.current?.item?.id === item.id ? previewRect : null;
                const x = rect?.x ?? item.x_pct, y = rect?.y ?? item.y_pct, w = rect?.w ?? item.w_pct, h = rect?.h ?? item.h_pct;
                return (
                  <div key={item.id} className={`blueprint-item map-${item.kind} ${item.kind === "booth" && !item.vendor_name ? "is-empty-booth" : ""} ${selectedId === item.id ? "is-selected" : ""}`} style={{ left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%` }} onPointerDown={(e) => { e.stopPropagation(); onPointerDown(e, item); }} onFocus={() => setSelectedId(item.id)} tabIndex={0} data-testid={`map-item-${item.id}`} role="button" aria-label={`${item.kind}: ${item.label}`} aria-pressed={selectedId === item.id}>
                    <span className="truncate">{item.kind === "booth" && item.vendor_name ? item.vendor_name : item.label}</span>
                    {selectedId === item.id && <button type="button" className="map-resize-handle" aria-label={`Resize ${item.label}`} onPointerDown={(e) => { e.stopPropagation(); onPointerDown(e, item, true); }} data-testid={`button-resize-${item.id}`} />}
                  </div>
                );
              })}
              {previewRect && gesture.current?.type === "draw" && <div className={`blueprint-item map-${tool}`} style={{ left: `${previewRect.x}%`, top: `${previewRect.y}%`, width: `${previewRect.w}%`, height: `${previewRect.h}%`, pointerEvents: "none" }} />}
              {!map?.image_url && <div className="map-grid-hint" aria-hidden="true">Blank venue grid</div>}
            </div>
          </div>
          <p className="text-[12px] text-muted-ink pt-3 px-1">Drag to draw. Select an item to move or resize. Arrow keys nudge by 0.5%.</p>
        </section>
        <aside className="space-y-4">
          <section className="glass !p-4" aria-label="Map tools">
            <div className="mono-label mb-3">Tools</div>
            <div className="grid grid-cols-3 xl:grid-cols-2 gap-2">
              {tools.map((t) => <button key={t.id} className={`tool-choice ${tool === t.id ? "is-active" : ""}`} onClick={() => setTool(t.id)} aria-pressed={tool === t.id} data-testid={`button-tool-${t.id}`}><Icon name={t.icon} size={16} /><span>{t.label}</span></button>)}
            </div>
            <button className="btn btn-secondary w-full mt-3" onClick={() => void create(tool === "select" ? "booth" : tool as MapItem["kind"])} disabled={tool !== "select" && (createItem.isPending || saveMap.isPending)} data-testid="button-add-item"><Icon name="plus" size={15} /> Add {tool === "select" ? "item" : tool}</button>
          </section>
          <section className="glass !p-4">
            <div className="mono-label mb-3">Background</div>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="sr-only" aria-label="Upload a map image" onChange={(e) => void uploadImage(e.target.files?.[0])} data-testid="input-map-upload" />
            <button className="btn btn-secondary w-full" disabled={uploading} onClick={() => fileRef.current?.click()} data-testid="button-upload-map"><Icon name="arrow" size={15} className="-rotate-90" /> {uploading ? "Uploading…" : map?.image_url ? "Replace image" : "Upload floor plan"}</button>
            <p className="text-[12px] text-muted-ink mt-2">PNG or JPG · up to 5 MB. Replacing the image keeps every item in place.</p>
            {!map && <button className="btn btn-secondary w-full mt-2" onClick={() => { saveMap.mutate({ id, data: { source: "blank" } }, { onSuccess: refresh, onError: fail("Could not start a blank grid") }); }} disabled={saveMap.isPending} data-testid="button-start-blank-grid">Start with a blank grid</button>}
            {map?.image_url && <button className="btn btn-ghost btn-sm mt-2 w-full" onClick={() => { saveMap.mutate({ id, data: { source: "blank" } }, { onSuccess: refresh, onError: fail("Could not replace background") }); }} data-testid="button-use-blank">Use blank grid</button>}
          </section>
          <section className="glass !p-4">
            <div className="flex items-center justify-between gap-3">
              <div><div className="font-semibold text-[14px]">Share with volunteers</div><p className="text-[12px] text-muted-ink mt-0.5">They can see their own post.</p></div>
              <Switch checked={mapQuery.data?.map_shared ?? false} onCheckedChange={(checked) => updateSharing.mutate({ id, data: { map_shared: checked } }, { onSuccess: refresh, onError: fail("Could not update sharing") })} disabled={updateSharing.isPending} data-testid="switch-map-sharing" />
            </div>
          </section>
          {selected && <section className="glass !p-4" data-testid="panel-item-inspector">
            <div className="flex items-start justify-between gap-2 mb-3"><div><div className="mono-label">Selected {selected.kind}</div><h2 className="font-display text-[20px] leading-tight">{selected.label}</h2></div><button className="icon-btn !w-9 !h-9" aria-label="Delete selected item" onClick={() => { if (window.confirm(`Delete “${selected.label}”?`)) deleteItem.mutate({ id, itemId: selected.id }, { onSuccess: () => { setSelectedId(null); refresh(); }, onError: fail("Could not delete item") }); }} data-testid="button-delete-item"><Icon name="trash" size={16} /></button></div>
            <label className="field-label" htmlFor="map-item-label">Label</label>
            <input id="map-item-label" className="field field-compact mb-3" value={detailDraft.label} maxLength={120} onChange={(e) => setDetailDraft((d) => ({ ...d, label: e.target.value }))} data-testid="input-item-label" />
            {selected.kind === "booth" && <>
              <label className="field-label" htmlFor="map-item-vendor">Vendor</label><input id="map-item-vendor" className="field field-compact mb-3" value={detailDraft.vendor_name} maxLength={160} onChange={(e) => setDetailDraft((d) => ({ ...d, vendor_name: e.target.value }))} placeholder="Vendor name" data-testid="input-item-vendor" />
              <label className="field-label" htmlFor="map-item-needs">Needs</label><textarea id="map-item-needs" className="field field-compact" rows={2} value={detailDraft.needs_text} maxLength={1000} onChange={(e) => setDetailDraft((d) => ({ ...d, needs_text: e.target.value }))} placeholder="Power, table, access…" data-testid="input-item-needs" />
            </>}
            {selected.kind === "station" && <><label className="field-label" htmlFor="map-item-role">Volunteer role</label><select id="map-item-role" className="field field-compact" value={detailDraft.role_id} onChange={(e) => setDetailDraft((d) => ({ ...d, role_id: e.target.value }))} data-testid="select-item-role"><option value="">No linked role</option>{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></>}
            <button className="btn btn-primary btn-sm w-full mt-3" onClick={saveDetails} disabled={updateItem.isPending || !detailDraft.label.trim()} data-testid="button-save-item-details">{updateItem.isPending ? "Saving…" : "Save details"}</button>
          </section>}
        </aside>
      </div>
    </Shell>
  );
}
