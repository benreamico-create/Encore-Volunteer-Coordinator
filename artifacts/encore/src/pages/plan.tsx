import { useMemo, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetEvent, useDraftPlan, useAcceptPlan, getGetEventQueryKey, getGetDashboardQueryKey, getGetSessionQueryKey,
  type PlanDraft, type EventBundle,
} from "@workspace/api-client-react";
import { Shell, PageHeader } from "@/components/shell";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EventDetailsDialog } from "@/components/event-details-dialog";
import { ErrorPanel, Icon, Skel, Star } from "@/components/brand";
import { GROUPS, addDays, clearDraft, errorMessage, errorStatus, fmtDate, fmtShort, fmtTime, offsetLabel, readDraft, sourceChip, stashDraft } from "@/lib/encore";
import { useEncore } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";
import { SavedPlanEditor } from "@/pages/saved-plan-editor";

type Row = { key: string; title: string; offset: number; group: string; from_lesson?: string };
type RoleRow = { key: string; name: string; slots: number; instruction: string };
let seq = 0;
const k = () => `r${++seq}`;

function toRows(d: PlanDraft) {
  const rows: Row[] = d.groups.flatMap((g) => g.tasks.map((t) => ({ key: k(), title: t.title, offset: t.due_offset_days, group: g.name, from_lesson: t.from_lesson || undefined })));
  const roles: RoleRow[] = d.roles.map((r) => ({ key: k(), name: r.name, slots: r.slots, instruction: r.instruction }));
  return { rows, roles };
}

function Overview({ b, onEdit }: { b: EventBundle; onEdit: () => void }) {
  const e = b.event;
  const purpose = [["Why this event", e.purpose_why], ["Who it is for", e.purpose_audience], ["What people leave with", e.purpose_takeaway]].filter(([, v]) => v && String(v).trim());
  return (
    <section className="glass relative rise" data-testid="panel-event-overview">
      <Star size={13} className="absolute top-4 right-4" />
      <div className="mono-label mb-3">Event details</div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-[14px]">
        <div><dt className="text-muted-ink text-[12px]">Date</dt><dd className="font-semibold" data-testid="text-event-date">{fmtDate(e.starts_at, e.timezone)}</dd></div>
        <div><dt className="text-muted-ink text-[12px]">Starts</dt><dd className="font-semibold">{fmtTime(e.starts_at, e.timezone)}</dd></div>
        <div><dt className="text-muted-ink text-[12px]">City</dt><dd className="font-semibold">{e.city || "Not set"}</dd></div>
        <div><dt className="text-muted-ink text-[12px]">Place</dt><dd className="font-semibold truncate">{e.place_text || "Not set"}</dd></div>
        <div><dt className="text-muted-ink text-[12px]">Guests</dt><dd className="font-semibold">{e.guests_expected ?? "Not set"}</dd></div>
        <div><dt className="text-muted-ink text-[12px]">Budget</dt><dd className="font-semibold">{e.budget_amount != null ? `$${e.budget_amount.toLocaleString("en-CA")} ${e.budget_currency || "CAD"}` : "Not set"}</dd></div>
      </dl>
      <div className="mt-4 pt-4 border-t" style={{ borderColor: "var(--line)" }}>
        <div className="text-[12px] text-muted-ink mb-1">Description</div>
        <p className="text-[14px] whitespace-pre-wrap" data-testid="text-event-description">{e.description_raw}</p>
      </div>
      {purpose.length > 0 && (
        <div className="mt-4 pt-4 border-t space-y-2.5" style={{ borderColor: "var(--line)" }}>
          {purpose.map(([l, v]) => (
            <div key={l as string}><div className="text-[12px] text-muted-ink">{l}</div><p className="text-[14px]">{v}</p></div>
          ))}
        </div>
      )}
      <p className="text-[12px] text-muted-ink mt-4" data-testid="text-event-last-edited">
        {e.updated_by_name ? `Last edited ${fmtDate(e.updated_at, e.timezone)} at ${fmtTime(e.updated_at, e.timezone)} by ${e.updated_by_name}` : "No edits since this event was created"}
      </p>
      <button type="button" className="btn btn-secondary btn-sm mt-4 w-full" onClick={onEdit} data-testid="button-edit-event-overview">
        Edit details
      </button>
    </section>
  );
}

function CarriedTasks({ b }: { b: EventBundle }) {
  if (!b.tasks.length) return null;
  return (
    <section className="glass rise" data-testid="panel-existing-tasks">
      <div className="flex items-center justify-between mb-3">
        <div className="font-display text-[20px]">Already on the board</div>
        <span className="chip chip-todo">{b.tasks.length}</span>
      </div>
      <p className="text-[14px] text-muted-ink mb-3">These stay as they are. Accepting a plan adds to them; it never replaces them.</p>
      <ul className="space-y-2">
        {b.tasks.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center gap-2 text-[14px]" data-testid={`row-existing-task-${t.id}`}>
            <span className={`chip ${t.status === "done" ? "chip-done" : t.status === "doing" ? "chip-progress" : "chip-todo"}`}>{t.status === "doing" ? "In progress" : t.status === "done" ? "Done" : "To do"}</span>
            <span className="font-semibold">{t.title}</span>
            {(() => { const c = sourceChip(t.source, t.source_note, b.previous?.event.name); return c ? <span className={`chip ${c.cls}`}>{c.label}</span> : null; })()}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function PlanPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { session } = useEncore();
  const q = useGetEvent(id, { query: { enabled: !!id, queryKey: getGetEventQueryKey(id) } });
  const draftM = useDraftPlan();
  const acceptM = useAcceptPlan();

  const initial = useMemo(() => { const d = readDraft<PlanDraft>(id); return d ? { ...toRows(d), notice: d.notice } : null; }, [id]);
  const [rows, setRows] = useState<Row[] | null>(initial?.rows ?? null);
  const [roles, setRoles] = useState<RoleRow[]>(initial?.roles ?? []);
  const [notice, setNotice] = useState<string | undefined>(initial?.notice);
  const [confirmRedraft, setConfirmRedraft] = useState(false);
  const [editEvent, setEditEvent] = useState(false);

  const persist = (r: Row[], ro: RoleRow[]) => stashDraft(id, toDraft(r, ro));
  const toDraft = (r: Row[], ro: RoleRow[]): PlanDraft => {
    const names = Array.from(new Set([...GROUPS, ...r.map((x) => x.group)]));
    return {
      groups: names.map((n) => ({ name: n, tasks: r.filter((x) => x.group === n && x.title.trim()).map((x) => ({ title: x.title.trim(), due_offset_days: x.offset, ...(x.from_lesson ? { from_lesson: x.from_lesson } : {}) })) })).filter((g) => g.tasks.length),
      roles: ro.filter((x) => x.name.trim()).map((x) => ({ name: x.name.trim(), slots: Math.max(1, Math.min(100, x.slots || 1)), instruction: x.instruction.trim() })),
      notice,
    };
  };
  const updRows = (fn: (r: Row[]) => Row[]) => setRows((prev) => { const n = fn(prev ?? []); persist(n, roles); return n; });
  const updRoles = (fn: (r: RoleRow[]) => RoleRow[]) => setRoles((prev) => { const n = fn(prev); persist(rows ?? [], n); return n; });

  const draft = () =>
    draftM.mutate({ data: { event_id: id } }, {
      onSuccess: (d) => {
        const t = toRows(d);
        setRows(t.rows); setRoles(t.roles); setNotice(d.notice);
        stashDraft(id, d);
        qc.invalidateQueries({ queryKey: getGetSessionQueryKey() });
        toast({ title: "Draft ready", description: "Edit anything, then accept." });
      },
      onError: (e) => toast({ title: "Could not draft the plan", description: errorMessage(e), variant: "destructive" }),
    });

  const accept = () => {
    const data = toDraft(rows ?? [], roles);
    if (!data.groups.length && !data.roles.length) { toast({ title: "Nothing to accept", description: "Add at least one task or role.", variant: "destructive" }); return; }
    acceptM.mutate({ id, data }, {
      onSuccess: () => {
        clearDraft(id);
        qc.invalidateQueries({ queryKey: getGetEventQueryKey(id) });
        if (q.data) qc.invalidateQueries({ queryKey: getGetDashboardQueryKey(q.data.series.id) });
        toast({ title: "Plan accepted", description: `${data.groups.reduce((n, g) => n + g.tasks.length, 0)} tasks and ${data.roles.length} roles created.` });
        navigate(`/app/events/${id}/tasks`);
      },
      onError: (e) => toast({ title: "Could not accept the plan", description: errorMessage(e), variant: "destructive" }),
    });
  };

  const b = q.data;
  const shellEvent = b ? { id: b.event.id, name: b.event.name } : null;

  if (q.isLoading) return (
    <Shell><div data-testid="status-loading-plan"><Skel className="h-10 w-96 max-w-full mb-3" /><Skel className="h-4 w-64 mb-8" /><div className="grid lg:grid-cols-[1fr_340px] gap-6"><div className="space-y-3">{[0, 1, 2, 3].map((i) => <Skel key={i} className="h-24 !rounded-2xl" />)}</div><Skel className="h-80 !rounded-2xl" /></div></div></Shell>
  );
  if (q.isError || !b) {
    const nf = errorStatus(q.error) === 404 || errorStatus(q.error) === 403;
    return <Shell><ErrorPanel title={nf ? "Event not found" : "That did not load"} message={nf ? "This event does not exist or belongs to someone else." : errorMessage(q.error)} onRetry={nf ? undefined : () => void q.refetch()} /></Shell>;
  }

  const ev = b.event;
  const prevName = b.previous?.event.name;
  const showingDraft = !!rows && !ev.plan_accepted;
  const grouped = Array.from(new Set([...GROUPS, ...(rows ?? []).map((r) => r.group)])).map((g) => ({ g, items: (rows ?? []).filter((r) => r.group === g) }));
  const taskCount = rows?.length ?? 0;
  const lessonChip = (r: Row) => r.from_lesson ? <span className="chip chip-gold" title={r.from_lesson}>from your {prevName ?? "last event"} lesson</span> : null;

  return (
    <Shell event={shellEvent}>
      <PageHeader
        eyebrow={b.series.name}
        title={showingDraft ? `${ev.name}: draft plan` : ev.name}
        subtitle={showingDraft ? "Step 2 of 2 · Edit, delete or add anything" : ev.plan_accepted ? "Plan accepted. Edit the event, tasks and volunteer roles here." : "No plan drafted yet."}
        actions={<>
          {!ev.plan_accepted && <button type="button" className="btn btn-secondary" onClick={() => setEditEvent(true)} data-testid="button-edit-event">Edit details</button>}
          {showingDraft ? (
          <>
            <button className="btn btn-secondary" onClick={() => setConfirmRedraft(true)} disabled={draftM.isPending || acceptM.isPending} data-testid="button-redraft">{draftM.isPending ? "Drafting" : "Redraft"}</button>
            <button className="btn btn-primary" onClick={accept} disabled={acceptM.isPending || draftM.isPending} data-testid="button-accept-plan"><Icon name="check" size={16} /> {acceptM.isPending ? "Accepting" : "Accept plan"}</button>
          </>
        ) : ev.plan_accepted ? (
          <Link href={`/app/events/${id}/tasks`} className="btn btn-primary" data-testid="button-go-tasks">Open task board <Icon name="arrow" size={15} /></Link>
        ) : null}
        </>}
      />

      <div className="grid lg:grid-cols-[1fr_340px] gap-6 items-start">
        <div className="space-y-4 min-w-0">
          {showingDraft ? (
            <>
              <div className="ai-glass !py-3 flex flex-wrap items-center gap-2.5 rise" data-testid="text-ai-draft-label">
                <Icon name="spark" size={16} />
                <span className="font-semibold">AI draft. Nothing is saved until you accept.</span>
                {notice && <span className="text-[14px] w-full sm:w-auto" data-testid="text-draft-notice">{notice}</span>}
              </div>
              {grouped.map(({ g, items }, gi) => (
                <section key={g} className="glass rise" style={{ animationDelay: `${gi * 50}ms` }} data-testid={`group-${g}`}>
                  <div className="flex items-center justify-between mb-3">
                    <h2 className="mono-label !text-[12px]">{g}</h2>
                    <span className="font-mono-ui text-[11px] text-muted-ink">{items.length} task{items.length === 1 ? "" : "s"}</span>
                  </div>
                  <ul className="space-y-2">
                    {items.map((r) => (
                      <li key={r.key} className="group rounded-xl p-2.5 -mx-1 transition-colors hover:bg-white/60" data-testid={`row-task-${r.key}`}>
                        <div className="flex flex-col md:flex-row md:items-center gap-2">
                          <input className="field field-compact flex-1 font-semibold" value={r.title} maxLength={300} onChange={(e) => updRows((rs) => rs.map((x) => x.key === r.key ? { ...x, title: e.target.value } : x))} aria-label="Task title" data-testid={`input-task-title-${r.key}`} />
                          <div className="flex items-center gap-2">
                            <input type="number" className="field field-compact w-[76px]" value={r.offset} min={-365} max={365} onChange={(e) => updRows((rs) => rs.map((x) => x.key === r.key ? { ...x, offset: Math.max(-365, Math.min(365, Math.round(Number(e.target.value) || 0))) } : x))} aria-label="Due offset in days" data-testid={`input-task-offset-${r.key}`} />
                            <select className="field field-compact w-[170px]" value={r.group} onChange={(e) => updRows((rs) => rs.map((x) => x.key === r.key ? { ...x, group: e.target.value } : x))} aria-label="Group" data-testid={`select-task-group-${r.key}`}>
                              {GROUPS.map((o) => <option key={o} value={o}>{o}</option>)}
                            </select>
                            <button className="icon-btn shrink-0" onClick={() => updRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label={`Remove ${r.title}`} data-testid={`button-remove-task-${r.key}`}><Icon name="trash" size={16} /></button>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 mt-1.5 pl-1 text-[13px] text-muted-ink">
                          <span>Due {fmtShort(addDays(ev.starts_at, r.offset), ev.timezone)} · {offsetLabel(r.offset)}</span>
                          {lessonChip(r)}
                        </div>
                      </li>
                    ))}
                  </ul>
                  <button className="btn btn-ghost btn-sm mt-2" onClick={() => updRows((rs) => [...rs, { key: k(), title: "", offset: -7, group: g }])} data-testid={`button-add-task-${g}`}><Icon name="plus" size={14} /> Add task</button>
                </section>
              ))}

              <section className="glass rise" data-testid="panel-roles">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-display text-[20px]">Suggested volunteer roles</h2>
                  <span className="font-mono-ui text-[11px] text-muted-ink">{roles.reduce((n, r) => n + (r.slots || 0), 0)} spots</span>
                </div>
                <ul className="space-y-3">
                  {roles.map((r) => (
                    <li key={r.key} className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.5)", border: "1px solid var(--line)" }} data-testid={`row-role-${r.key}`}>
                      <div className="flex items-center gap-2">
                        <input className="field field-compact flex-1 font-semibold" value={r.name} maxLength={120} onChange={(e) => updRoles((rs) => rs.map((x) => x.key === r.key ? { ...x, name: e.target.value } : x))} aria-label="Role name" data-testid={`input-role-name-${r.key}`} />
                        <label className="flex items-center gap-1.5 text-[13px] text-muted-ink">
                          <input type="number" min={1} max={100} className="field field-compact w-[64px]" value={r.slots} onChange={(e) => updRoles((rs) => rs.map((x) => x.key === r.key ? { ...x, slots: Math.max(1, Math.min(100, Math.round(Number(e.target.value) || 1))) } : x))} aria-label="Slots needed" data-testid={`input-role-slots-${r.key}`} /> spots
                        </label>
                        <button className="icon-btn shrink-0" onClick={() => updRoles((rs) => rs.filter((x) => x.key !== r.key))} aria-label={`Remove ${r.name}`} data-testid={`button-remove-role-${r.key}`}><Icon name="trash" size={16} /></button>
                      </div>
                      <input className="field field-compact mt-2 text-[14px]" value={r.instruction} maxLength={2000} placeholder="One-line instruction for the volunteer" onChange={(e) => updRoles((rs) => rs.map((x) => x.key === r.key ? { ...x, instruction: e.target.value } : x))} aria-label="Instruction" data-testid={`input-role-instruction-${r.key}`} />
                    </li>
                  ))}
                </ul>
                <button className="btn btn-ghost btn-sm mt-2" onClick={() => updRoles((rs) => [...rs, { key: k(), name: "", slots: 1, instruction: "" }])} data-testid="button-add-role"><Icon name="plus" size={14} /> Add role</button>
              </section>

              <div className="flex flex-wrap gap-3 justify-end">
                <span className="text-[14px] text-muted-ink self-center">{taskCount} tasks and {roles.length} roles will be created in To do.</span>
                <button className="btn btn-primary" onClick={accept} disabled={acceptM.isPending || draftM.isPending} data-testid="button-accept-plan-bottom"><Icon name="check" size={16} /> {acceptM.isPending ? "Accepting" : "Accept plan"}</button>
              </div>
            </>
          ) : ev.plan_accepted ? (
            <>
              <Overview b={b} onEdit={() => setEditEvent(true)} />
              <SavedPlanEditor bundle={b} />
            </>
          ) : (
            <section className="glass relative rise !p-7 md:!p-9" data-testid="panel-no-draft">
              <Star size={14} className="absolute top-5 right-6" />
              {ev.plan_accepted ? (
                <>
                  <h2 className="font-display text-[26px] leading-tight">The plan is on the board.</h2>
                  <p className="text-muted-ink mt-2 max-w-[520px]">{ev.tasks_total} tasks and {ev.roles_count} roles. You can draft again to get extra ideas; accepting a new draft adds tasks, it does not remove any.</p>
                </>
              ) : (
                <>
                  <h2 className="font-display text-[26px] leading-tight">{b.tasks.length ? "This event already has a head start." : "Ready when you are."}</h2>
                  <p className="text-muted-ink mt-2 max-w-[520px]">{b.tasks.length ? "Tasks carried from the last event are already on the board. Drafting a plan is optional; it only adds." : "The helper reads your description, purpose and last event's lessons, then drafts grouped tasks and roles for you to edit."}</p>
                </>
              )}
              <div className="mt-6 flex flex-wrap gap-3">
                <button className="btn btn-primary" onClick={draft} disabled={draftM.isPending} data-testid="button-draft-plan"><Icon name="spark" size={16} /> {draftM.isPending ? "Drafting your plan" : ev.plan_accepted ? "Draft more ideas" : "Draft my plan"}</button>
                {(ev.plan_accepted || b.tasks.length > 0) && <Link href={`/app/events/${id}/tasks`} className="btn btn-secondary" data-testid="link-task-board">Open task board</Link>}
              </div>
              {draftM.isPending && <div className="mt-6 space-y-2" aria-live="polite">{[0, 1, 2].map((i) => <Skel key={i} className="h-10" />)}</div>}
            </section>
          )}
          {!ev.plan_accepted && <CarriedTasks b={b} />}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-7">
          {!ev.plan_accepted && <Overview b={b} onEdit={() => setEditEvent(true)} />}
          {b.previous && (
            <section className="ai-glass rise" data-testid="panel-previous-lesson">
              <div className="font-mono-ui text-[11px] uppercase tracking-[0.16em] mb-2 flex items-center gap-2" style={{ color: "#5A4A0A" }}><Icon name="loop" size={14} /> Pulled from {b.previous.event.name}</div>
              <p className="text-[14px] leading-relaxed">{b.previous.recap?.top_lesson || ev.carried_lesson || "No top lesson recorded last time."}</p>
              {(ev.carried_didnt || b.previous.recap?.what_didnt) && <p className="text-[13px] mt-2">Did not work: {ev.carried_didnt || b.previous.recap?.what_didnt}</p>}
            </section>
          )}
          {session && <p className="mono-label text-center">{session.ai_remaining} helper uses left this month</p>}
        </aside>
      </div>

      {editEvent && <EventDetailsDialog b={b} onClose={() => setEditEvent(false)} />}
      <ConfirmDialog
        open={confirmRedraft} onOpenChange={setConfirmRedraft}
        title="Replace this draft?" description="Redrafting replaces your edits on this page with a fresh draft. Tasks already on the board are not touched."
        confirmLabel="Redraft" onConfirm={() => { setConfirmRedraft(false); draft(); }}
      />
    </Shell>
  );
}
