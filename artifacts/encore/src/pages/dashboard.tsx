import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetDashboard, useLoadDemo, getGetDashboardQueryKey, getListSeriesQueryKey,
  type Dashboard, type Event,
} from "@workspace/api-client-react";
import { Shell, PageHeader, SeriesSwitcher } from "@/components/shell";
import { CreateSeriesDialog } from "@/components/create-series-dialog";
import { EchoMark, ErrorPanel, Icon, Skel, Star } from "@/components/brand";
import { useEncore } from "@/lib/session";
import { errorMessage, fmtDate, fmtTime } from "@/lib/encore";
import { useToast } from "@/hooks/use-toast";

function StatusChip({ e }: { e: Event }) {
  if (e.status === "done") return <span className="chip chip-done" data-testid={`status-event-${e.id}`}>Done</span>;
  if (!e.plan_accepted && e.status === "planning") return <span className="chip chip-open" data-testid={`status-event-${e.id}`}>Planning</span>;
  return <span className="chip chip-progress" data-testid={`status-event-${e.id}`}>Upcoming</span>;
}

function EventCard({ e, i, n }: { e: Event; i: number; n: number }) {
  const pct = e.tasks_total ? Math.round((e.tasks_done / e.tasks_total) * 100) : 0;
  const d = new Date(e.starts_at);
  return (
    <article className="glass rise group flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6 transition-transform duration-300 hover:-translate-y-0.5" style={{ animationDelay: `${120 + i * 60}ms` }} data-testid={`card-event-${e.id}`}>
      <div className="shrink-0 w-12 h-12 rounded-[14px] flex items-center justify-center font-display text-[22px]" style={{ background: "rgba(55,68,46,0.14)", color: "#37442E" }} title={`Event ${n}`}>{n}</div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2.5">
          <h3 className="font-display text-[24px] leading-tight truncate" data-testid={`text-event-name-${e.id}`}>{e.name}</h3>
          <StatusChip e={e} />
          {e.previous_event_id ? <span className="chip chip-gold">Carried forward</span> : null}
        </div>
        <div className="text-muted-ink text-[14px] mt-1">
          {fmtDate(e.starts_at, e.timezone)} at {fmtTime(e.starts_at, e.timezone)}{e.city ? ` · ${e.city}` : ""}
        </div>
        <div className="mt-3 flex items-center gap-3 max-w-[360px]">
          <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(55,68,46,0.1)" }}>
            <div className="h-full rounded-full origin-left transition-transform duration-700" style={{ background: "var(--forest)", width: "100%", transform: `scaleX(${pct / 100})` }} />
          </div>
          <span className="font-mono-ui text-[11px] tracking-[0.08em] text-muted-ink whitespace-nowrap" data-testid={`text-progress-${e.id}`}>{e.tasks_done} of {e.tasks_total} tasks</span>
        </div>
      </div>
      <Link href={`/app/events/${e.id}/plan`} className="btn btn-primary self-start sm:self-center" data-testid={`button-open-event-${e.id}`}>
        Open <Icon name="arrow" size={15} />
      </Link>
      {e.status === "done" && (
        <Link href={`/app/events/${e.id}/next`} className="btn btn-secondary self-start sm:self-center" data-testid={`button-create-next-${e.id}`}>
          <Icon name="loop" size={15} /> Create next event
        </Link>
      )}
    </article>
  );
}

function CarriedForward({ d }: { d: Dashboard }) {
  const latest = d.latest;
  const lesson = latest?.recap?.top_lesson?.trim();
  const reuse = (latest?.resources ?? []).filter((r) => r.use_again);
  return (
    <section className="glass relative rise" style={{ animationDelay: "160ms" }} data-testid="panel-carried-forward">
      <Star size={13} className="absolute top-4 right-4" />
      <div className="mono-label mb-3 flex items-center gap-2"><Icon name="loop" size={14} /> Carried forward</div>
      {!latest || !latest.recap ? (
        <div>
          <p className="font-display text-[19px] leading-snug">Nothing to carry yet.</p>
          <p className="text-muted-ink text-[14px] mt-2">After your first event, the wrap-up's top lesson and the resources worth using again will wait for you here.</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="text-[13px] text-muted-ink">From the {latest.event.name} wrap-up</div>
          {lesson ? (
            <blockquote className="font-display text-[19px] leading-snug border-l-2 pl-3" style={{ borderColor: "var(--gold)" }} data-testid="text-top-lesson">{lesson}</blockquote>
          ) : (
            <p className="text-muted-ink text-[14px]">No top lesson was written for this one.</p>
          )}
          <div>
            <div className="mono-label mb-2">Use again</div>
            {reuse.length ? (
              <ul className="space-y-2">
                {reuse.map((r, i) => (
                  <li key={r.id ?? i} className="flex gap-2.5 items-start" data-testid={`text-resource-${i}`}>
                    <span className="chip chip-auto capitalize mt-0.5">{r.kind}</span>
                    <span className="min-w-0"><span className="font-semibold">{r.name}</span>{r.note ? <span className="text-muted-ink text-[14px] block">{r.note}</span> : null}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-ink text-[14px]">No resources were marked "use again".</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function HelperNudge({ d }: { d: Dashboard }) {
  const next = [...d.events].filter((e) => e.status !== "done").sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at))[0];
  let text: string; let href: string | null = null; let cta = "";
  if (!next) { text = "No upcoming event in this series. Start the next one while the last is still fresh."; href = `/app/series/${d.series.id}/events/new`; cta = "New event"; }
  else if (!next.plan_accepted) { text = `${next.name} does not have an accepted plan yet. A draft takes a minute.`; href = `/app/events/${next.id}/plan`; cta = "Draft the plan"; }
  else if (d.unassigned_count > 0) { text = `${next.name} has ${d.unassigned_count} task${d.unassigned_count === 1 ? "" : "s"} with no owner.`; href = `/app/events/${next.id}/tasks`; cta = "Assign them"; }
  else if (next.roles_count > 0 && next.volunteers_count === 0) { text = `${next.name} has ${next.roles_count} roles and no volunteers yet. Share the sign-up link.`; href = `/app/events/${next.id}/volunteers`; cta = "Get the link"; }
  else { text = `${next.name} is on track: ${next.tasks_done} of ${next.tasks_total} tasks done.`; href = `/app/events/${next.id}/tasks`; cta = "See the board"; }
  return (
    <section className="ai-glass rise" style={{ animationDelay: "220ms" }} data-testid="card-helper-nudge">
      <div className="font-mono-ui text-[11px] uppercase tracking-[0.16em] mb-2 flex items-center gap-2" style={{ color: "#5A4A0A" }}><Icon name="spark" size={14} /> Helper</div>
      <p className="font-semibold leading-snug" data-testid="text-helper-nudge">{text}</p>
      {href && <Link href={href} className="btn btn-sm mt-4" style={{ background: "rgba(255,255,255,0.55)", border: "1px solid rgba(201,168,76,0.9)", color: "#3A3200" }} data-testid="button-helper-nudge">{cta} <Icon name="arrow" size={14} /></Link>}
    </section>
  );
}

function DashboardSkeleton() {
  return (
    <div data-testid="status-loading-dashboard">
      <Skel className="h-4 w-28 mb-3" /><Skel className="h-10 w-80 max-w-full mb-3" /><Skel className="h-4 w-64 mb-8" />
      <div className="grid lg:grid-cols-[1fr_320px] gap-6">
        <div className="space-y-3">{[0, 1, 2].map((i) => <Skel key={i} className="h-[108px] !rounded-2xl" />)}</div>
        <div className="space-y-3"><Skel className="h-[200px] !rounded-2xl" /><Skel className="h-[110px] !rounded-2xl" /></div>
      </div>
    </div>
  );
}

function EmptySeries() {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const { selectSeries } = useEncore();
  const { toast } = useToast();
  const demo = useLoadDemo();
  const load = () =>
    demo.mutate(undefined, {
      onSuccess: (s) => {
        qc.invalidateQueries({ queryKey: getListSeriesQueryKey() });
        selectSeries(s.id);
        toast({ title: "Demo loaded", description: `${s.name} is ready to explore.` });
      },
      onError: (e) => toast({ title: "Could not load demo data", description: errorMessage(e), variant: "destructive" }),
    });
  return (
    <div className="min-h-[70dvh] flex items-center">
      <div className="glass relative w-full max-w-[720px] !p-8 md:!p-12 overflow-hidden rise" data-testid="panel-empty-dashboard">
        <div className="absolute -right-16 -bottom-16 opacity-[0.08] pointer-events-none"><EchoMark size={320} /></div>
        <Star size={16} className="absolute top-6 right-8" />
        <div className="mono-label mb-4">Your first series</div>
        <h1 className="page-title max-w-[520px]">Every good night deserves a second one.</h1>
        <p className="text-muted-ink mt-4 max-w-[480px]">
          A series is the thing you run again and again: a builder night, a club social, a monthly workshop. Create one, or look around a finished example first.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <button className="btn btn-primary" onClick={() => setOpen(true)} data-testid="button-create-first-series"><Icon name="plus" size={16} /> Create your first series</button>
          <button className="btn btn-secondary" onClick={load} disabled={demo.isPending} data-testid="button-load-demo">{demo.isPending ? "Loading demo" : "Load demo data"}</button>
        </div>
        <p className="text-[13px] text-muted-ink mt-5">Demo data is fictional: one series, three events, roles, tasks and volunteers.</p>
      </div>
      <CreateSeriesDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

export default function DashboardPage() {
  const { series, seriesLoading, seriesError, refetchSeries, selectedSeries } = useEncore();
  const [, navigate] = useLocation();
  const [newSeriesOpen, setNewSeriesOpen] = useState(false);
  const id = selectedSeries?.id ?? 0;
  const dash = useGetDashboard(id, { query: { enabled: !!id, queryKey: getGetDashboardQueryKey(id) } });

  let body;
  let currentEvent: { id: number; name: string } | null = null;
  if (seriesLoading) body = <DashboardSkeleton />;
  else if (seriesError) body = <ErrorPanel message={errorMessage(seriesError)} onRetry={refetchSeries} />;
  else if (!series.length) body = <EmptySeries />;
  else if (dash.isLoading || !dash.data) {
    body = dash.isError ? <ErrorPanel message={errorMessage(dash.error)} onRetry={() => void dash.refetch()} /> : <DashboardSkeleton />;
  } else {
    const d = dash.data;
    const events = [...d.events].sort((a, b) => {
      const ad = a.status === "done" ? 1 : 0; const bd = b.status === "done" ? 1 : 0;
      if (ad !== bd) return ad - bd;
      return ad ? +new Date(b.starts_at) - +new Date(a.starts_at) : +new Date(a.starts_at) - +new Date(b.starts_at);
    });
    const nextEvent = events.find((event) => event.status !== "done") ?? events[0];
    currentEvent = nextEvent ? { id: nextEvent.id, name: nextEvent.name } : null;
    body = (
      <>
        <PageHeader
          eyebrow="Series"
          title={d.series.name}
          subtitle={d.series.description || "Your series. Every event builds on the last."}
          actions={<>
            <SeriesSwitcher onNew={() => setNewSeriesOpen(true)} />
            <button className="btn btn-primary" onClick={() => navigate(`/app/series/${d.series.id}/events/new`)} data-testid="button-new-event"><Icon name="plus" size={16} /> New event</button>
          </>}
        />
        <div className="grid lg:grid-cols-[1fr_320px] gap-6 items-start">
          <div className="space-y-3">
            <div className="mono-label !text-[12px]">Events in this series</div>
            {events.length ? (
              events.map((e, i) => <EventCard key={e.id} e={e} i={i} n={[...d.events].sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at)).findIndex((x) => x.id === e.id) + 1} />)
            ) : (
              <div className="glass rise !p-8 text-center" data-testid="panel-no-events">
                <div className="flex justify-center mb-4"><EchoMark size={44} /></div>
                <h2 className="font-display text-[24px]">No events in this series yet.</h2>
                <p className="text-muted-ink mt-2 max-w-[400px] mx-auto">Describe the first one in a few sentences. The helper drafts the tasks and roles.</p>
                <button className="btn btn-primary mt-6" onClick={() => navigate(`/app/series/${d.series.id}/events/new`)} data-testid="button-new-event-empty"><Icon name="plus" size={16} /> Plan the first event</button>
              </div>
            )}
          </div>
          <aside className="space-y-4 lg:sticky lg:top-7">
            <div className="mono-label !text-[12px]">Carried forward</div>
            <CarriedForward d={d} />
            <HelperNudge d={d} />
          </aside>
        </div>
      </>
    );
  }
  return <Shell event={currentEvent}>{body}<CreateSeriesDialog open={newSeriesOpen} onOpenChange={setNewSeriesOpen} /></Shell>;
}
