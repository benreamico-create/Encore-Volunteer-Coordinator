import { useEffect, useState, type FormEvent } from "react";
import { useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListSponsors, useCreateSponsor, useUpdateSponsor, useDeleteSponsor, useCreateSponsorTask, useDraftSponsorEmail, useUpdateEvent,
  getListSponsorsQueryKey, getGetEventQueryKey, getGetDashboardQueryKey,
  type Sponsor, type SponsorInput, type SponsorInputStatus, type User,
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Shell, PageHeader } from "@/components/shell";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { MessageDialog } from "@/components/message-dialog";
import { Avatar, ErrorPanel, Icon, Skel, Star } from "@/components/brand";
import { dueLabel, errorMessage, errorStatus } from "@/lib/encore";
import { useEventBundle } from "@/lib/use-event";
import { useToast } from "@/hooks/use-toast";

const STATUSES: { v: SponsorInputStatus; label: string; cls: string; style?: React.CSSProperties }[] = [
  { v: "asked", label: "Asked", cls: "chip-open" },
  { v: "talking", label: "Talking", cls: "chip-progress" },
  { v: "yes", label: "Yes", cls: "chip-done" },
  { v: "declined", label: "Declined", cls: "chip-todo", style: { color: "#5E625A" } },
];
const statusOf = (s: string) => STATUSES.find((x) => x.v === s) ?? STATUSES[0];
const money = (n: number) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD", maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);

function validYmd(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
function parseAmount(s: string): number | null | "bad" {
  const t = s.replace(/[$,\s]/g, "");
  if (!t) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return "bad";
  const n = Number(t);
  return n > 1_000_000_000 ? "bad" : n;
}

function SponsorDialog({ open, onOpenChange, sponsor, organizers, onSave, saving }: {
  open: boolean; onOpenChange: (v: boolean) => void; sponsor: Sponsor | null; organizers: User[]; onSave: (d: SponsorInput) => void; saving: boolean;
}) {
  const [name, setName] = useState(""); const [offer, setOffer] = useState(""); const [status, setStatus] = useState<SponsorInputStatus>("asked");
  const [owner, setOwner] = useState(""); const [amount, setAmount] = useState(""); const [step, setStep] = useState(""); const [due, setDue] = useState("");
  const [err, setErr] = useState<{ field: string; msg: string } | null>(null);
  useEffect(() => {
    if (!open) return;
    setName(sponsor?.name ?? ""); setOffer(sponsor?.offer_text ?? ""); setStatus(sponsor?.status ?? "asked");
    setOwner(sponsor?.owner_user_id ? String(sponsor.owner_user_id) : ""); setAmount(sponsor?.amount != null ? String(sponsor.amount) : "");
    setStep(sponsor?.next_step_text ?? ""); setDue(sponsor?.next_step_due?.slice(0, 10) ?? ""); setErr(null);
  }, [open, sponsor]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setErr({ field: "name", msg: "Give the sponsor a name." });
    const a = parseAmount(amount);
    if (a === "bad") return setErr({ field: "amount", msg: "Type an amount like 250 or 1200.50, or leave it blank." });
    if (due && !validYmd(due)) return setErr({ field: "due", msg: "Use a real date in YYYY-MM-DD format." });
    onSave({ name: name.trim(), offer_text: offer.trim(), status, owner_user_id: owner ? Number(owner) : null, amount: a, next_step_text: step.trim(), next_step_due: due || null });
  };
  const inv = (f: string) => (err?.field === f ? true : undefined);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-0 rounded-[20px] p-0 max-w-[520px] max-h-[92dvh] overflow-auto" style={{ background: "#FEFCF0" }}>
        <form onSubmit={submit} className="p-6 sm:p-7 space-y-4" noValidate>
          <div><div className="mono-label mb-1">{sponsor ? "Edit sponsor" : "New sponsor"}</div><DialogTitle className="font-display text-[26px] font-normal leading-tight">{sponsor ? sponsor.name : "Add a sponsor"}</DialogTitle><DialogDescription className="sr-only">Sponsor details</DialogDescription></div>
          <div><label className="field-label" htmlFor="s-name">Name</label><input id="s-name" className="field" value={name} maxLength={160} onChange={(e) => setName(e.target.value)} placeholder="Bowness Print Co." autoFocus aria-invalid={inv("name")} data-testid="input-sponsor-name" /></div>
          <div><label className="field-label" htmlFor="s-offer">What they give</label><input id="s-offer" className="field" value={offer} maxLength={2000} onChange={(e) => setOffer(e.target.value)} placeholder="Print and signage" data-testid="input-sponsor-offer" /></div>
          <fieldset>
            <legend className="field-label">Status</legend>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="radiogroup">
              {STATUSES.map((s) => (
                <button type="button" key={s.v} role="radio" aria-checked={status === s.v} onClick={() => setStatus(s.v)}
                  className="h-11 rounded-[12px] text-[14px] font-semibold transition-colors"
                  style={status === s.v ? { background: "var(--forest)", color: "#fff" } : { background: "rgba(255,255,255,0.8)", border: "1px solid rgba(31,30,29,0.18)", color: "var(--ink)" }}
                  data-testid={`option-status-${s.v}`}>{s.label}</button>
              ))}
            </div>
          </fieldset>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className="field-label" htmlFor="s-owner">Owner</label>
              <select id="s-owner" className="field" value={owner} onChange={(e) => setOwner(e.target.value)} data-testid="select-sponsor-owner">
                <option value="">Nobody yet</option>
                {organizers.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select></div>
            <div><label className="field-label" htmlFor="s-amount">Amount (optional, CAD)</label><input id="s-amount" inputMode="decimal" className="field" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="500" aria-invalid={inv("amount")} data-testid="input-sponsor-amount" /></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_170px] gap-3">
            <div><label className="field-label" htmlFor="s-step">Next step</label><input id="s-step" className="field" value={step} maxLength={300} onChange={(e) => setStep(e.target.value)} placeholder="Send the booth map" data-testid="input-sponsor-next-step" /></div>
            <div><label className="field-label" htmlFor="s-due">By (YYYY-MM-DD)</label><input id="s-due" type="date" className="field" value={due} onChange={(e) => setDue(e.target.value)} aria-invalid={inv("due")} data-testid="input-sponsor-next-due" /></div>
          </div>
          {err && <p className="field-error" role="alert">{err.msg}</p>}
          <div className="flex flex-wrap justify-end gap-3"><button type="button" className="btn btn-secondary" onClick={() => onOpenChange(false)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={saving} data-testid="button-save-sponsor">{saving ? "Saving" : sponsor ? "Save sponsor" : "Add sponsor"}</button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function GoalEditor({ goal, onSave, saving }: { goal: number | null; onSave: (n: number | null) => void; saving: boolean }) {
  const [editing, setEditing] = useState(false); const [v, setV] = useState(""); const [err, setErr] = useState("");
  if (!editing) return (
    <button className="text-[13px] underline underline-offset-2 text-muted-ink hover:text-[var(--ink)]" onClick={() => { setV(goal != null ? String(goal) : ""); setErr(""); setEditing(true); }} data-testid="button-edit-goal">
      {goal != null ? `of a ${money(goal)} goal` : "Set a goal"}
    </button>
  );
  const save = (e: FormEvent) => {
    e.preventDefault();
    const a = parseAmount(v);
    if (a === "bad") return setErr("Numbers only, or leave blank.");
    onSave(a); setEditing(false);
  };
  return (
    <form onSubmit={save} className="mt-1">
      <div className="flex gap-2 items-center">
        <label className="sr-only" htmlFor="goal">Sponsor goal</label>
        <input id="goal" inputMode="decimal" className="field field-compact w-28" value={v} onChange={(e) => setV(e.target.value)} placeholder="Goal" autoFocus aria-invalid={err ? true : undefined} onKeyDown={(e) => e.key === "Escape" && setEditing(false)} data-testid="input-goal" />
        <button type="submit" className="btn btn-primary btn-sm" disabled={saving} data-testid="button-save-goal">Save</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(false)}>Cancel</button>
      </div>
      {err && <p className="field-error" role="alert">{err}</p>}
    </form>
  );
}

export default function SponsorsPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useEventBundle(id);
  const sq = useListSponsors(id, { query: { queryKey: getListSponsorsQueryKey(id) } });
  const createS = useCreateSponsor(); const updateS = useUpdateSponsor(); const deleteS = useDeleteSponsor();
  const taskS = useCreateSponsorTask(); const draftS = useDraftSponsorEmail(); const updateEvent = useUpdateEvent();
  const [dlg, setDlg] = useState<{ sponsor: Sponsor | null } | null>(null);
  const [del, setDel] = useState<Sponsor | null>(null);
  const [draft, setDraft] = useState<{ sponsor: Sponsor; text: string; notice: string; loading: boolean } | null>(null);
  const [taskBusy, setTaskBusy] = useState<number | null>(null);

  const fail = (title: string) => (e: unknown) => toast({ title, description: errorMessage(e), variant: "destructive" });
  const b = q.data;
  const refresh = () => {
    qc.invalidateQueries({ queryKey: getListSponsorsQueryKey(id) });
    qc.invalidateQueries({ queryKey: getGetEventQueryKey(id) });
    if (b) qc.invalidateQueries({ queryKey: getGetDashboardQueryKey(b.series.id) });
  };

  if (q.isLoading || sq.isLoading) return <Shell><div data-testid="status-loading-sponsors"><Skel className="h-10 w-56 mb-3" /><Skel className="h-4 w-72 mb-8" /><div className="grid sm:grid-cols-3 gap-4 mb-6">{[0, 1, 2].map((i) => <Skel key={i} className="h-28 !rounded-2xl" />)}</div><div className="grid lg:grid-cols-[1fr_320px] gap-6"><Skel className="h-80 !rounded-2xl" /><Skel className="h-56 !rounded-2xl" /></div></div></Shell>;
  if (q.isError || !b) {
    const nf = errorStatus(q.error) === 404 || errorStatus(q.error) === 403;
    return <Shell><ErrorPanel title={nf ? "Event not found" : "That did not load"} message={nf ? "This event does not exist or belongs to someone else." : errorMessage(q.error)} onRetry={nf ? undefined : () => void q.refetch()} /></Shell>;
  }
  const ev = b.event;
  const list = sq.data ?? [];
  const ownerOf = (uid: number | null) => b.organizers.find((o) => o.id === uid) ?? null;
  const confirmed = list.filter((s) => s.status === "yes").reduce((n, s) => n + (s.amount ?? 0), 0);
  const inTalks = list.filter((s) => s.status === "asked" || s.status === "talking").length;
  const nextDue = [...list].filter((s) => s.next_step_due && s.status !== "declined").sort((a, c) => (a.next_step_due! < c.next_step_due! ? -1 : 1))[0] ?? null;
  const goal = ev.sponsor_goal_amount ?? null;
  const pct = goal ? Math.min(100, (confirmed / goal) * 100) : 0;
  const followUp = list.find((s) => s.status === "asked") ?? list.find((s) => s.status === "talking") ?? null;
  const withSteps = list.filter((s) => s.next_step_text.trim() && s.status !== "declined");

  const save = (d: SponsorInput) => {
    const ok = (t: string) => () => { toast({ title: t }); setDlg(null); refresh(); };
    if (dlg?.sponsor) updateS.mutate({ id, itemId: dlg.sponsor.id, data: d }, { onSuccess: ok("Sponsor saved"), onError: fail("Could not save sponsor") });
    else createS.mutate({ id, data: d }, { onSuccess: ok("Sponsor added"), onError: fail("Could not add sponsor") });
  };
  const setStatus = (s: Sponsor, status: SponsorInputStatus) => {
    const { id: _i, event_id: _e, created_at: _c, ...rest } = s;
    void _i; void _e; void _c;
    qc.setQueryData<Sponsor[]>(getListSponsorsQueryKey(id), (o) => o?.map((x) => (x.id === s.id ? { ...x, status } : x)));
    updateS.mutate({ id, itemId: s.id, data: { ...rest, status } }, { onSuccess: () => { toast({ title: `${s.name}: ${statusOf(status).label}` }); refresh(); }, onError: (e) => { fail("Could not change status")(e); refresh(); } });
  };
  const doDelete = (s: Sponsor) => {
    setDel(null);
    deleteS.mutate({ id, itemId: s.id }, { onSuccess: () => { toast({ title: `${s.name} removed` }); refresh(); }, onError: fail("Could not delete sponsor") });
  };
  const addTask = (s: Sponsor) => {
    setTaskBusy(s.id);
    taskS.mutate({ id, itemId: s.id }, {
      onSuccess: () => { toast({ title: "Added to tasks", description: s.next_step_text }); qc.invalidateQueries({ queryKey: getGetEventQueryKey(id) }); refresh(); },
      onError: fail("Could not add task"), onSettled: () => setTaskBusy(null),
    });
  };
  const openDraft = (s: Sponsor) => {
    setDraft({ sponsor: s, text: "", notice: "", loading: true });
    draftS.mutate({ id, itemId: s.id }, {
      onSuccess: (r) => setDraft((d) => (d && d.sponsor.id === s.id ? { ...d, text: r.message, notice: r.notice, loading: false } : d)),
      onError: (e) => { fail("Could not draft email")(e); setDraft(null); },
    });
  };

  return (
    <Shell event={{ id: ev.id, name: ev.name }}>
      <PageHeader title="Sponsors" subtitle={`${ev.name} · ${list.length} sponsor${list.length === 1 ? "" : "s"}`}
        actions={<button className="btn btn-primary" onClick={() => setDlg({ sponsor: null })} data-testid="button-add-sponsor"><Icon name="plus" size={15} /> Add sponsor</button>} />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <section className="glass rise relative" data-testid="stat-confirmed">
          <Star size={12} className="absolute top-4 right-4" />
          <div className="mono-label">Confirmed</div>
          <div className="font-display text-[32px] leading-tight mt-1" data-testid="text-confirmed-total">{money(confirmed)}</div>
          <GoalEditor goal={goal} saving={updateEvent.isPending} onSave={(n) => updateEvent.mutate({ id, data: { sponsor_goal_amount: n } }, { onSuccess: () => { toast({ title: n == null ? "Goal cleared" : "Goal saved" }); refresh(); }, onError: fail("Could not save goal") })} />
          {goal ? <div className="h-1.5 rounded-full mt-3 overflow-hidden" style={{ background: "rgba(55,68,46,0.1)" }} aria-hidden="true"><div className="h-full rounded-full origin-left" style={{ width: "100%", transform: `scaleX(${pct / 100})`, background: "var(--forest)", transition: "transform .5s cubic-bezier(.2,.8,.2,1)" }} /></div> : null}
        </section>
        <section className="glass rise" style={{ animationDelay: "60ms" }} data-testid="stat-in-talks">
          <div className="mono-label">In talks</div>
          <div className="font-display text-[32px] leading-tight mt-1" data-testid="text-in-talks">{inTalks}</div>
          <p className="text-[13px] text-muted-ink">Asked or talking</p>
        </section>
        <section className="glass rise" style={{ animationDelay: "120ms" }} data-testid="stat-next-due">
          <div className="mono-label">Next due</div>
          {nextDue ? (<>
            <div className="font-display text-[32px] leading-tight mt-1" data-testid="text-next-due">{dueLabel(nextDue.next_step_due)}</div>
            <p className="text-[13px] text-muted-ink truncate">{nextDue.next_step_text || "Next step"} · {nextDue.name}</p>
          </>) : (<><div className="font-display text-[32px] leading-tight mt-1 text-muted-ink" data-testid="text-next-due">None</div><p className="text-[13px] text-muted-ink">No dated next steps</p></>)}
        </section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px] gap-6 items-start">
        <section className="glass !p-0 min-w-0 overflow-hidden" data-testid="panel-sponsor-table">
          {sq.isError ? (
            <div className="p-6"><ErrorPanel title="Sponsors did not load" message={errorMessage(sq.error)} onRetry={() => void sq.refetch()} /></div>
          ) : list.length === 0 ? (
            <div className="text-center p-10" data-testid="panel-no-sponsors">
              <h2 className="font-display text-[22px]">No sponsors yet.</h2>
              <p className="text-muted-ink mt-1 max-w-[380px] mx-auto">Write down who you asked, what they might give and what happens next. A plain list beats a group chat.</p>
              <button className="btn btn-primary mt-5" onClick={() => setDlg({ sponsor: null })} data-testid="button-add-first-sponsor"><Icon name="plus" size={15} /> Add sponsor</button>
            </div>
          ) : (<>
            <div className="hidden md:grid grid-cols-[minmax(0,1.6fr)_120px_56px_96px_minmax(0,1.4fr)_88px] gap-3 px-5 py-3 border-b mono-label" style={{ borderColor: "var(--line)" }}>
              <span>Sponsor</span><span>Status</span><span>Owner</span><span className="text-right">Amount</span><span>Next step</span><span className="sr-only">Actions</span>
            </div>
            <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
              {list.map((s) => {
                const o = ownerOf(s.owner_user_id);
                return (
                  <li key={s.id} className="grid grid-cols-[1fr_auto] md:grid-cols-[minmax(0,1.6fr)_120px_56px_96px_minmax(0,1.4fr)_88px] gap-x-3 gap-y-2 px-5 py-3.5 items-center" data-testid={`row-sponsor-${s.id}`}>
                    <div className="min-w-0">
                      <div className="text-[15px] font-semibold break-words" data-testid={`text-sponsor-name-${s.id}`}>{s.name}</div>
                      {s.offer_text && <div className="text-[13px] text-muted-ink truncate">{s.offer_text}</div>}
                    </div>
                    <div className="md:order-none">
                      <label className="sr-only" htmlFor={`st-${s.id}`}>Status for {s.name}</label>
                      <span className="relative inline-flex">
                        <span className={`chip ${statusOf(s.status).cls} pr-6`} style={statusOf(s.status).style} aria-hidden="true">{statusOf(s.status).label}</span>
                        <Icon name="chevron" size={12} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: s.status === "yes" ? "#fff" : undefined }} />
                        <select id={`st-${s.id}`} className="absolute inset-0 opacity-0 cursor-pointer" value={s.status} onChange={(e) => setStatus(s, e.target.value as SponsorInputStatus)} data-testid={`select-status-${s.id}`}>
                          {STATUSES.map((x) => <option key={x.v} value={x.v}>{x.label}</option>)}
                        </select>
                      </span>
                    </div>
                    <div className="flex items-center gap-2 min-w-0" title={o?.name ?? "No owner"}>
                      {o ? <Avatar name={o.name} size={28} /> : <span className="w-7 h-7 rounded-full border-[1.5px] border-dashed" style={{ borderColor: "#9C9A92" }} aria-hidden="true" />}
                      <span className="md:sr-only text-[13px] text-muted-ink truncate">{o?.name ?? "No owner"}</span>
                    </div>
                    <div className="text-right font-mono-ui text-[14px]" data-testid={`text-sponsor-amount-${s.id}`}>{s.amount != null ? money(s.amount) : <span className="text-muted-ink">—</span>}</div>
                    <div className="min-w-0 col-span-2 md:col-span-1">
                      {s.next_step_text ? (<>
                        <div className="text-[14px] break-words">{s.next_step_text}</div>
                        {s.next_step_due && <div className="text-[12px] text-muted-ink flex items-center gap-1 font-mono-ui"><Icon name="calendar" size={12} /> {dueLabel(s.next_step_due)}</div>}
                      </>) : <span className="text-[13px] text-muted-ink">No next step</span>}
                    </div>
                    <div className="flex gap-0.5 col-span-2 md:col-span-1 justify-end -mr-2">
                      <button className="icon-btn !w-9 !h-9" aria-label={`Edit ${s.name}`} onClick={() => setDlg({ sponsor: s })} data-testid={`button-edit-sponsor-${s.id}`}><Icon name="plan" size={16} /></button>
                      <button className="icon-btn !w-9 !h-9" aria-label={`Delete ${s.name}`} style={{ color: "#8A3426" }} onClick={() => setDel(s)} data-testid={`button-delete-sponsor-${s.id}`}><Icon name="trash" size={16} /></button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </>)}
        </section>

        <aside className="space-y-4 lg:sticky lg:top-7">
          <section className="ai-glass relative" data-testid="panel-sponsor-helper">
            <div className="mono-label flex items-center gap-2" style={{ color: "#5A4E10" }}><Icon name="spark" size={14} /> Helper</div>
            {followUp ? (<>
              <p className="text-[15px] mt-2 leading-snug">{followUp.name} is still {followUp.status === "asked" ? "waiting on an answer" : "in talks"}. Want a short follow-up email you can edit?</p>
              <button className="btn btn-gold btn-sm mt-3 !bg-[#FEFCF0]" onClick={() => openDraft(followUp)} disabled={draftS.isPending} data-testid={`button-draft-email-${followUp.id}`}><Icon name="spark" size={14} /> Draft email</button>
            </>) : <p className="text-[15px] mt-2 leading-snug">Nobody is waiting on a reply. When you ask someone, a follow-up draft shows up here.</p>}
            {list.length > 1 && (
              <div className="mt-3">
                <label className="text-[12px] font-semibold" htmlFor="draft-pick">Or draft for</label>
                <select id="draft-pick" className="field field-compact mt-1" value="" onChange={(e) => { const s = list.find((x) => x.id === Number(e.target.value)); if (s) openDraft(s); }} data-testid="select-draft-sponsor">
                  <option value="">Pick a sponsor</option>
                  {list.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            )}
            <p className="text-[12px] mt-3" style={{ color: "#5A4E10" }}>Copy only. Encore never sends it.</p>
          </section>

          <section className="glass" data-testid="panel-next-steps">
            <h2 className="font-display text-[20px]">Next steps become tasks</h2>
            <p className="text-[13px] text-muted-ink mb-2">Adds the step and its date to the board, assigned to the owner.</p>
            {withSteps.length === 0 ? <p className="text-[14px] text-muted-ink py-2">No open next steps yet.</p> : (
              <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
                {withSteps.map((s) => (
                  <li key={s.id} className="py-2.5 flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-semibold break-words">{s.next_step_text}</div>
                      <div className="text-[12px] text-muted-ink truncate">{s.name}{s.next_step_due ? ` · ${dueLabel(s.next_step_due)}` : ""}</div>
                    </div>
                    <button className="btn btn-secondary btn-sm shrink-0" disabled={taskBusy === s.id} onClick={() => addTask(s)} data-testid={`button-add-task-${s.id}`}>{taskBusy === s.id ? "Adding" : <><Icon name="plus" size={13} /> Add to tasks</>}</button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>

      <SponsorDialog open={!!dlg} onOpenChange={(v) => !v && setDlg(null)} sponsor={dlg?.sponsor ?? null} organizers={b.organizers} onSave={save} saving={createS.isPending || updateS.isPending} />
      <ConfirmDialog open={!!del} onOpenChange={(v) => !v && setDel(null)} title={del ? `Delete ${del.name}?` : ""} danger confirmLabel="Delete sponsor"
        description="This removes the sponsor and its next step from this board. Tasks already added stay on the board." onConfirm={() => del && doDelete(del)} />
      <MessageDialog open={!!draft} onOpenChange={(v) => !v && setDraft(null)} title={draft ? `Follow-up to ${draft.sponsor.name}` : ""} initial={draft?.text ?? ""} notice={draft?.notice || undefined} loading={draft?.loading} subject={`${ev.name}: a quick follow-up`} />
    </Shell>
  );
}
