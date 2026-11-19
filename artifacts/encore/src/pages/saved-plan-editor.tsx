import { useEffect, useState, type FormEvent } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useAddPlanSuggestions, useCreateRole, useCreateTask, useDeleteRole, useDeleteTask,
  useDraftPlan, useUpdateRole, useUpdateTask, getGetDashboardQueryKey,
  getGetEventQueryKey, getGetSessionQueryKey,
  type EventBundle, type PlanDraft, type RoleInput, type TaskUpdate,
} from "@workspace/api-client-react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Icon } from "@/components/brand";
import { errorMessage, GROUPS } from "@/lib/encore";
import { useToast } from "@/hooks/use-toast";

type SavedTask = EventBundle["tasks"][number];
type SavedRole = EventBundle["roles"][number];
type OwnerChoice = { organizers: EventBundle["organizers"]; volunteers: EventBundle["volunteers"]; roles: SavedRole[] };
type DeleteTarget = { kind: "task"; task: SavedTask } | { kind: "role"; role: SavedRole } | null;

function ownerKey(task: SavedTask) {
  if (task.assignee_user_id) return `user:${task.assignee_user_id}`;
  if (task.assignee_volunteer_id) return `volunteer:${task.assignee_volunteer_id}`;
  if (task.role_id) return `role:${task.role_id}`;
  return "none";
}
function ownerPatch(value: string): Pick<TaskUpdate, "assignee_user_id" | "assignee_volunteer_id" | "role_id"> {
  const [kind, raw] = value.split(":");
  const id = Number(raw);
  return {
    assignee_user_id: kind === "user" && Number.isSafeInteger(id) ? id : null,
    assignee_volunteer_id: kind === "volunteer" && Number.isSafeInteger(id) ? id : null,
    role_id: kind === "role" && Number.isSafeInteger(id) ? id : null,
  };
}

function TaskRow({ task, choices, onSave, onDelete }: {
  task: SavedTask; choices: OwnerChoice;
  onSave: (id: number, data: TaskUpdate) => Promise<void>;
  onDelete: (task: SavedTask) => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [group, setGroup] = useState(task.group_name || "General");
  const [dueDate, setDueDate] = useState(task.due_date ?? "");
  const [owner, setOwner] = useState(ownerKey(task));
  const [recurring, setRecurring] = useState(task.recurring);
  const [message, setMessage] = useState("Saved");
  useEffect(() => {
    setTitle(task.title); setGroup(task.group_name || "General"); setDueDate(task.due_date ?? "");
    setOwner(ownerKey(task)); setRecurring(task.recurring); setMessage("Saved");
  }, [task.id, task.title, task.group_name, task.due_date, task.assignee_user_id, task.assignee_volunteer_id, task.role_id, task.recurring]);
  const save = async (data: TaskUpdate) => {
    setMessage("Saving…");
    try { await onSave(task.id, data); setMessage("Saved"); }
    catch (error) { setMessage(errorMessage(error, "Could not save")); }
  };
  const saveOwner = (value: string) => { setOwner(value); void save(ownerPatch(value)); };
  return (
    <li className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.55)", border: "1px solid var(--line)" }} data-testid={`saved-task-${task.id}`}>
      <div className="grid gap-2 md:grid-cols-[minmax(180px,1fr)_150px_150px_auto]">
        <input className="field field-compact font-semibold" value={title} maxLength={300} onChange={(e) => { setTitle(e.target.value); setMessage("Unsaved"); }} onBlur={() => { if (title.trim() && title !== task.title) void save({ title: title.trim() }); }} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} aria-label={`Task title: ${task.title}`} data-testid={`saved-task-title-${task.id}`} />
        <select className="field field-compact" value={group} onChange={(e) => { setGroup(e.target.value); void save({ group_name: e.target.value }); }} aria-label={`Group for ${task.title}`} data-testid={`saved-task-group-${task.id}`}>
          {Array.from(new Set([...GROUPS, "General", group])).map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
        <input type="date" className="field field-compact" value={dueDate} onChange={(e) => { setDueDate(e.target.value); setMessage("Unsaved"); }} onBlur={() => { if (dueDate !== (task.due_date ?? "")) void save({ due_date: dueDate || null }); }} aria-label={`Due date for ${task.title}`} data-testid={`saved-task-date-${task.id}`} />
        <button type="button" className="icon-btn justify-self-end" onClick={() => onDelete(task)} aria-label={`Delete ${task.title}`} title="Delete task" data-testid={`saved-task-delete-${task.id}`}><Icon name="trash" size={17} /></button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
        <select className="field field-compact max-w-[320px]" value={owner} onChange={(e) => saveOwner(e.target.value)} aria-label={`Owner for ${task.title}`} data-testid={`saved-task-owner-${task.id}`}>
          <option value="none">No owner</option>
          {choices.organizers.length > 0 && <optgroup label="Organizers">{choices.organizers.map((person) => <option key={person.id} value={`user:${person.id}`}>{person.name || person.email}</option>)}</optgroup>}
          {choices.volunteers.length > 0 && <optgroup label="Volunteers">{choices.volunteers.filter((person) => person.status === "confirmed").map((person) => <option key={person.id} value={`volunteer:${person.id}`}>{person.name}</option>)}</optgroup>}
          {choices.roles.length > 0 && <optgroup label="Whole role">{choices.roles.map((role) => <option key={role.id} value={`role:${role.id}`}>{role.name}</option>)}</optgroup>}
        </select>
        <label className="inline-flex items-center gap-2 text-[13px] text-muted-ink">
          <input type="checkbox" className="accent-[#37442E]" checked={recurring} onChange={(e) => { setRecurring(e.target.checked); void save({ recurring: e.target.checked }); }} data-testid={`saved-task-recurring-${task.id}`} />
          Repeat next event
        </label>
        <span className="text-[12px] text-muted-ink" aria-live="polite">{message}</span>
      </div>
    </li>
  );
}

function RoleRow({ role, onSave, onDelete }: {
  role: SavedRole; onSave: (id: number, data: RoleInput) => Promise<void>; onDelete: (role: SavedRole) => void;
}) {
  const [name, setName] = useState(role.name);
  const [instruction, setInstruction] = useState(role.instruction);
  const [slots, setSlots] = useState(String(role.slots_needed));
  const [message, setMessage] = useState("Saved");
  useEffect(() => {
    setName(role.name); setInstruction(role.instruction); setSlots(String(role.slots_needed)); setMessage("Saved");
  }, [role.id, role.name, role.instruction, role.slots_needed, role.filled]);
  const save = async (patch?: Partial<RoleInput>) => {
    const count = Number(slots);
    if (!name.trim()) { setMessage("Enter a role name."); return; }
    if (!Number.isInteger(count) || count < 1 || count > 100) { setMessage("Use 1–100 spots."); return; }
    if (count < role.filled) { setMessage("Remove a volunteer first."); return; }
    setMessage("Saving…");
    try { await onSave(role.id, { name: name.trim(), instruction, slots_needed: count, ...patch }); setMessage("Saved"); }
    catch (error) { setMessage(errorMessage(error, "Could not save")); }
  };
  return (
    <li className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.55)", border: "1px solid var(--line)" }} data-testid={`saved-role-${role.id}`}>
      <div className="grid gap-2 md:grid-cols-[minmax(180px,1fr)_120px_auto]">
        <input className="field field-compact font-semibold" value={name} maxLength={120} onChange={(e) => { setName(e.target.value); setMessage("Unsaved"); }} onBlur={() => { if (name.trim() !== role.name) void save(); }} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} aria-label={`Role name: ${role.name}`} data-testid={`saved-role-name-${role.id}`} />
        <label className="flex items-center gap-2 text-[13px] text-muted-ink">
          <input type="number" className="field field-compact w-[72px]" min={1} max={100} value={slots} onChange={(e) => { setSlots(e.target.value); setMessage("Unsaved"); }} onBlur={() => { if (Number(slots) !== role.slots_needed) void save(); }} aria-label={`Slots for ${role.name}`} data-testid={`saved-role-slots-${role.id}`} />
          spots
        </label>
        <button type="button" className="icon-btn justify-self-end" disabled={role.filled > 0} onClick={() => onDelete(role)} aria-label={`Delete ${role.name}`} title={role.filled ? "Move or remove volunteers before deleting this role" : "Delete role"} data-testid={`saved-role-delete-${role.id}`}><Icon name="trash" size={17} /></button>
      </div>
      <textarea className="field mt-2 text-[14px]" rows={2} maxLength={2000} value={instruction} onChange={(e) => { setInstruction(e.target.value); setMessage("Unsaved"); }} onBlur={() => { if (instruction !== role.instruction) void save(); }} aria-label={`Instruction for ${role.name}`} data-testid={`saved-role-instruction-${role.id}`} />
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted-ink">
        <span aria-live="polite">{message}</span>
        {role.filled > 0 && <span>Remove a volunteer first. <Link className="underline font-semibold" href={`/app/events/${role.event_id}/volunteers`}>Open Volunteers</Link></span>}
      </div>
    </li>
  );
}

function offsetDate(startsAt: string, timezone: string, offset: number) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(startsAt)).map((part) => [part.type, part.value]));
  const date = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + offset));
  return date.toISOString().slice(0, 10);
}

export function SavedPlanEditor({ bundle }: { bundle: EventBundle }) {
  const eventId = bundle.event.id;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createTask = useCreateTask(); const updateTask = useUpdateTask(); const deleteTask = useDeleteTask();
  const createRole = useCreateRole(); const updateRole = useUpdateRole(); const deleteRole = useDeleteRole();
  const draftPlan = useDraftPlan(); const addSuggestions = useAddPlanSuggestions();
  const [addingTask, setAddingTask] = useState(false);
  const [newTask, setNewTask] = useState({ title: "", group_name: "General", due_date: "", owner: "none", recurring: false });
  const [addingRole, setAddingRole] = useState(false);
  const [newRole, setNewRole] = useState({ name: "", instruction: "", slots_needed: 1 });
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [suggestions, setSuggestions] = useState<PlanDraft | null>(null);
  const [selectedTasks, setSelectedTasks] = useState<string[]>([]);
  const [selectedRoles, setSelectedRoles] = useState<number[]>([]);
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getGetEventQueryKey(eventId) }),
      queryClient.invalidateQueries({ queryKey: getGetDashboardQueryKey(bundle.series.id) }),
    ]);
  };
  const saveTask = async (id: number, data: TaskUpdate) => { await updateTask.mutateAsync({ id: eventId, itemId: id, data }); await refresh(); };
  const saveRole = async (id: number, data: RoleInput) => { await updateRole.mutateAsync({ id: eventId, itemId: id, data }); await refresh(); };
  const addTask = async (e: FormEvent) => {
    e.preventDefault();
    if (!newTask.title.trim()) { toast({ title: "Add a task title", variant: "destructive" }); return; }
    try {
      await createTask.mutateAsync({ id: eventId, data: {
        title: newTask.title.trim(), group_name: newTask.group_name, due_date: newTask.due_date || null,
        recurring: newTask.recurring, ...ownerPatch(newTask.owner),
      } });
      setNewTask({ title: "", group_name: "General", due_date: "", owner: "none", recurring: false });
      setAddingTask(false); await refresh(); toast({ title: "Task added" });
    } catch (error) { toast({ title: "Could not add task", description: errorMessage(error), variant: "destructive" }); }
  };
  const addRole = async (e: FormEvent) => {
    e.preventDefault();
    if (!newRole.name.trim()) { toast({ title: "Add a role name", variant: "destructive" }); return; }
    try {
      await createRole.mutateAsync({ id: eventId, data: { ...newRole, name: newRole.name.trim() } });
      setNewRole({ name: "", instruction: "", slots_needed: 1 }); setAddingRole(false);
      await refresh(); toast({ title: "Role added" });
    } catch (error) { toast({ title: "Could not add role", description: errorMessage(error), variant: "destructive" }); }
  };
  const removeItem = async () => {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.kind === "task") await deleteTask.mutateAsync({ id: eventId, itemId: deleteTarget.task.id });
      else await deleteRole.mutateAsync({ id: eventId, itemId: deleteTarget.role.id });
      setDeleteTarget(null); await refresh(); toast({ title: deleteTarget.kind === "task" ? "Task deleted" : "Role deleted" });
    } catch (error) { setDeleteTarget(null); toast({ title: "Could not delete this item", description: errorMessage(error), variant: "destructive" }); }
  };
  const suggest = () => {
    draftPlan.mutate({ data: { event_id: eventId } }, {
      onSuccess: (draft) => {
        setSuggestions(draft);
        setSelectedTasks(draft.groups.flatMap((group, gi) => group.tasks.map((_, ti) => `${gi}:${ti}`)));
        setSelectedRoles(draft.roles.map((_, index) => index));
        queryClient.invalidateQueries({ queryKey: getGetSessionQueryKey() });
      },
      onError: (error) => toast({ title: "Could not suggest more work", description: errorMessage(error), variant: "destructive" }),
    });
  };
  const saveSuggestions = async () => {
    if (!suggestions) return;
    const taskSet = new Set(selectedTasks); const roleSet = new Set(selectedRoles);
    const groups = suggestions.groups.map((group, gi) => ({
      ...group, tasks: group.tasks.filter((_, ti) => taskSet.has(`${gi}:${ti}`)).map((task) => ({ ...task })),
    })).filter((group) => group.tasks.length > 0);
    const roles = suggestions.roles.filter((_, index) => roleSet.has(index));
    try {
      await addSuggestions.mutateAsync({ id: eventId, data: { groups, roles, notice: suggestions.notice } });
      setSuggestions(null); await refresh(); toast({ title: "Selected suggestions added" });
    } catch (error) { toast({ title: "Could not add suggestions", description: errorMessage(error), variant: "destructive" }); }
  };
  const choices: OwnerChoice = { organizers: bundle.organizers, volunteers: bundle.volunteers, roles: bundle.roles };
  const deletingBusy = deleteTask.isPending || deleteRole.isPending;
  const taskSelection = new Set(selectedTasks);
  const hasInvalidSelection = !!suggestions && (
    suggestions.groups.some((group, gi) => group.tasks.some((task, ti) => taskSelection.has(`${gi}:${ti}`) && !task.title.trim())) ||
    selectedRoles.some((index) => !suggestions.roles[index]?.name.trim() || !Number.isInteger(suggestions.roles[index]?.slots))
  );

  return (
    <div className="space-y-5" data-testid="panel-saved-plan">
      <section className="glass" data-testid="panel-saved-tasks">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div><h2 className="font-display text-[23px]">Tasks</h2><p className="text-[13px] text-muted-ink">Edits save when you leave a field. Changes appear on the task board and volunteer pages.</p></div>
          <button type="button" className="btn btn-secondary btn-sm" onClick={suggest} disabled={draftPlan.isPending} data-testid="button-suggest-more">
            <Icon name="spark" size={14} /> {draftPlan.isPending ? "Thinking…" : "Suggest more tasks"}
          </button>
        </div>
        {bundle.tasks.length ? (
          <ul className="space-y-2">
            {bundle.tasks.map((task) => <TaskRow key={task.id} task={task} choices={choices} onSave={saveTask} onDelete={(item) => setDeleteTarget({ kind: "task", task: item })} />)}
          </ul>
        ) : <p className="text-[14px] text-muted-ink py-3">No tasks yet. Add one or request suggestions.</p>}
        {addingTask ? (
          <form onSubmit={addTask} className="mt-4 rounded-xl p-3 space-y-3" style={{ background: "rgba(55,68,46,0.06)" }} data-testid="form-add-plan-task">
            <div className="grid gap-2 md:grid-cols-2">
              <label className="md:col-span-2"><span className="field-label">Task title</span><input autoFocus className="field" maxLength={300} value={newTask.title} onChange={(e) => setNewTask({ ...newTask, title: e.target.value })} data-testid="input-new-plan-task-title" /></label>
              <label><span className="field-label">Group</span><select className="field" value={newTask.group_name} onChange={(e) => setNewTask({ ...newTask, group_name: e.target.value })}>{[...GROUPS, "General"].map((name) => <option key={name}>{name}</option>)}</select></label>
              <label><span className="field-label">Due date</span><input type="date" className="field" value={newTask.due_date} onChange={(e) => setNewTask({ ...newTask, due_date: e.target.value })} /></label>
              <label><span className="field-label">Owner</span><select className="field" value={newTask.owner} onChange={(e) => setNewTask({ ...newTask, owner: e.target.value })}>
                <option value="none">No owner</option>{choices.organizers.map((person) => <option key={person.id} value={`user:${person.id}`}>{person.name || person.email}</option>)}{choices.volunteers.filter((person) => person.status === "confirmed").map((person) => <option key={person.id} value={`volunteer:${person.id}`}>{person.name}</option>)}{choices.roles.map((role) => <option key={role.id} value={`role:${role.id}`}>{role.name}</option>)}
              </select></label>
              <label className="flex items-center gap-2 self-end pb-2 text-[14px]"><input type="checkbox" className="accent-[#37442E]" checked={newTask.recurring} onChange={(e) => setNewTask({ ...newTask, recurring: e.target.checked })} /> Repeat next event</label>
            </div>
            <div className="flex justify-end gap-2"><button type="button" className="btn btn-secondary btn-sm" onClick={() => setAddingTask(false)}>Cancel</button><button className="btn btn-primary btn-sm" disabled={createTask.isPending} data-testid="button-save-new-plan-task">Add task</button></div>
          </form>
        ) : <button type="button" className="btn btn-ghost btn-sm mt-3" onClick={() => setAddingTask(true)} data-testid="button-add-saved-task"><Icon name="plus" size={14} /> Add task</button>}
      </section>

      <section className="glass" data-testid="panel-saved-roles">
        <div className="mb-3"><h2 className="font-display text-[23px]">Volunteer roles</h2><p className="text-[13px] text-muted-ink">Role names, instructions and open slots update the live sign-up page.</p></div>
        {bundle.roles.length ? (
          <ul className="space-y-2">
            {bundle.roles.map((role) => <RoleRow key={role.id} role={role} onSave={saveRole} onDelete={(item) => setDeleteTarget({ kind: "role", role: item })} />)}
          </ul>
        ) : <p className="text-[14px] text-muted-ink py-3">No volunteer roles yet. Add one to open sign-ups.</p>}
        {addingRole ? (
          <form onSubmit={addRole} className="mt-4 rounded-xl p-3 space-y-3" style={{ background: "rgba(55,68,46,0.06)" }} data-testid="form-add-plan-role">
            <div className="grid gap-3 md:grid-cols-[1fr_120px]">
              <label><span className="field-label">Role name</span><input autoFocus className="field" maxLength={120} value={newRole.name} onChange={(e) => setNewRole({ ...newRole, name: e.target.value })} /></label>
              <label><span className="field-label">Spots</span><input type="number" min={1} max={100} className="field" value={newRole.slots_needed} onChange={(e) => setNewRole({ ...newRole, slots_needed: Number(e.target.value) })} /></label>
            </div>
            <label><span className="field-label">Volunteer instructions</span><textarea className="field" rows={2} maxLength={2000} value={newRole.instruction} onChange={(e) => setNewRole({ ...newRole, instruction: e.target.value })} /></label>
            <div className="flex justify-end gap-2"><button type="button" className="btn btn-secondary btn-sm" onClick={() => setAddingRole(false)}>Cancel</button><button className="btn btn-primary btn-sm" disabled={createRole.isPending} data-testid="button-save-new-plan-role">Add role</button></div>
          </form>
        ) : <button type="button" className="btn btn-ghost btn-sm mt-3" onClick={() => setAddingRole(true)} data-testid="button-add-saved-role"><Icon name="plus" size={14} /> Add role</button>}
      </section>

      {suggestions && (
        <section className="ai-glass" data-testid="panel-plan-suggestions">
          <div className="flex items-center justify-between gap-2"><h2 className="font-display text-[22px]">Suggested additions</h2><span className="chip chip-gold">AI draft</span></div>
          {suggestions.notice && <p className="text-[13px] mt-1">{suggestions.notice}</p>}
          <p className="text-[13px] mt-2 mb-3">Choose, edit, then add. Nothing changes until you select “Add selected”.</p>
          <div className="space-y-3">
            {suggestions.groups.map((group, gi) => <section key={`${group.name}-${gi}`} className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.52)" }}>
              <h3 className="mono-label mb-2">{group.name}</h3>
              <ul className="space-y-2">{group.tasks.map((task, ti) => {
                const key = `${gi}:${ti}`;
                return <li key={key} className="flex items-start gap-2">
                  <input type="checkbox" className="mt-3 accent-[#37442E]" checked={selectedTasks.includes(key)} onChange={(e) => setSelectedTasks((old) => e.target.checked ? [...old, key] : old.filter((item) => item !== key))} aria-label={`Select suggested task ${ti + 1}`} />
                  <input className="field field-compact flex-1" maxLength={300} value={task.title} onChange={(e) => setSuggestions((old) => old ? { ...old, groups: old.groups.map((g, i) => i === gi ? { ...g, tasks: g.tasks.map((item, j) => j === ti ? { ...item, title: e.target.value } : item) } : g) } : old)} aria-label="Suggested task title" />
                  <label className="text-[12px] whitespace-nowrap flex items-center gap-1">Due in <input type="number" className="field field-compact w-16" min={-365} max={365} value={task.due_offset_days} onChange={(e) => setSuggestions((old) => old ? { ...old, groups: old.groups.map((g, i) => i === gi ? { ...g, tasks: g.tasks.map((item, j) => i === gi && j === ti ? { ...item, due_offset_days: Math.round(Math.max(-365, Math.min(365, Number(e.target.value) || 0))) } : item) } : g) } : old)} aria-label="Suggested task due offset" /> days</label>
                  <span className="text-[11px] text-muted-ink self-center hidden sm:inline">{offsetDate(bundle.event.starts_at, bundle.event.timezone, task.due_offset_days)}</span>
                </li>;
              })}</ul>
            </section>)}
            {suggestions.roles.length > 0 && <section className="rounded-xl p-3" style={{ background: "rgba(255,255,255,0.52)" }}>
              <h3 className="mono-label mb-2">Suggested roles</h3>
              <ul className="space-y-3">{suggestions.roles.map((role, index) => <li key={index} className="space-y-2">
                <div className="flex items-center gap-2">
                  <input type="checkbox" className="accent-[#37442E]" checked={selectedRoles.includes(index)} onChange={(e) => setSelectedRoles((old) => e.target.checked ? [...old, index] : old.filter((item) => item !== index))} aria-label={`Select suggested role ${index + 1}`} />
                  <input className="field field-compact flex-1" maxLength={120} value={role.name} onChange={(e) => setSuggestions((old) => old ? { ...old, roles: old.roles.map((item, i) => i === index ? { ...item, name: e.target.value } : item) } : old)} aria-label="Suggested role name" />
                  <input type="number" className="field field-compact w-16" min={1} max={100} value={role.slots} onChange={(e) => setSuggestions((old) => old ? { ...old, roles: old.roles.map((item, i) => i === index ? { ...item, slots: Math.max(1, Math.min(100, Math.round(Number(e.target.value) || 1))) } : item) } : old)} aria-label="Suggested role spots" />
                </div>
                <textarea className="field field-compact text-[13px]" rows={2} maxLength={2000} value={role.instruction} onChange={(e) => setSuggestions((old) => old ? { ...old, roles: old.roles.map((item, i) => i === index ? { ...item, instruction: e.target.value } : item) } : old)} aria-label={`Instruction for suggested role ${index + 1}`} />
              </li>)}</ul>
            </section>}
          </div>
          <div className="flex flex-wrap justify-end gap-2 mt-4">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSuggestions(null)} data-testid="button-discard-suggestions">Discard</button>
            <button type="button" className="btn btn-primary btn-sm" disabled={addSuggestions.isPending || (!selectedTasks.length && !selectedRoles.length) || hasInvalidSelection} onClick={saveSuggestions} data-testid="button-add-selected-suggestions">{addSuggestions.isPending ? "Adding…" : "Add selected"}</button>
          </div>
        </section>
      )}
      <ConfirmDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)} title={deleteTarget?.kind === "role" ? "Delete this role?" : "Delete this task?"} description={deleteTarget?.kind === "role" ? `${deleteTarget.role.name} will be removed from the event and the sign-up page.` : `${deleteTarget?.task.title ?? "This task"} will be removed from the event.`} confirmLabel={deleteTarget?.kind === "role" ? "Delete role" : "Delete task"} danger onConfirm={removeItem} />
      {deletingBusy && <span className="sr-only" aria-live="polite">Deleting…</span>}
    </div>
  );
}
