import { useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useGetVolunteerPage, useTickVolunteerTask, getGetVolunteerPageQueryKey, type VolunteerPage } from "@workspace/api-client-react";
import { PublicFrame, PublicMessage } from "@/components/public-frame";
import { Icon, Skel } from "@/components/brand";
import { copyText, dueLabel, errorMessage, errorStatus, fmtInTz, fmtTime } from "@/lib/encore";
import { useToast } from "@/hooks/use-toast";

function useNow(ms = 30000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

function countdown(startIso: string, now: number) {
  const diff = new Date(startIso).getTime() - now;
  if (diff <= 0) return "Live now";
  const m = Math.round(diff / 60000);
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
  if (d > 0) return `Doors in ${d}d ${h}h`;
  return `Doors in ${h > 0 ? `${h}h ` : ""}${mm}m`;
}

function Checklist({ token, page }: { token: string; page: VolunteerPage }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const tick = useTickVolunteerTask();
  const key = getGetVolunteerPageQueryKey(token);
  const toggle = (taskId: number, done: boolean) => {
    qc.setQueryData<VolunteerPage>(key, (o) => (o ? { ...o, tasks: o.tasks.map((t) => (t.id === taskId ? { ...t, status: done ? "done" : "todo" } : t)) } : o));
    tick.mutate({ token, itemId: taskId, data: { done } }, {
      onSuccess: () => qc.invalidateQueries({ queryKey: key }),
      onError: (e) => { toast({ title: "That tick did not save", description: errorMessage(e), variant: "destructive" }); qc.invalidateQueries({ queryKey: key }); },
    });
  };
  if (!page.tasks.length) return <p className="text-[14px] text-muted-ink">Nothing on your list yet. The organizers may add some before the day.</p>;
  return (
    <ul className="space-y-2">
      {page.tasks.map((t) => {
        const done = t.status === "done";
        return (
          <li key={t.id}>
            <label className="flex items-center gap-3 rounded-[14px] px-3 py-3 cursor-pointer transition-colors hover:bg-white/50" style={{ background: "rgba(255,255,255,0.55)" }} data-testid={`row-check-${t.id}`}>
              <input type="checkbox" className="sr-only" checked={done} onChange={(e) => toggle(t.id, e.target.checked)} data-testid={`checkbox-task-${t.id}`} />
              <span className="w-6 h-6 rounded-full shrink-0 flex items-center justify-center transition-all" style={done ? { background: "#37442E", color: "#fff" } : { border: "2px solid rgba(31,30,29,0.3)" }}>{done && <Icon name="check" size={14} />}</span>
              <span className="flex-1 min-w-0">
                <span className={`text-[15px] font-semibold block ${done ? "line-through text-muted-ink" : ""}`}>{t.title}</span>
                {t.due_date && <span className="text-[12px] text-muted-ink">Due {dueLabel(t.due_date)}</span>}
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

export default function VolunteerPrivatePage() {
  const { token = "" } = useParams<{ token: string }>();
  const { toast } = useToast();
  const now = useNow();
  const q = useGetVolunteerPage(token, { query: { enabled: !!token, queryKey: getGetVolunteerPageQueryKey(token), refetchInterval: 5000, retry: false } });

  if (q.isLoading) return <PublicFrame label="Your page"><div data-testid="status-loading-volunteer"><Skel className="h-12 w-3/4 mb-3" /><Skel className="h-4 w-full mb-6" /><Skel className="h-44 !rounded-2xl" /></div></PublicFrame>;
  if (q.isError || !q.data) {
    const nf = errorStatus(q.error) === 404;
    return <PublicFrame label="Your page"><PublicMessage title={nf ? "This link is not active" : "Could not load your page"} body={nf ? "Your spot may have been removed by the organizers. Reach out to them if that is unexpected." : errorMessage(q.error)} /></PublicFrame>;
  }
  const p = q.data;
  const ev = p.event;
  const day = fmtInTz(ev.starts_at, ev.timezone, { weekday: "short", month: "short", day: "numeric" });
  const url = window.location.href;
  const removed = p.status === "removed" || p.status === "cancelled";

  if (p.event_day && !removed) {
    const doneN = p.tasks.filter((t) => t.status === "done").length;
    return (
      <PublicFrame label={day}>
        <section className="rounded-[20px] p-5 text-[#FEFCF0] rise" style={{ background: "#37442E", boxShadow: "0 14px 34px rgba(55,68,46,0.28)" }} data-testid="card-countdown">
          <div className="font-mono-ui text-[11px] uppercase tracking-[0.16em]" style={{ color: "#D8E3C4" }}>Event day</div>
          <div className="flex items-end justify-between gap-3 mt-1">
            <div className="font-display text-[26px] leading-tight" data-testid="text-countdown">{countdown(ev.starts_at, now)}</div>
            <span className="font-mono-ui text-[12px] rounded-full px-3 py-1.5" style={{ background: "rgba(255,255,255,0.18)" }}>{doneN} OF {p.tasks.length}</span>
          </div>
          <div className="text-[14px] mt-2" style={{ color: "#E4E8DA" }}>{p.name} · {p.role.name} · {fmtTime(ev.starts_at, ev.timezone)}{ev.place_text ? ` · ${ev.place_text}` : ""}</div>
        </section>
        <section className="glass mt-4 rise" style={{ animationDelay: "80ms" }}>
          <h2 className="font-display text-[20px] mb-3">Your checklist</h2>
          <Checklist token={token} page={p} />
        </section>
        {p.has_map_post && <Link href={`/v/${token}/map`} className="btn btn-secondary w-full mt-4" data-testid="link-volunteer-map"><Icon name="pin" size={15} /> See my post on the map</Link>}
        {ev.event_day_notes && (
          <section className="glass mt-4 rise" style={{ animationDelay: "140ms" }} data-testid="panel-day-notes">
            <div className="mono-label mb-2">Notes from the organizers</div>
            <p className="text-[15px] whitespace-pre-wrap">{ev.event_day_notes}</p>
          </section>
        )}
        {ev.day_of_contact_text && (
          <section className="ai-glass mt-4 flex gap-3 items-start" data-testid="panel-day-contact">
            <Icon name="people" size={18} className="mt-0.5 shrink-0" />
            <p className="text-[15px] font-semibold">{ev.day_of_contact_text}</p>
          </section>
        )}
      </PublicFrame>
    );
  }

  return (
    <PublicFrame label="Confirmed">
      {removed ? (
        <PublicMessage title="Your spot was released" body="The organizers removed this sign-up. If that is unexpected, reach out to them directly." />
      ) : (
        <>
          <h1 className="font-display text-[34px] sm:text-[42px] leading-[1.05] rise" data-testid="text-you-are-in">You are in, {p.name}.</h1>
          <p className="text-[16px] text-muted-ink mt-3 rise">Your spot is saved. The organizers can see it right away.</p>
          <section className="glass mt-6 rise" style={{ animationDelay: "80ms" }}>
            <div className="mono-label mb-2">Your shift</div>
            <div className="font-display text-[26px] leading-tight" data-testid="text-role">{p.role.name}</div>
            {p.role.instruction && <p className="text-[14px] text-muted-ink mt-1">{p.role.instruction}</p>}
            <div className="space-y-2 mt-4 text-[15px]">
              <div className="flex items-center gap-2.5"><Icon name="calendar" size={17} /> {ev.name} · {day}</div>
              <div className="flex items-center gap-2.5"><Icon name="clock" size={17} /> {fmtTime(ev.starts_at, ev.timezone)}</div>
              {(ev.place_text || ev.city) && <div className="flex items-center gap-2.5"><Icon name="pin" size={17} /> {[ev.place_text, ev.city].filter(Boolean).join(", ")}</div>}
            </div>
          </section>
          {p.has_map_post && <Link href={`/v/${token}/map`} className="btn btn-secondary w-full mt-4 rise" data-testid="link-volunteer-map"><Icon name="pin" size={15} /> See my post on the map</Link>}
          <section className="ai-glass mt-4 rise" style={{ animationDelay: "140ms" }}>
            <p className="font-semibold">Bookmark this page. It is your link for the day.</p>
            <p className="text-[13px] mt-1">On the event day it turns into your checklist.</p>
            <button className="btn btn-sm mt-3" style={{ background: "rgba(255,255,255,0.6)", border: "1px solid rgba(201,168,76,0.9)", color: "#3A3200" }} onClick={async () => toast((await copyText(url)) ? { title: "Link copied" } : { title: "Could not copy", variant: "destructive" })} data-testid="button-copy-private-link"><Icon name="copy" size={14} /> Copy my link</button>
          </section>
          {p.tasks.length > 0 && (
            <section className="glass mt-4">
              <h2 className="font-display text-[20px] mb-3">On your list</h2>
              <Checklist token={token} page={p} />
            </section>
          )}
        </>
      )}
    </PublicFrame>
  );
}
