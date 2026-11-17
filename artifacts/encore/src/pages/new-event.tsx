import { useState, type FormEvent } from "react";
import { useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateEvent, useDraftPlan, useGetDashboard, getGetDashboardQueryKey, getGetSessionQueryKey, getListSeriesQueryKey,
} from "@workspace/api-client-react";
import { Shell, PageHeader } from "@/components/shell";
import { ErrorPanel, Icon, Skel, Star } from "@/components/brand";
import { EVENT_TZ, errorMessage, fmtDate, stashDraft, zonedToUtcIso } from "@/lib/encore";
import { useToast } from "@/hooks/use-toast";

type Errors = Partial<Record<"description" | "name" | "date" | "time" | "guests" | "budget" | "form", string>>;

export default function NewEventPage() {
  const params = useParams<{ id: string }>();
  const seriesId = Number(params.id);
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const dash = useGetDashboard(seriesId, { query: { enabled: !!seriesId, queryKey: getGetDashboardQueryKey(seriesId) } });
  const createEvent = useCreateEvent();
  const draftPlan = useDraftPlan();

  const [description, setDescription] = useState("");
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("18:30");
  const [city, setCity] = useState("Calgary");
  const [place, setPlace] = useState("");
  const [guests, setGuests] = useState("");
  const [budget, setBudget] = useState("");
  const [why, setWhy] = useState("");
  const [who, setWho] = useState("");
  const [leave, setLeave] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [stage, setStage] = useState<"idle" | "saving" | "drafting">("idle");

  const latest = dash.data?.latest ?? null;
  const lesson = latest?.recap?.top_lesson?.trim();
  const reuse = (latest?.resources ?? []).filter((r) => r.use_again);
  const recurring = (latest?.tasks ?? []).filter((t) => t.recurring);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const er: Errors = {};
    if (!description.trim()) er.description = "A few sentences is all the helper needs.";
    if (!name.trim()) er.name = "Name the event.";
    if (!date) er.date = "Pick a date.";
    if (!time) er.time = "Pick a start time.";
    if (guests && (!/^\d+$/.test(guests) || Number(guests) > 100000)) er.guests = "Use a whole number.";
    if (budget && (Number.isNaN(Number(budget)) || Number(budget) < 0)) er.budget = "Use a positive amount.";
    setErrors(er);
    if (Object.keys(er).length) {
      document.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
      return;
    }
    setStage("saving");
    createEvent.mutate(
      {
        id: seriesId,
        data: {
          name: name.trim(), description_raw: description.trim(), starts_at: zonedToUtcIso(date, time, EVENT_TZ), timezone: EVENT_TZ,
          city: city.trim() || undefined, place_text: place.trim() || undefined,
          guests_expected: guests ? Number(guests) : undefined,
          budget_amount: budget ? Number(budget) : undefined, budget_currency: "CAD",
          purpose_why: why.trim() || undefined, purpose_audience: who.trim() || undefined, purpose_takeaway: leave.trim() || undefined,
        },
      },
      {
        onSuccess: (ev) => {
          qc.invalidateQueries({ queryKey: getGetDashboardQueryKey(seriesId) });
          qc.invalidateQueries({ queryKey: getListSeriesQueryKey() });
          setStage("drafting");
          draftPlan.mutate(
            { data: { event_id: ev.id } },
            {
              onSuccess: (draft) => {
                stashDraft(ev.id, draft);
                qc.invalidateQueries({ queryKey: getGetSessionQueryKey() });
                navigate(`/app/events/${ev.id}/plan`);
              },
              onError: (err) => {
                toast({ title: "Event saved, plan not drafted", description: `${errorMessage(err)} You can draft it from the plan page.`, variant: "destructive" });
                navigate(`/app/events/${ev.id}/plan`);
              },
            },
          );
        },
        onError: (err) => { setStage("idle"); setErrors({ form: errorMessage(err) }); },
      },
    );
  };

  const busy = stage !== "idle";

  let content;
  if (!seriesId) content = <ErrorPanel title="Series not found" message="This link does not point to a series." />;
  else if (dash.isError) content = <ErrorPanel title="Series not found" message={errorMessage(dash.error, "This series does not exist or is not yours.")} onRetry={() => void dash.refetch()} />;
  else content = (
    <>
      <PageHeader eyebrow={dash.data ? dash.data.series.name : "New event"} title="New event" subtitle="Step 1 of 2 · Tell the helper about it" />
      <form onSubmit={submit} noValidate className="grid lg:grid-cols-[1fr_330px] gap-6 items-start" data-testid="form-new-event">
        <div className="space-y-5">
          <section className="glass relative rise !p-5 md:!p-6" style={{ animationDelay: "60ms" }}>
            <Star size={14} className="absolute -top-2 -right-1.5" />
            <label htmlFor="desc" className="font-display text-[22px] leading-tight block mb-1">Describe your event in a few sentences</label>
            <p className="text-muted-ink text-[14px] mb-3">What happens, roughly when, and anything you already know you need.</p>
            <textarea id="desc" rows={6} className="field text-[16px]" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={10000} aria-invalid={!!errors.description}
              placeholder="A spring social for the builder community. Short demos from five members, then open mingling with snacks. We need a room for about 80 people, a projector, and a few people at the door." data-testid="input-description" />
            <div className="flex justify-between mt-1.5">
              {errors.description ? <p className="field-error !mt-0">{errors.description}</p> : <span />}
              <span className="font-mono-ui text-[11px] text-muted-ink">{description.length}/10000</span>
            </div>
          </section>

          <section className="glass rise !p-5 md:!p-6" style={{ animationDelay: "120ms" }}>
            <div className="mono-label mb-4">The details</div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="field-label" htmlFor="ev-name">Event name</label>
                <input id="ev-name" className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={160} aria-invalid={!!errors.name} placeholder="Spring Mixer" data-testid="input-event-name" />
                {errors.name && <p className="field-error">{errors.name}</p>}
              </div>
              <div>
                <label className="field-label" htmlFor="ev-date">Date</label>
                <input id="ev-date" type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} aria-invalid={!!errors.date} data-testid="input-event-date" />
                {errors.date && <p className="field-error">{errors.date}</p>}
              </div>
              <div>
                <label className="field-label" htmlFor="ev-time">Start time <span className="text-muted-ink font-normal">(Mountain time)</span></label>
                <input id="ev-time" type="time" className="field" value={time} onChange={(e) => setTime(e.target.value)} aria-invalid={!!errors.time} data-testid="input-event-time" />
                {errors.time && <p className="field-error">{errors.time}</p>}
              </div>
              <div>
                <label className="field-label" htmlFor="ev-city">City</label>
                <input id="ev-city" className="field" value={city} onChange={(e) => setCity(e.target.value)} maxLength={160} data-testid="input-event-city" />
              </div>
              <div>
                <label className="field-label" htmlFor="ev-place">Place <span className="text-muted-ink font-normal">(optional)</span></label>
                <input id="ev-place" className="field" value={place} onChange={(e) => setPlace(e.target.value)} maxLength={500} placeholder="Venue or address, if known" data-testid="input-event-place" />
              </div>
              <div>
                <label className="field-label" htmlFor="ev-guests">Expected guests</label>
                <input id="ev-guests" inputMode="numeric" className="field" value={guests} onChange={(e) => setGuests(e.target.value.replace(/[^\d]/g, ""))} aria-invalid={!!errors.guests} placeholder="80" data-testid="input-event-guests" />
                {errors.guests && <p className="field-error">{errors.guests}</p>}
              </div>
              <div>
                <label className="field-label" htmlFor="ev-budget">Budget (CAD)</label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-ink">$</span>
                  <input id="ev-budget" inputMode="decimal" className="field pl-7" value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^\d.]/g, ""))} aria-invalid={!!errors.budget} placeholder="350" data-testid="input-event-budget" />
                </div>
                {errors.budget && <p className="field-error">{errors.budget}</p>}
              </div>
            </div>
          </section>

          <section className="glass rise !p-5 md:!p-6" style={{ animationDelay: "180ms" }}>
            <div className="mono-label mb-1">Purpose</div>
            <p className="text-muted-ink text-[14px] mb-4">Optional, but it sharpens the plan and gives your recap something to measure against.</p>
            <div className="space-y-4">
              {[
                ["why", "Why this event", why, setWhy, "Members asked for a low-pressure way to meet each other."],
                ["who", "Who it is for", who, setWho, "People building side projects, first-timers welcome."],
                ["leave", "What people leave with", leave, setLeave, "One new contact and one idea to try this month."],
              ].map(([k, label, val, set, ph]) => (
                <div key={k as string}>
                  <label className="field-label" htmlFor={`p-${k}`}>{label as string}</label>
                  <textarea id={`p-${k}`} rows={2} className="field" value={val as string} onChange={(e) => (set as (v: string) => void)(e.target.value)} maxLength={2000} placeholder={ph as string} data-testid={`input-purpose-${k}`} />
                </div>
              ))}
            </div>
          </section>

          {errors.form && <div className="rounded-xl px-4 py-3 text-[14px]" style={{ background: "rgba(166,64,47,0.08)", color: "#8A3426" }} role="alert">{errors.form}</div>}

          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="btn btn-primary" disabled={busy} data-testid="button-draft-plan">
              <Icon name="spark" size={16} /> {stage === "saving" ? "Saving event" : stage === "drafting" ? "Drafting your plan" : "Draft my plan"}
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => navigate("/app")} disabled={busy} data-testid="button-cancel">Cancel</button>
            {busy && <span className="text-muted-ink text-[14px]" aria-live="polite">{stage === "drafting" ? "Event saved. Building the draft now." : "One moment."}</span>}
          </div>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-7">
          <section className="ai-glass rise" style={{ animationDelay: "140ms" }} data-testid="panel-helper-will-draft">
            <div className="font-mono-ui text-[11px] uppercase tracking-[0.16em] mb-3 flex items-center gap-2" style={{ color: "#5A4A0A" }}><Icon name="spark" size={14} /> What the helper will draft</div>
            <ul className="space-y-3">
              {[
                ["tasks", "Tasks", "8 to 16, grouped: venue and logistics, volunteers, promotion, event day, follow-up."],
                ["people", "Roles", "3 to 5 volunteer roles with slot counts and a one-line instruction."],
                ["calendar", "Timeline", "Each task gets a due date counted back from the event."],
              ].map(([ic, t, d]) => (
                <li key={t} className="flex gap-3">
                  <span className="mt-0.5 shrink-0"><Icon name={ic as "tasks"} size={17} /></span>
                  <span><span className="font-semibold">{t}.</span> {d}</span>
                </li>
              ))}
            </ul>
            <p className="text-[13px] mt-4 pt-3 border-t" style={{ borderColor: "rgba(90,74,10,0.2)" }}>Nothing is saved to your board until you accept the plan.</p>
          </section>

          {dash.isLoading ? (
            <Skel className="h-[160px] !rounded-2xl" />
          ) : latest ? (
            <section className="glass rise" style={{ animationDelay: "200ms" }} data-testid="panel-pulled-from">
              <div className="mono-label mb-2 flex items-center gap-2"><Icon name="loop" size={14} /> Pulled from {latest.event.name}</div>
              <div className="text-[13px] text-muted-ink mb-3">{fmtDate(latest.event.starts_at, latest.event.timezone)}</div>
              {lesson ? (
                <blockquote className="font-display text-[17px] leading-snug border-l-2 pl-3 mb-4" style={{ borderColor: "var(--gold)" }}>{lesson}</blockquote>
              ) : (
                <p className="text-[14px] text-muted-ink mb-4">{latest.recap ? "No top lesson recorded." : "No recap yet for this event, so there is no lesson to pass in."}</p>
              )}
              {(reuse.length > 0 || recurring.length > 0) && (
                <ul className="space-y-1.5 text-[14px]">
                  {reuse.map((r, i) => <li key={`r${i}`} className="flex gap-2 items-center"><span className="chip chip-auto capitalize">{r.kind}</span><span className="truncate">{r.name}</span></li>)}
                  {recurring.map((t) => <li key={t.id} className="flex gap-2 items-center"><span className="chip chip-gold">Recurring</span><span className="truncate">{t.title}</span></li>)}
                </ul>
              )}
              <p className="text-[13px] text-muted-ink mt-3">The helper reads this lesson and tags any task it shaped.</p>
            </section>
          ) : null}
        </aside>
      </form>
    </>
  );

  return <Shell>{content}</Shell>;
}
