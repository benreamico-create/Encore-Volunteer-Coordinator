import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useSaveRecap, useDraftStarter, getGetEventQueryKey, getGetDashboardQueryKey, getGetSessionQueryKey,
  type RecapInput, type Resource, type ResourceKind, type StarterDraft,
} from "@workspace/api-client-react";
import { Shell, PageHeader } from "@/components/shell";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { ErrorPanel, Icon, Skel } from "@/components/brand";
import { errorMessage, errorStatus, fmtDate } from "@/lib/encore";
import { useEventBundle } from "@/lib/use-event";
import { useEncore } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";

const KINDS: ResourceKind[] = ["venue", "sponsor", "vendor", "speaker", "other"];
type Res = Resource & { key: string };
type Form = { what_worked: string; what_didnt: string; top_lesson: string; resources: Res[]; items: string[] };
let n = 0; const rk = () => `res${++n}`;

const snapshot = (f: Form) => JSON.stringify({ ...f, resources: f.resources.map(({ key: _k, ...r }) => r) });

function toInput(f: Form, legacy: RecapInput | null | undefined): RecapInput {
  return {
    // Retain the legacy columns unchanged; this screen no longer displays or edits them.
    registered: legacy?.registered ?? 0, attended: legacy?.attended ?? 0,
    what_worked: f.what_worked, what_didnt: f.what_didnt, top_lesson: f.top_lesson,
    rating_overall: legacy?.rating_overall ?? 3, rating_venue: legacy?.rating_venue ?? 3, rating_volunteers: legacy?.rating_volunteers ?? 3,
    resources: f.resources.filter((r) => r.name.trim()).map(({ key: _k, ...r }) => ({ ...r, name: r.name.trim() })),
    items: f.items.map((s) => s.trim()).filter(Boolean),
  };
}

export default function RecapPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { session } = useEncore();
  const q = useEventBundle(id, 0);
  const save = useSaveRecap();
  const starter = useDraftStarter();
  const [f, setF] = useState<Form | null>(null);
  const saved = useRef("");
  const initFor = useRef<number | null>(null);
  const [draft, setDraft] = useState<StarterDraft | null>(null);
  const [draftItems, setDraftItems] = useState<string[]>([]);
  const [delRes, setDelRes] = useState<Res | null>(null);
  const [leaveConfirm, setLeaveConfirm] = useState(false);

  const b = q.data;
  useEffect(() => {
    if (!b || initFor.current === id) return;
    initFor.current = id;
    const r = b.recap;
    const form: Form = {
      what_worked: r?.what_worked ?? "", what_didnt: r?.what_didnt ?? "", top_lesson: r?.top_lesson ?? "",
      resources: (r?.resources?.length ? r.resources : b.resources).map((x) => ({ ...x, key: rk() })),
      items: r?.items ?? [],
    };
    setF(form);
    saved.current = r ? snapshot(form) : "";
  }, [b, id]);

  const dirty = useMemo(() => !!f && snapshot(f) !== saved.current, [f]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((o) => (o ? { ...o, [k]: v } : o));
  const setRes = (key: string, patch: Partial<Res>) => setF((o) => (o ? { ...o, resources: o.resources.map((r) => (r.key === key ? { ...r, ...patch } : r)) } : o));

  const doSave = (then?: () => void) => {
    if (!f) return;
    const snap = snapshot(f);
    save.mutate({ id, data: toInput(f, b?.recap) }, {
      onSuccess: async () => {
        saved.current = snap;
        // Keep newly generated resource IDs without overwriting edits made while saving.
        const refreshed = await q.refetch();
        const available = [...(refreshed.data?.resources ?? [])];
        const identities = new Map<string, number>();
        for (const resource of f.resources.filter(r => r.name.trim())) {
          const at = available.findIndex(r => resource.id ? r.id === resource.id : r.name === resource.name.trim() && r.kind === resource.kind);
          if (at >= 0) {
            const [matched] = available.splice(at, 1);
            if (matched.id) identities.set(resource.key, matched.id);
          }
        }
        const withIds = (form: Form): Form => ({ ...form, resources: form.resources.map(r => identities.has(r.key) ? { ...r, id: identities.get(r.key) } : r) });
        saved.current = snapshot(withIds(f));
        setF(o => o ? withIds(o) : o);
        if (b) qc.invalidateQueries({ queryKey: getGetDashboardQueryKey(b.series.id) });
        toast({ title: "Wrap-up saved" });
        then?.();
      },
      onError: (er) => toast({ title: "Could not save the wrap-up", description: errorMessage(er), variant: "destructive" }),
    });
  };
  const draftStarter = () => {
    if (!f) return;
    starter.mutate({ data: { event_id: id, recap: toInput(f, b?.recap) } }, {
      onSuccess: (d) => { setDraft(d); setDraftItems(d.items.slice(0, 7)); qc.invalidateQueries({ queryKey: getGetSessionQueryKey() }); },
      onError: (er) => toast({ title: "Could not draft the starter", description: errorMessage(er), variant: "destructive" }),
    });
  };
  const goNext = () => {
    if (!b?.recap && !dirty) { toast({ title: "Save the wrap-up first", description: "The next event starts from a saved wrap-up.", variant: "destructive" }); return; }
    if (dirty || !b?.recap) setLeaveConfirm(true); else navigate(`/app/events/${id}/next`);
  };

  if (q.isLoading || (b && !f)) return <Shell><div data-testid="status-loading-wrapup"><Skel className="h-10 w-40 mb-3" /><Skel className="h-4 w-60 mb-8" /><Skel className="h-72 !rounded-2xl" /></div></Shell>;
  if (q.isError || !b || !f) {
    const nf = errorStatus(q.error) === 404 || errorStatus(q.error) === 403;
    return <Shell><ErrorPanel title={nf ? "Event not found" : "That did not load"} message={nf ? "This event does not exist or belongs to someone else." : errorMessage(q.error)} onRetry={nf ? undefined : () => void q.refetch()} /></Shell>;
  }
  const ev = b.event;
  return (
    <Shell event={{ id: ev.id, name: ev.name }}>
      <PageHeader title="Wrap-up" subtitle={`${ev.name} · ${fmtDate(ev.starts_at, ev.timezone)}`}
        actions={<>
          <button className="btn btn-secondary" onClick={() => doSave()} disabled={save.isPending || !dirty} data-testid="button-save-wrapup">{save.isPending ? "Saving" : dirty ? "Save wrap-up" : "Saved"}</button>
          <button className="btn btn-primary" onClick={goNext} disabled={save.isPending} data-testid="button-create-next"><Icon name="loop" size={16} /> Create next event from this one</button>
        </>} />
      {dirty && <div className="mono-label mb-4 rise" style={{ color: "#8A7330" }} data-testid="text-unsaved">Unsaved changes</div>}
      <div className="grid lg:grid-cols-[1fr_340px] gap-6 items-start">
        <div className="space-y-4 min-w-0">
          <section className="glass space-y-4">
            {([["what_worked", "What worked", "The demo order kept energy up."], ["what_didnt", "What did not", "Sign-up opened too late; check-in was short-handed."], ["top_lesson", "Top lesson", "Open volunteer sign-up three weeks out."]] as const).map(([k, l, ph]) => (
              <div key={k}><label className="field-label" htmlFor={`t-${k}`}>{l}</label><textarea id={`t-${k}`} className="field" rows={k === "top_lesson" ? 2 : 3} maxLength={5000} value={f[k]} placeholder={ph} onChange={(e) => set(k, e.target.value)} data-testid={`input-${k}`} /></div>
            ))}
          </section>
          <section className="glass" data-testid="panel-resources">
            <div className="flex items-center justify-between mb-1"><h2 className="font-display text-[20px]">Resources</h2><span className="font-display text-[16px] text-muted-ink">Use again?</span></div>
            <p className="text-[13px] text-muted-ink mb-3">Venues, sponsors, vendors and speakers you used. Those marked "use again" carry into the next event.</p>
            <ul className="space-y-2.5">
              {f.resources.map((r) => (
                <li key={r.key} className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.5)", border: "1px solid var(--line)" }} data-testid={`row-resource-${r.key}`}>
                  <div className="flex flex-wrap items-center gap-2">
                    <select className="field field-compact w-[110px]" value={r.kind} onChange={(e) => setRes(r.key, { kind: e.target.value as ResourceKind })} aria-label="Kind">{KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select>
                    <input className="field field-compact flex-1 min-w-[140px] font-semibold" value={r.name} maxLength={200} placeholder="Name" onChange={(e) => setRes(r.key, { name: e.target.value })} aria-label="Name" data-testid={`input-resource-name-${r.key}`} />
                    <button type="button" onClick={() => setRes(r.key, { use_again: !r.use_again })} aria-pressed={r.use_again} className={`chip h-9 px-3.5 ${r.use_again ? "chip-done" : "chip-todo"}`} data-testid={`toggle-use-again-${r.key}`}>{r.use_again ? <><Icon name="check" size={12} /> Use again</> : "Not again"}</button>
                    <button type="button" className="icon-btn" onClick={() => setDelRes(r)} aria-label="Remove resource" data-testid={`button-remove-resource-${r.key}`}><Icon name="trash" size={16} /></button>
                  </div>
                  <input className="field field-compact mt-2 text-[14px]" value={r.note} maxLength={2000} placeholder="Note: what it cost, who to ask, what to change" onChange={(e) => setRes(r.key, { note: e.target.value })} aria-label="Note" />
                </li>
              ))}
            </ul>
            {f.resources.length === 0 && <p className="text-[14px] text-muted-ink py-2">No resources yet.</p>}
            <button className="btn btn-ghost btn-sm mt-2" disabled={f.resources.length >= 50} onClick={() => set("resources", [...f.resources, { key: rk(), name: "", kind: "venue", note: "", use_again: true }])} data-testid="button-add-resource"><Icon name="plus" size={14} /> Add resource</button>
          </section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-7">
          <section className="ai-glass" data-testid="panel-starter">
            <div className="flex items-center gap-2 font-bold text-[15px]"><Icon name="spark" size={16} /> Next event starter</div>
            <p className="text-[12px] opacity-80 mt-1 mb-3">Edit before saving. Written from your notes only.</p>
            <div className="mono-label !text-[#5A4A0A] mb-1.5">On this wrap-up</div>
            <ol className="space-y-1.5">
              {f.items.map((it, i) => (
                <li key={i} className="flex gap-1.5 items-center">
                  <span className="text-[13px] w-5 shrink-0">{i + 1}.</span>
                  <input className="field field-compact flex-1 text-[14px]" style={{ background: "rgba(255,255,255,0.75)" }} value={it} maxLength={1000} onChange={(e) => set("items", f.items.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`Item ${i + 1}`} data-testid={`input-item-${i}`} />
                  <button className="w-8 h-8 rounded-full inline-flex items-center justify-center hover:bg-white/50" onClick={() => set("items", f.items.filter((_, j) => j !== i))} aria-label="Remove item"><Icon name="x" size={14} /></button>
                </li>
              ))}
            </ol>
            {f.items.length === 0 && <p className="text-[13px]">No action items yet. Draft some or add your own.</p>}
            <div className="flex flex-wrap gap-2 mt-2.5">
              <button className="btn btn-sm" style={{ background: "rgba(255,255,255,0.6)", border: "1px solid rgba(201,168,76,0.9)", color: "#3A3200" }} disabled={f.items.length >= 7} onClick={() => set("items", [...f.items, ""])} data-testid="button-add-item"><Icon name="plus" size={13} /> Add</button>
              <button className="btn btn-sm" style={{ background: "#37442E", color: "#fff" }} disabled={starter.isPending} onClick={draftStarter} data-testid="button-draft-starter"><Icon name="spark" size={13} /> {starter.isPending ? "Drafting" : "Draft from notes"}</button>
            </div>
            {starter.isPending && <div className="mt-3 space-y-1.5"><div className="skel h-8" /><div className="skel h-8" /></div>}
            {draft && !starter.isPending && (
              <div className="mt-4 rounded-xl p-3" style={{ background: "rgba(255,255,255,0.65)" }} data-testid="panel-starter-draft">
                <div className="mono-label !text-[#5A4A0A] mb-1">AI draft</div>
                {draft.notice && <p className="text-[12px] italic mb-2" data-testid="text-starter-notice">{draft.notice}</p>}
                <ol className="space-y-1.5">
                  {draftItems.map((it, i) => (
                    <li key={i} className="flex gap-1.5 items-center">
                      <input className="field field-compact flex-1 text-[14px]" value={it} maxLength={1000} onChange={(e) => setDraftItems((d) => d.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`Draft item ${i + 1}`} />
                      <button className="w-8 h-8 rounded-full inline-flex items-center justify-center hover:bg-black/5" onClick={() => setDraftItems((d) => d.filter((_, j) => j !== i))} aria-label="Remove draft item"><Icon name="x" size={14} /></button>
                    </li>
                  ))}
                </ol>
                <p className="text-[12px] mt-2">{draftItems.filter((s) => s.trim()).length} items. Aim for 3 to 7.</p>
                <div className="flex gap-2 mt-2">
                  <button className="btn btn-sm" style={{ background: "#37442E", color: "#fff" }} disabled={!draftItems.some((s) => s.trim())} onClick={() => { set("items", draftItems.map((s) => s.trim()).filter(Boolean).slice(0, 7)); setDraft(null); toast({ title: "Applied to wrap-up", description: "Save the wrap-up to keep it." }); }} data-testid="button-apply-starter">Apply to wrap-up</button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setDraft(null)}>Discard</button>
                </div>
              </div>
            )}
            <div className="text-[11px] font-mono-ui uppercase tracking-[0.1em] mt-3 text-center" style={{ color: "#5A4A0A" }}>{draft?.ai_remaining ?? session?.ai_remaining ?? 0} helper uses left</div>
          </section>
          {b.recap && !dirty && <p className="text-[13px] text-muted-ink text-center">Saved. This wrap-up now shows on your dashboard.</p>}
        </aside>
      </div>

      <ConfirmDialog open={!!delRes} onOpenChange={(v) => !v && setDelRes(null)} title="Remove this resource?" danger confirmLabel="Remove" description={delRes ? `${delRes.name || "This row"} will be removed when you save the wrap-up.` : ""} onConfirm={() => { if (delRes) set("resources", f.resources.filter((r) => r.key !== delRes.key)); setDelRes(null); }} />
      <ConfirmDialog open={leaveConfirm} onOpenChange={setLeaveConfirm} title="Save the wrap-up first?" confirmLabel="Save and continue"
        description="The next event is built from the saved wrap-up. Your changes will be saved, then you choose what to carry over."
        onConfirm={() => { setLeaveConfirm(false); doSave(() => navigate(`/app/events/${id}/next`)); }} />
    </Shell>
  );
}
