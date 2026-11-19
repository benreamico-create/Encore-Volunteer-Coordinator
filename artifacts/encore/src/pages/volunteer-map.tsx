import { useState, useRef, type TouchEvent as ReactTouchEvent } from "react";
import { useParams, Link } from "wouter";
import { useGetVolunteerMap, getGetVolunteerMapQueryKey } from "@workspace/api-client-react";
import { PublicFrame, PublicMessage } from "@/components/public-frame";
import { Icon, Skel } from "@/components/brand";
import { errorMessage, fmtDate, fmtTime } from "@/lib/encore";

const clamp = (n: number) => Math.max(60, Math.min(220, n));

export default function VolunteerMapPage() {
  const { token = "" } = useParams<{ token: string }>();
  const q = useGetVolunteerMap(token, { query: { enabled: !!token, queryKey: getGetVolunteerMapQueryKey(token), retry: false } });
  const [zoom, setZoom] = useState(100);
  const distance = useRef<number | null>(null);
  const touchStart = (e: ReactTouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2) distance.current = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
  };
  const touchMove = (e: ReactTouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 2 || !distance.current) return;
    e.preventDefault();
    const next = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    setZoom((z) => clamp(z + (next > distance.current! ? 8 : -8)));
    distance.current = next;
  };
  if (q.isLoading) return <PublicFrame label="Your post"><div data-testid="status-loading-volunteer-map"><Skel className="h-10 w-3/4 mb-3" /><Skel className="h-4 w-1/2 mb-6" /><Skel className="h-80 !rounded-2xl" /></div></PublicFrame>;
  if (q.isError || !q.data) return <PublicFrame label="Your post"><PublicMessage title="The map is unavailable" body={errorMessage(q.error, "This map could not be opened. Go back to your shift and contact the organizers if you still need help.")} /><Link href={`/v/${token}`} className="btn btn-secondary w-full mt-4" data-testid="link-back-shift"><Icon name="arrow" size={15} className="rotate-180" /> Back to my shift</Link></PublicFrame>;
  const data = q.data;
  const own = data.items.find((item) => item.id === data.own_station_id);
  if (!data.available || !data.map || !own) return <PublicFrame label="Your post"><PublicMessage title="Your map is not ready yet" body="The organizers have not shared a map with your post on it. Check back with them for where to meet." /><Link href={`/v/${token}`} className="btn btn-secondary w-full mt-4" data-testid="link-back-shift"><Icon name="arrow" size={15} className="rotate-180" /> Back to my shift</Link></PublicFrame>;
  const ratio = data.map.image_width && data.map.image_height ? data.map.image_width / data.map.image_height : 1.45;
  return (
    <PublicFrame label="Your post">
      <Link href={`/v/${token}`} className="inline-flex items-center gap-2 text-[13px] font-semibold text-muted-ink mb-4" data-testid="link-back-shift"><Icon name="arrow" size={15} className="rotate-180" /> Back to my shift</Link>
      <div className="mono-label mb-1">Your post</div>
      <h1 className="font-display text-[32px] leading-tight rise" data-testid="text-own-station">{data.role.name}</h1>
      <p className="text-[14px] text-muted-ink mt-2">{own.label} · {fmtDate(data.event.starts_at, data.event.timezone)} · {fmtTime(data.event.starts_at, data.event.timezone)}{data.event.place_text ? ` · ${data.event.place_text}` : ""}</p>
      <section className="glass !p-3 mt-5" data-testid="panel-volunteer-map">
        <div className="flex items-center justify-between gap-3 px-1 pb-3">
          <span className="mono-label">Venue map</span>
          <div className="flex items-center gap-1">
            <button className="icon-btn !w-9 !h-9 text-xl" aria-label="Zoom out" onClick={() => setZoom((z) => clamp(z - 10))} data-testid="button-map-zoom-out">−</button>
            <span className="font-mono-ui text-[11px] min-w-10 text-center" data-testid="text-map-zoom">{zoom}%</span>
            <button className="icon-btn !w-9 !h-9" aria-label="Zoom in" onClick={() => setZoom((z) => clamp(z + 10))} data-testid="button-map-zoom-in"><Icon name="plus" size={16} /></button>
          </div>
        </div>
        <div className="blueprint-viewport volunteer-map-viewport" onTouchStart={touchStart} onTouchMove={touchMove} onTouchEnd={() => { distance.current = null; }} data-testid="volunteer-map-viewport">
          <div className="blueprint-stage volunteer-map-stage" style={{ aspectRatio: String(ratio), backgroundImage: data.map.image_url ? `url("${data.map.image_url}")` : undefined, backgroundSize: "100% 100%", transform: `scale(${zoom / 100})` }}>
            {data.items.map((item) => {
              const isMine = item.id === data.own_station_id;
              return <div key={item.id} className={`blueprint-item map-${item.kind} volunteer-map-item ${isMine ? "is-own-post" : "is-dimmed"}`} style={{ left: `${item.x_pct}%`, top: `${item.y_pct}%`, width: `${item.w_pct}%`, height: `${item.h_pct}%` }} data-testid={isMine ? "map-item-own-post" : `map-item-other-${item.id}`}><span className="truncate">{item.kind === "booth" && item.vendor_name ? item.vendor_name : item.label}</span>{isMine && <span className="your-post-pill">Your post</span>}</div>;
            })}
            {!data.map.image_url && <div className="map-grid-hint" aria-hidden="true">Venue layout</div>}
          </div>
        </div>
        <p className="text-[12px] text-muted-ink px-1 pt-3">Pinch to zoom or use the controls above.</p>
      </section>
      <div className="mt-4"><Link href={`/v/${token}`} className="btn btn-primary w-full" data-testid="button-back-shift"><Icon name="arrow" size={15} className="rotate-180" /> Back to my shift</Link></div>
    </PublicFrame>
  );
}
