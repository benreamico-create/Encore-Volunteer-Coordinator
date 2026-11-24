import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateRole, useUpdateRole, useDeleteRole, useRemoveVolunteer, useUpdateEvent, useGetReminder, useSendReminder,
  getGetEventQueryKey, getGetReminderQueryKey, useGetEventMap, getGetEventMapQueryKey,
  type EventBundle, type Role, type Volunteer, type EventUpdate,
} from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Shell, PageHeader } from "@/components/shell";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Avatar, ErrorPanel, Icon, Skel, Star } from "@/components/brand";
import { copyText, errorMessage, errorStatus, fmtInTz, publicOrigin } from "@/lib/encore";
import { useEventBundle } from "@/lib/use-event";
import { useToast } from "@/hooks/use-toast";

function RoleDialog({ open, onOpenChange, role, onSave, saving }: { open: boolean; onOpenChange: (v: boolean) => void; role: Role | null; onSave: (d: { name: string; instruction: string; slots_needed: number }) => void; saving: boolean }) {
  const [name, setName] = useState(""); const [instruction, setInstruction] = useState(""); const [slots, setSlots] = useState("2"); const [err, setErr] = useState("");
  useEffect(() => { if (open) { setName(role?.name ?? ""); setInstruction(role?.instruction ?? ""); setSlots(String(role?.slots_needed ?? 2)); setErr(""); } }, [open, role]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = Number(slots);
    if (!name.trim()) return setErr("Name the role.");
    if (!Number.isInteger(n) || n < 1 || n > 100) return setErr("Spots must be between 1 and 100.");
    if (role && n < role.filled) return setErr(`${role.filled} people already signed up. Remove some before lowering below that.`);
    onSave({ name: name.trim(), instruction: instruction.trim(), slots_needed: n });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-0 rounded-[20px] p-0 max-w-[480px]" style={{ background: "#FEFCF0" }}>
        <form onSubmit={submit} className="p-7 space-y-4">
          <div><div className="mono-label mb-1">{role ? "Edit role" : "New role"}</div><DialogTitle className="font-display text-[26px] font-normal">{role ? role.name : "Add a volunteer role"}</DialogTitle><DialogDescription className="sr-only">Role details</DialogDescription></div>
          <div><label className="field-label" htmlFor="r-name">Role name</label><input id="r-name" className="field" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Check-in desk" autoFocus data-testid="input-role-name" /></div>
          <div><label className="field-label" htmlFor="r-ins">One-line instruction</label><textarea id="r-ins" className="field" rows={2} value={instruction} maxLength={2000} onChange={(e) => setInstruction(e.target.value)} placeholder="Arrive 30 minutes early. Greet people and tick names." data-testid="input-role-instruction" /></div>
          <div><label className="field-label" htmlFor="r-slots">Spots needed</label><input id="r-slots" inputMode="numeric" className="field w-28" value={slots} onChange={(e) => setSlots(e.target.value.replace(/\D/g, ""))} data-testid="input-role-slots" /></div>
          {err && <p className="field-error" role="alert">{err}</p>}
          <div className="flex justify-end gap-3"><button type="button" className="btn btn-secondary" onClick={() => onOpenChange(false)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={saving} data-testid="button-save-role">{saving ? "Saving" : role ? "Save role" : "Add role"}</button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ToggleRow({ label, hint, checked, onChange, testid, disabled }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void; testid: string; disabled?: boolean }) {
  return (
    <label className="flex items-center justify-between gap-4 py-3">
      <span><span className="text-[14px] font-semibold block">{label}</span><span className="text-[13px] text-muted-ink">{hint}</span></span>
      <Switch checked={checked} onCheckedChange={onChange} disabled={disabled} data-testid={testid} />
    </label>
  );
}

function DayDetails({ b, onSave, saving }: { b: EventBundle; onSave: (d: EventUpdate) => void; saving: boolean }) {
  const e = b.event;
  const [notes, setNotes] = useState(e.event_day_notes ?? "");
  const [contact, setContact] = useState(e.day_of_contact_text ?? "");
  const [place, setPlace] = useState(e.place_text ?? "");
  const init = useRef<number | null>(null);
  useEffect(() => {
    if (init.current !== e.id) { init.current = e.id; setNotes(e.event_day_notes ?? ""); setContact(e.day_of_contact_text ?? ""); setPlace(e.place_text ?? ""); }
  }, [e.id, e.event_day_notes, e.day_of_contact_text, e.place_text]);
  const dirty = notes !== (e.event_day_notes ?? "") || contact !== (e.day_of_contact_text ?? "") || place !== (e.place_text ?? "");
  return (
    <section className="glass" data-testid="panel-day-details">
      <div className="font-display text-[20px] mb-1">What volunteers see</div>
      <p className="text-[13px] text-muted-ink mb-4">Shown on each volunteer's private page.</p>
      <div className="space-y-3">
        <div><label className="field-label" htmlFor="d-place">Place</label><input id="d-place" className="field" value={place} maxLength={500} onChange={(x) => setPlace(x.target.value)} placeholder="Venue and room, or an address" data-testid="input-place" /></div>
        <div><label className="field-label" htmlFor="d-notes">Event-day notes</label><textarea id="d-notes" className="field" rows={3} value={notes} maxLength={5000} onChange={(x) => setNotes(x.target.value)} placeholder="Use the side door. Name tags are in the blue bin." data-testid="input-day-notes" /></div>
        <div><label className="field-label" htmlFor="d-contact">Day-of contact</label><input id="d-contact" className="field" value={contact} maxLength={500} onChange={(x) => setContact(x.target.value)} placeholder="Text Alex if anything comes up" data-testid="input-day-contact" /></div>
      </div>
      <button className="btn btn-primary btn-sm mt-4" disabled={!dirty || saving} onClick={() => onSave({ event_day_notes: notes, day_of_contact_text: contact, place_text: place })} data-testid="button-save-day-details">{saving ? "Saving" : dirty ? "Save details" : "Saved"}</button>
    </section>
  );
}

function ReminderModal({ b, open, onOpenChange }: { b: EventBundle; open: boolean; onOpenChange: (v: boolean) => void }) {
  const id = b.event.id;
  const { toast } = useToast();
  const r = useGetReminder(id, { query: { enabled: open && !!id, queryKey: getGetReminderQueryKey(id), retry: false, staleTime: 0 } });
  const [pick, setPick] = useState("general");
  const [text, setText] = useState("");
  const send=useSendReminder();
  const drafts = r.data?.drafts ?? [];
  const sel = pick === "general" ? null : drafts[Number(pick)] ?? null;
  useEffect(() => { if (open) setPick("general"); }, [open]);
  useEffect(() => { if (r.data) setText(sel ? sel.message : r.data.message); }, [r.data, sel]);
  const subject = `Reminder: ${b.event.name}`;
  const mailto = sel
    ? (sel.email ? `mailto:${encodeURIComponent(sel.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}` : null)
    : `mailto:?bcc=${encodeURIComponent((r.data?.recipients ?? []).join(","))}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-0 rounded-[20px] p-7 max-w-[580px] max-h-[92dvh] overflow-auto" style={{ background: "#FEFCF0" }}>
        <div className="mono-label">Draft, edit before sending</div>
        <DialogTitle className="font-display text-[26px] font-normal leading-tight">Reminder message</DialogTitle>
        <DialogDescription className="text-muted-ink text-[14px]">{r.data?.notice || "Encore does not send this for you. Copy it, or open it in your own mail app."}</DialogDescription>
        {r.isLoading ? <div className="space-y-2" data-testid="status-loading-reminder"><div className="skel h-10" /><div className="skel h-40" /></div>
          : r.isError || !r.data ? (
            <div className="rounded-xl p-4" style={{ background: "rgba(166,64,47,0.08)" }} role="alert">
              <p className="text-[14px]" style={{ color: "#8A3426" }}>{errorMessage(r.error, "The reminder could not be drafted.")}</p>
              <button className="btn btn-secondary btn-sm mt-3" onClick={() => void r.refetch()} data-testid="button-retry-reminder">Try again</button>
            </div>
          ) : (
            <>
              <div>
                <label className="field-label" htmlFor="rem-pick">Who is it for?</label>
                <select id="rem-pick" className="field" value={pick} onChange={(e) => setPick(e.target.value)} data-testid="select-reminder-target">
                  <option value="general">General message (everyone, no private links)</option>
                  {drafts.map((d, i) => <option key={i} value={String(i)}>{d.name}{d.email ? "" : " (no email, copy only)"}</option>)}
                </select>
                {sel && <p className="text-[12px] text-muted-ink mt-1.5">Includes {sel.name}'s private link. Send it only to them.</p>}
              </div>
              <textarea className="field text-[15px]" rows={8} value={text} onChange={(e) => setText(e.target.value)} data-testid="input-reminder-message" />
              {!sel && <p className="text-[13px] text-muted-ink">{r.data.recipients.length} volunteer{r.data.recipients.length === 1 ? "" : "s"} agreed to email. "Open in mail" puts them in BCC.</p>}
              <div className="flex flex-wrap justify-end gap-3">
                {r.data.email_enabled&&<button className="btn btn-primary" disabled={!text.trim()||send.isPending||(sel?!sel.email:!r.data.recipients.length)} onClick={()=>{
                  const count=sel?1:r.data!.recipients.length;
                  if(!window.confirm(`Send this ${sel?"private message to "+sel.name:`message to ${count} opted-in volunteers`}?`))return;
                  send.mutate({id,data:{message:text,volunteer_id:sel?.id??null}},{onSuccess:(result)=>toast({title:`Sent to ${result.sent}`,description:result.failed?`${result.failed} could not be sent.`:"Volunteer emails are logged."}),onError:(e)=>toast({title:"Reminder was not sent",description:errorMessage(e),variant:"destructive"})});
                }} data-testid="button-send-reminder">{send.isPending?"Sending…":sel?"Send to this volunteer":`Send to ${r.data.recipients.length}`}</button>}
                {mailto && <a className="btn btn-secondary" href={mailto} data-testid="link-reminder-mailto"><Icon name="link" size={15} /> Open in mail</a>}
                <button className="btn btn-primary" disabled={!text.trim()} onClick={async () => toast((await copyText(text)) ? { title: "Message copied" } : { title: "Could not copy", variant: "destructive" })} data-testid="button-copy-reminder"><Icon name="copy" size={15} /> Copy message</button>
              </div>
            </>
          )}
      </DialogContent>
    </Dialog>
  );
}

export default function VolunteersPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const qc = useQueryClient();
  const { toast } = useToast();
  const q = useEventBundle(id);
  const mapQ=useGetEventMap(id,{query:{enabled:!!id,queryKey:getGetEventMapQueryKey(id)}});
  const key = getGetEventQueryKey(id);
  const createRole = useCreateRole(); const updateRole = useUpdateRole(); const deleteRole = useDeleteRole();
  const removeVol = useRemoveVolunteer(); const updateEvent = useUpdateEvent();
  const [roleDlg, setRoleDlg] = useState<{ role: Role | null } | null>(null);
  const [delRole, setDelRole] = useState<Role | null>(null);
  const [delVol, setDelVol] = useState<Volunteer | null>(null);
  const [reminder, setReminder] = useState(false);

  const fail = (title: string) => (e: unknown) => toast({ title, description: errorMessage(e), variant: "destructive" });
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const b = q.data;
  useEffect(()=>{
    const target=Number(new URLSearchParams(window.location.search).get("role"));
    if(!target||!b?.roles.some((role)=>role.id===target))return;
    const timer=window.setTimeout(()=>{const card=document.querySelector<HTMLElement>(`[data-testid="card-role-${target}"]`);card?.scrollIntoView({behavior:"smooth",block:"center"});card?.focus({preventScroll:true});},100);
    return()=>window.clearTimeout(timer);
  },[b?.roles]);
  if (q.isLoading) return <Shell><div data-testid="status-loading-volunteers"><Skel className="h-10 w-56 mb-3" /><Skel className="h-4 w-72 mb-8" /><div className="grid lg:grid-cols-[1fr_360px] gap-6"><div className="grid sm:grid-cols-2 gap-4">{[0, 1, 2, 3].map((i) => <Skel key={i} className="h-40 !rounded-2xl" />)}</div><Skel className="h-72 !rounded-2xl" /></div></div></Shell>;
  if (q.isError || !b) {
    const nf = errorStatus(q.error) === 404 || errorStatus(q.error) === 403;
    return <Shell><ErrorPanel title={nf ? "Event not found" : "That did not load"} message={nf ? "This event does not exist or belongs to someone else." : errorMessage(q.error)} onRetry={nf ? undefined : () => void q.refetch()} /></Shell>;
  }
  const ev = b.event;
  const link = `${publicOrigin()}/join/${ev.signup_slug}`;
  const total = b.roles.reduce((n, r) => n + r.slots_needed, 0);
  const filled = b.roles.reduce((n, r) => n + r.filled, 0);
  const roleName = (rid: number) => b.roles.find((r) => r.id === rid)?.name ?? "Role removed";
   const recent = [...b.volunteers].sort((a, c) => +new Date(c.created_at) - +new Date(a.created_at));

  const toggle = (data: EventUpdate, msg: string) => {
    qc.setQueryData<EventBundle>(key, (o) => (o ? { ...o, event: { ...o.event, ...data } } : o));
    updateEvent.mutate({ id, data }, { onSuccess: () => { toast({ title: msg }); refresh(); }, onError: (e) => { fail("Could not update")(e); refresh(); } });
  };
  const saveRole = (d: { name: string; instruction: string; slots_needed: number }) => {
    const ok = (t: string) => () => { toast({ title: t }); setRoleDlg(null); refresh(); };
    if (roleDlg?.role) updateRole.mutate({ id, itemId: roleDlg.role.id, data: d }, { onSuccess: ok("Role saved"), onError: fail("Could not save role") });
    else createRole.mutate({ id, data: d }, { onSuccess: ok("Role added"), onError: fail("Could not add role") });
  };
  const doDeleteRole = (r: Role) => {
    setDelRole(null);
    deleteRole.mutate({ id, itemId: r.id }, {
      onSuccess: () => { toast({ title: "Role deleted" }); refresh(); },
      onError: (e) => errorStatus(e) === 409
        ? toast({ title: "This role has volunteers", description: `Remove the ${r.filled} volunteer${r.filled === 1 ? "" : "s"} in ${r.name} first, so nobody loses their spot without knowing.`, variant: "destructive" })
        : fail("Could not delete role")(e),
    });
  };
  const doRemoveVol = (v: Volunteer) => {
    setDelVol(null);
    removeVol.mutate({ id, itemId: v.id }, { onSuccess: () => { toast({ title: `${v.name} removed`, description: "Their spot is free again." }); refresh(); }, onError: fail("Could not remove volunteer") });
  };

  return (
    <Shell event={{ id: ev.id, name: ev.name }}>
      <PageHeader title="Volunteers" subtitle={`${ev.name} · ${filled} of ${total} spots filled`}
        actions={<button className="btn btn-secondary" onClick={() => setReminder(true)} data-testid="button-reminder"><Icon name="copy" size={15} /> Reminder message</button>} />
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_360px] gap-6 items-start">
        <div className="space-y-4 min-w-0">
          {b.roles.length === 0 && (
            <div className="glass text-center !p-8" data-testid="panel-no-roles">
              <h2 className="font-display text-[22px]">No roles yet.</h2>
              <p className="text-muted-ink mt-1">Add the jobs you need people for. Each one shows on the sign-up page with its spots.</p>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {b.roles.map((r, i) => {
              const people = b.volunteers.filter((v) => v.role_id === r.id&&v.status==="confirmed");
              const post=mapQ.data?.items.find((item)=>item.kind==="station"&&item.role_id===r.id);
              const full = r.filled >= r.slots_needed;
              return (
                <article key={r.id} tabIndex={-1} className="glass rise flex flex-col min-w-0" style={{ animationDelay: `${i * 50}ms` }} data-testid={`card-role-${r.id}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="font-display text-[22px] leading-tight break-words min-w-0">{r.name}</h3>
                    <span className={`chip ${full ? "chip-done" : "chip-open"}`} data-testid={`text-role-filled-${r.id}`}>{r.filled} of {r.slots_needed} filled</span>
                  </div>
                  {r.instruction && <p className="text-[14px] text-muted-ink mt-1.5">{r.instruction}</p>}
                  {post&&<Link href={`/app/events/${id}/blueprint?item=${post.id}`} className="mt-2 text-[12px] underline underline-offset-2 text-[var(--forest)]" data-testid={`link-role-post-${r.id}`}>Post: {post.label}</Link>}
                  <div className="flex flex-wrap gap-1.5 mt-4">
                  {people.map((v) => <Avatar key={v.id} name={v.name} size={30} />)}
                    {Array.from({ length: Math.max(0, r.slots_needed - people.length) }).map((_, j) => (
                      <span key={j} className="w-[30px] h-[30px] rounded-full border-[1.5px] border-dashed" style={{ borderColor: "#9C9A92" }} aria-hidden="true" />
                    ))}
                  </div>
                  <div className="flex gap-1 mt-auto pt-4 -mb-1">
                    <button className="btn btn-ghost btn-sm" onClick={() => setRoleDlg({ role: r })} data-testid={`button-edit-role-${r.id}`}>Edit</button>
                    <button className="btn btn-ghost btn-sm" style={{ color: "#8A3426" }} onClick={() => setDelRole(r)} data-testid={`button-delete-role-${r.id}`}>Delete</button>
                  </div>
                </article>
              );
            })}
          </div>
          <button className="w-full h-12 rounded-[14px] border-[1.5px] border-dashed text-[14px] font-semibold flex items-center justify-center gap-1.5 transition-colors hover:bg-white/60" style={{ borderColor: "#9C9A92", color: "#3D3D3A", background: "rgba(255,255,255,0.4)" }} onClick={() => setRoleDlg({ role: null })} data-testid="button-add-role"><Icon name="plus" size={15} /> Add role</button>

          <section className="glass" data-testid="panel-latest-signups">
            <div className="flex items-center justify-between mb-2"><h2 className="font-display text-[20px]">Latest sign-ups</h2><span className="font-mono-ui text-[12px] text-muted-ink">{b.volunteers.length}</span></div>
            {recent.length === 0 ? (
              <p className="text-[14px] text-muted-ink py-3">Nobody yet. Share the link and names will appear here within a few seconds.</p>
            ) : (
              <ul className="divide-y" style={{ borderColor: "var(--line)" }}>
                {recent.map((v) => (
                  <li key={v.id} className="flex items-center gap-3 py-2.5" data-testid={`row-volunteer-${v.id}`}>
                    <Avatar name={v.name} size={30} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[15px] font-semibold truncate">{v.name} {v.ask_again && <span className="chip chip-auto ml-1">Ask me again</span>}</div>
                      <div className="text-[13px] text-muted-ink truncate">{roleName(v.role_id)} · {fmtInTz(v.created_at, ev.timezone, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</div>
                    </div>
                    <button className="btn btn-ghost btn-sm" onClick={() => setDelVol(v)} data-testid={`button-remove-volunteer-${v.id}`}>Remove</button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-4 lg:sticky lg:top-7">
          <section className="glass relative" data-testid="panel-signup-link">
            <Star size={13} className="absolute top-4 right-4" />
            <h2 className="font-display text-[20px] mb-3">Sign-up link</h2>
            <div className="flex items-center gap-2 rounded-[12px] px-3 h-11" style={{ background: "rgba(255,255,255,0.8)", border: "1px solid rgba(31,30,29,0.18)" }}>
              <Icon name="link" size={16} className="shrink-0 text-muted-ink" />
              <span className="text-[14px] flex-1 truncate" style={{ color: "#3D3D3A" }} data-testid="text-signup-link">{link}</span>
            </div>
            <div className="flex gap-2 mt-3">
              <button className="btn btn-primary btn-sm flex-1" onClick={async () => toast((await copyText(link)) ? { title: "Link copied" } : { title: "Could not copy", variant: "destructive" })} data-testid="button-copy-link"><Icon name="copy" size={14} /> Copy link</button>
              <a className="btn btn-secondary btn-sm" href={link} target="_blank" rel="noreferrer" data-testid="link-open-signup">Open</a>
            </div>
            <div className="mt-2 divide-y" style={{ borderColor: "var(--line)" }}>
              <ToggleRow label={ev.signups_open ? "Sign-ups open" : "Sign-ups closed"} hint={ev.signups_open ? "Anyone with the link can join." : "The link shows a friendly closed message."} checked={ev.signups_open} onChange={(v) => toggle({ signups_open: v }, v ? "Sign-ups opened" : "Sign-ups closed")} testid="switch-signups-open" />
              <ToggleRow label="Make a task for each sign-up" hint={'Adds "{name} — {role}" to the board.'} checked={ev.auto_task_from_signup} onChange={(v) => toggle({ auto_task_from_signup: v }, v ? "Sign-up tasks on" : "Sign-up tasks off")} testid="switch-auto-task" />
              <ToggleRow label="Event day mode" hint="Switch every volunteer page to the event-day checklist now. It also turns on by itself on the event date." checked={ev.event_day_mode} onChange={(v) => toggle({ event_day_mode: v }, v ? "Event day mode on" : "Event day mode off")} testid="switch-event-day" />
            </div>
          </section>
          <DayDetails b={b} saving={updateEvent.isPending} onSave={(d) => updateEvent.mutate({ id, data: d }, { onSuccess: () => { toast({ title: "Details saved" }); refresh(); }, onError: fail("Could not save details") })} />
        </aside>
      </div>

      <RoleDialog open={!!roleDlg} onOpenChange={(v) => !v && setRoleDlg(null)} role={roleDlg?.role ?? null} onSave={saveRole} saving={createRole.isPending || updateRole.isPending} />
      <ConfirmDialog open={!!delRole} onOpenChange={(v) => !v && setDelRole(null)} title="Delete this role?" danger confirmLabel="Delete role"
        description={delRole ? (delRole.filled > 0 ? `${delRole.name} has ${delRole.filled} volunteer${delRole.filled === 1 ? "" : "s"}. Remove them first; Encore will not delete a role people are counting on.` : `${delRole.name} will disappear from the sign-up page.`) : ""}
        onConfirm={() => delRole && doDeleteRole(delRole)} />
      <ConfirmDialog open={!!delVol} onOpenChange={(v) => !v && setDelVol(null)} title={delVol ? `Remove ${delVol.name}?` : ""} danger confirmLabel="Remove"
        description="This frees their spot and removes the task made from their sign-up. Their private link stops showing a role." onConfirm={() => delVol && doRemoveVol(delVol)} />
      <ReminderModal b={b} open={reminder} onOpenChange={setReminder} />
    </Shell>
  );
}
