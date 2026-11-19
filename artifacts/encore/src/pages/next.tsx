import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateNextEvent, useGetDashboard, getGetDashboardQueryKey, getListSeriesQueryKey } from "@workspace/api-client-react";
import { Shell, PageHeader } from "@/components/shell";
import { ErrorPanel, Icon, Skel } from "@/components/brand";
import { EVENT_TZ, errorMessage, errorStatus, zonedToUtcIso } from "@/lib/encore";
import { useEventBundle } from "@/lib/use-event";
import { useToast } from "@/hooks/use-toast";

type Flags = { carry_lessons: boolean; carry_resources: boolean; carry_roles: boolean; carry_recurring: boolean; carry_volunteers: boolean };

function Check({ checked, onChange, disabled, title, detail, testid }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; title: string; detail: ReactNode; testid: string }) {
  return (
    <label className={`flex gap-3 items-start py-3 ${disabled ? "opacity-70" : "cursor-pointer"}`}>
      <input type="checkbox" className="sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} data-testid={testid} />
      <span className="w-6 h-6 mt-0.5 rounded-[7px] shrink-0 flex items-center justify-center transition-colors" style={checked ? { background: "#37442E", color: "#fff" } : { border: "2px solid rgba(31,30,29,0.3)" }}>{checked && <Icon name="check" size={14} />}</span>
      <span className="min-w-0"><span className="text-[15px] font-semibold block">{title}</span><span className="text-[13px] text-muted-ink block">{detail}</span></span>
    </label>
  );
}

export default function NextEventPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useEventBundle(id, 0);
  const sid = q.data?.series.id ?? 0;
  const dash = useGetDashboard(sid, { query: { enabled: !!sid, queryKey: getGetDashboardQueryKey(sid) } });
  const create = useCreateNextEvent();
  const [flags, setFlags] = useState<Flags>({ carry_lessons: true, carry_resources: true, carry_roles: true, carry_recurring: true, carry_volunteers: true });
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("18:30");
  const [items, setItems] = useState<{ text: string; on: boolean }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const init = useRef(false);
  const nameInit = useRef(false);

  const b = q.data;
  useEffect(() => { if (b && !init.current) { init.current = true; setItems((b.recap?.items ?? []).map((t) => ({ text: t, on: true }))); } }, [b]);
  useEffect(() => { if (b && dash.data && !nameInit.current) { nameInit.current = true; setName(`${b.series.name} ${dash.data.events.length + 1}`); } }, [b, dash.data]);

  if (q.isLoading) return <Shell><Skel className="h-10 w-80 mb-3" /><Skel className="h-4 w-60 mb-8" /><Skel className="h-96 !rounded-2xl" /></Shell>;
  if (q.isError || !b) {
    const nf = errorStatus(q.error) === 404 || errorStatus(q.error) === 403;
    return <Shell><ErrorPanel title={nf ? "Event not found" : "That did not load"} message={nf ? "This event does not exist or belongs to someone else." : errorMessage(q.error)} onRetry={nf ? undefined : () => void q.refetch()} /></Shell>;
  }
  const ev = b.event;
  if (!b.recap) return (
    <Shell event={{ id: ev.id, name: ev.name }}>
      <PageHeader title="New event from wrap-up" subtitle={ev.name} />
      <div className="glass !p-8 max-w-[560px]"><h2 className="font-display text-[24px]">Save a wrap-up first.</h2><p className="text-muted-ink mt-2">The next event starts from what you learned. Fill in the wrap-up, save it, then come back.</p><Link href={`/app/events/${id}/wrapup`} className="btn btn-primary mt-5" data-testid="link-to-wrapup">Open wrap-up</Link></div>
    </Shell>
  );
  const r = b.recap;
  const reuse = b.resources.filter((x) => x.use_again);
  const recurring = b.tasks.filter((t) => t.recurring);
  const willing = b.volunteers.filter((v) => v.ask_again && v.status === "confirmed");
  const nextN = (dash.data?.events.length ?? 0) + 1;
  const setFlag = (k: keyof Flags, v: boolean) => setFlags((f) => ({ ...f, [k]: v, ...(k === "carry_volunteers" && v ? { carry_roles: true } : {}) }));
  const chosen = items.filter((i) => i.on && i.text.trim());

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setErr("Name the new event.");
    if (!date || !time) return setErr("Pick a date and start time.");
    setErr(null);
    create.mutate({ id, data: { name: name.trim(), starts_at: zonedToUtcIso(date, time, EVENT_TZ), ...flags, carry_roles: flags.carry_roles || flags.carry_volunteers, items: chosen.map((i) => i.text.trim()).slice(0, 30) } }, {
      onSuccess: (nev) => {
        qc.invalidateQueries({ queryKey: getGetDashboardQueryKey(b.series.id) });
        qc.invalidateQueries({ queryKey: getListSeriesQueryKey() });
        toast({ title: `${nev.name} created`, description: "Carried items are on its board." });
        navigate(`/app/events/${nev.id}/plan`);
      },
      onError: (x) => setErr(errorMessage(x)),
    });
  };

  return (
    <Shell event={{ id: ev.id, name: ev.name }}>
      <PageHeader title="New event from wrap-up" subtitle="Lessons and resources come with you"
        actions={<Link href={`/app/events/${id}/wrapup`} className="btn btn-secondary" data-testid="link-back-wrapup">Back to wrap-up</Link>} />
      <form onSubmit={submit} className="grid lg:grid-cols-[1fr_380px] gap-6 items-start" data-testid="form-next">
        <div className="space-y-4 min-w-0">
          <section className="glass">
            <div className="mono-label mb-1">Carry over from {ev.name}</div>
            <div className="divide-y" style={{ borderColor: "var(--line)" }}>
              <Check testid="check-lessons" checked={flags.carry_lessons} onChange={(v) => setFlag("carry_lessons", v)} title="Lessons" detail={r.top_lesson || r.what_didnt ? <>{r.top_lesson && <>Top lesson: "{r.top_lesson}"</>}{r.what_didnt && <span className="block">Did not work: {r.what_didnt}</span>}</> : "No lesson written."} />
              <Check testid="check-resources" checked={flags.carry_resources} onChange={(v) => setFlag("carry_resources", v)} title="Resources to use again" detail={reuse.length ? reuse.map((x) => x.name).join(", ") : "None marked use again."} />
              <Check testid="check-roles" checked={flags.carry_roles || flags.carry_volunteers} disabled={flags.carry_volunteers} onChange={(v) => setFlag("carry_roles", v)} title="Volunteer roles" detail={<>{b.roles.length ? b.roles.map((x) => `${x.name} (${x.slots_needed})`).join(", ") : "No roles."}{flags.carry_volunteers && <span className="block" style={{ color: "#8A7330" }}>Kept on because returning volunteers need their roles.</span>}</>} />
              <Check testid="check-recurring" checked={flags.carry_recurring} onChange={(v) => setFlag("carry_recurring", v)} title="Recurring tasks" detail={recurring.length ? recurring.map((t) => t.title).join(", ") : "No tasks marked recurring."} />
              <Check testid="check-volunteers" checked={flags.carry_volunteers} onChange={(v) => setFlag("carry_volunteers", v)} title="Volunteers who said ask me again" detail={willing.length ? <>{willing.map((v) => v.email_consent && v.email ? `${v.name} (${v.email})` : v.name).join(", ")}<span className="block">Emails shown only for people who agreed to be emailed.</span></> : "Nobody ticked ask me again."} />
            </div>
          </section>
          <section className="glass">
            <div className="grid sm:grid-cols-3 gap-4">
              <div className="sm:col-span-3"><label className="field-label" htmlFor="n-name">Event name</label><input id="n-name" className="field" value={name} maxLength={160} onChange={(e) => setName(e.target.value)} data-testid="input-next-name" /></div>
              <div className="sm:col-span-2"><label className="field-label" htmlFor="n-date">Date</label><input id="n-date" type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} data-testid="input-next-date" /></div>
              <div><label className="field-label" htmlFor="n-time">Start <span className="text-muted-ink font-normal">(Mountain)</span></label><input id="n-time" type="time" className="field" value={time} onChange={(e) => setTime(e.target.value)} data-testid="input-next-time" /></div>
            </div>
          </section>
          {err && <div className="rounded-xl px-4 py-3 text-[14px]" style={{ background: "rgba(166,64,47,0.08)", color: "#8A3426" }} role="alert">{err}</div>}
          <button type="submit" className="btn btn-primary" disabled={create.isPending} data-testid="button-create-event-n">{create.isPending ? "Creating" : `Create Event ${nextN}`} <Icon name="arrow" size={15} /></button>
        </div>
        <aside className="glass lg:sticky lg:top-7" data-testid="panel-starter-tasks">
          <h2 className="font-display text-[22px] mb-1">Starter tasks for Event {nextN}</h2>
          <p className="text-[13px] text-muted-ink mb-3">From your wrap-up's next event starter. Untick or edit any.</p>
          <ul className="space-y-2">
            {items.map((it, i) => (
              <li key={i} className="flex items-center gap-2">
                <input type="checkbox" className="w-5 h-5 accent-[#37442E] shrink-0" checked={it.on} onChange={(e) => setItems((x) => x.map((y, j) => (j === i ? { ...y, on: e.target.checked } : y)))} aria-label={`Include ${it.text}`} data-testid={`check-item-${i}`} />
                <input className={`field field-compact flex-1 text-[14px] ${it.on ? "" : "opacity-50"}`} value={it.text} maxLength={1000} onChange={(e) => setItems((x) => x.map((y, j) => (j === i ? { ...y, text: e.target.value } : y)))} aria-label={`Starter item ${i + 1}`} />
              </li>
            ))}
            {recurring.length > 0 && flags.carry_recurring && recurring.map((t) => (
              <li key={`rec${t.id}`} className="flex items-center gap-2 text-[14px] pl-7"><span className="flex-1 font-semibold">{t.title}</span><span className="chip chip-gold">From last event</span></li>
            ))}
          </ul>
          {items.length === 0 && <p className="text-[14px] text-muted-ink">No starter items on the wrap-up. <Link href={`/app/events/${id}/wrapup`} className="underline">Add some</Link>.</p>}
          <button type="button" className="btn btn-ghost btn-sm mt-2" onClick={() => setItems((x) => [...x, { text: "", on: true }])} data-testid="button-add-starter"><Icon name="plus" size={14} /> Add task</button>
          <p className="text-[13px] text-muted-ink mt-3">{chosen.length} starter task{chosen.length === 1 ? "" : "s"} will be tagged "From last event". The AI plan stays optional.</p>
        </aside>
      </form>
    </Shell>
  );
}
