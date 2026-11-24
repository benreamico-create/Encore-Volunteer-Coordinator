import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEventHandler, type MouseEventHandler, type TouchEventHandler } from "react";
import { DndContext, DragOverlay, MouseSensor, TouchSensor, KeyboardSensor, useSensor, useSensors, closestCorners, pointerWithin, type DragEndEvent, type CollisionDetection } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateTask, useUpdateTask, useDeleteTask,
  getGetEventQueryKey,
  type EventBundle, type Task, type TaskStatus, type TaskUpdate,
} from "@workspace/api-client-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuSub,
  DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Shell, PageHeader } from "@/components/shell";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { TaskColumn, TaskColumnTab } from "@/components/task-board-dnd";
import { HelperPanel } from "@/components/helper-panel";
import { Avatar, ErrorPanel, Icon, Skel, Star } from "@/components/brand";
import { GROUPS, dueLabel, errorMessage, errorStatus, fmtDate, sourceChip } from "@/lib/encore";
import { useEventBundle } from "@/lib/use-event";
import { useToast } from "@/hooks/use-toast";

const COLS: { id: TaskStatus; label: string }[] = [
  { id: "todo", label: "To do" }, { id: "doing", label: "In progress" }, { id: "done", label: "Done" },
];
const boardCollision: CollisionDetection = args => {
  const hits = pointerWithin(args);
  const cards = hits.filter(hit => typeof hit.id === "number");
  return cards.length ? cards : hits.length ? hits : closestCorners(args);
};

function assigneeKey(t: Pick<Task, "assignee_user_id" | "assignee_volunteer_id" | "role_id">) {
  if (t.assignee_user_id) return `u:${t.assignee_user_id}`;
  if (t.assignee_volunteer_id) return `v:${t.assignee_volunteer_id}`;
  if (t.role_id) return `r:${t.role_id}`;
  return "none";
}
function assigneeFields(key: string): Pick<TaskUpdate, "assignee_user_id" | "assignee_volunteer_id" | "role_id"> {
  const [kind, raw] = key.split(":");
  const n = Number(raw);
  return {
    assignee_user_id: kind === "u" ? n : null,
    assignee_volunteer_id: kind === "v" ? n : null,
    role_id: kind === "r" ? n : null,
  };
}
function assigneeName(b: EventBundle, t: Task): string | null {
  if (t.assignee_user_id) { const u = b.organizers.find((o) => o.id === t.assignee_user_id); return u ? (u.name || u.email) : "Organizer"; }
  if (t.assignee_volunteer_id) return b.volunteers.find((v) => v.id === t.assignee_volunteer_id)?.name ?? "Volunteer";
  if (t.role_id) { const r = b.roles.find((x) => x.id === t.role_id); return r ? `${r.name} role` : null; }
  return null;
}

function AssigneeOptions({ b }: { b: EventBundle }) {
  return (
    <>
      <option value="none">Unassigned</option>
      {b.organizers.length > 0 && <optgroup label="Organizers">{b.organizers.map((o) => <option key={o.id} value={`u:${o.id}`}>{o.name || o.email}</option>)}</optgroup>}
      {b.volunteers.length > 0 && <optgroup label="Volunteers">{b.volunteers.map((v) => <option key={v.id} value={`v:${v.id}`}>{v.name}</option>)}</optgroup>}
      {b.roles.length > 0 && <optgroup label="Whole role">{b.roles.map((r) => <option key={r.id} value={`r:${r.id}`}>{r.name}</option>)}</optgroup>}
    </>
  );
}

type FormState = { title: string; group: string; status: TaskStatus; assignee: string; due: string; recurring: boolean };

function TaskDialog({ b, open, onOpenChange, task, defaultStatus, onSave, saving }: {
  b: EventBundle; open: boolean; onOpenChange: (v: boolean) => void; task: Task | null; defaultStatus: TaskStatus;
  onSave: (f: FormState) => void; saving: boolean;
}) {
  const init: FormState = task
    ? { title: task.title, group: task.group_name || GROUPS[0], status: task.status, assignee: assigneeKey(task), due: task.due_date?.slice(0, 10) ?? "", recurring: task.recurring }
    : { title: "", group: GROUPS[0], status: defaultStatus, assignee: "none", due: "", recurring: false };
  const [f, setF] = useState<FormState>(init);
  const [err, setErr] = useState("");
  const [lastKey, setLastKey] = useState<string>("");
  const key = `${open}-${task?.id ?? "new"}-${defaultStatus}`;
  if (key !== lastKey) { setLastKey(key); setF(init); setErr(""); }
  const submit = (e: FormEvent) => { e.preventDefault(); if (!f.title.trim()) { setErr("Give the task a title."); return; } onSave(f); };
  const groups = Array.from(new Set([...GROUPS, f.group]));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-0 rounded-[20px] p-0 max-w-[520px]" style={{ background: "#FEFCF0" }}>
        <form onSubmit={submit} className="p-7 space-y-4">
          <div>
            <div className="mono-label mb-1">{task ? "Edit task" : "New task"}</div>
            <DialogTitle className="font-display text-[26px] font-normal">{task ? "Tune this task" : "Add a task"}</DialogTitle>
            <DialogDescription className="sr-only">Task details</DialogDescription>
          </div>
          <div>
            <label className="field-label" htmlFor="t-title">Title</label>
            <input id="t-title" className="field" value={f.title} maxLength={300} onChange={(e) => setF({ ...f, title: e.target.value })} aria-invalid={!!err} autoFocus data-testid="input-task-title" />
            {err && <p className="field-error">{err}</p>}
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="field-label" htmlFor="t-group">Group</label>
              <select id="t-group" className="field" value={f.group} onChange={(e) => setF({ ...f, group: e.target.value })} data-testid="select-task-group">{groups.map((g) => <option key={g}>{g}</option>)}</select>
            </div>
            <div>
              <label className="field-label" htmlFor="t-status">Column</label>
              <select id="t-status" className="field" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as TaskStatus })} data-testid="select-task-status">{COLS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
            </div>
            <div>
              <label className="field-label" htmlFor="t-assignee">Assignee</label>
              <select id="t-assignee" className="field" value={f.assignee} onChange={(e) => setF({ ...f, assignee: e.target.value })} data-testid="select-task-assignee"><AssigneeOptions b={b} /></select>
            </div>
            <div>
              <label className="field-label" htmlFor="t-due">Due date</label>
              <input id="t-due" type="date" className="field" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} data-testid="input-task-due" />
              <p className="text-[12px] text-muted-ink mt-1">Optional. Tasks can be due before or after the event.</p>
            </div>
          </div>
          <label className="flex items-center justify-between gap-4 rounded-xl px-4 py-3" style={{ background: "rgba(55,68,46,0.06)" }}>
            <span><span className="font-semibold block text-[14px]">Recurring</span><span className="text-[13px] text-muted-ink">Offer this task again when you create the next event.</span></span>
            <Switch checked={f.recurring} onCheckedChange={(v) => setF({ ...f, recurring: v })} data-testid="switch-task-recurring" />
          </label>
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" className="btn btn-secondary" onClick={() => onOpenChange(false)}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving} data-testid="button-save-task">{saving ? "Saving" : task ? "Save task" : "Add task"}</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TaskCard({ b, t, index, colLen, onMove, onReorder, onEdit, onAssign, onDelete, busy }: {
  b: EventBundle; t: Task; index: number; colLen: number;
  onMove: (s: TaskStatus) => void; onReorder: (dir: -1 | 1) => void; onEdit: () => void; onAssign: (key: string) => void; onDelete: () => void;
  busy: boolean;
}) {
  const chip = sourceChip(t.source, t.source_note, b.previous?.event.name);
  const who = assigneeName(b, t);
  const done = t.status === "done";
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: t.id, data: { status: t.status }, disabled: busy,
  });
  // Mouse can start a drag anywhere on the card body. Touch stays on the
  // visible handle so swiping over a card can still scroll the page normally.
  const onMouseDown = listeners?.onMouseDown as unknown as MouseEventHandler<HTMLElement> | undefined;
  const onTouchStart = listeners?.onTouchStart as unknown as TouchEventHandler<HTMLButtonElement> | undefined;
  const onKeyDown = listeners?.onKeyDown as unknown as KeyboardEventHandler<HTMLButtonElement> | undefined;
  return (
    <article
      ref={setNodeRef} onMouseDown={onMouseDown}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.35 : 1 }}
      className={`glass !p-3.5 cursor-grab active:cursor-grabbing transition-shadow ${isDragging ? "shadow-xl" : ""}`}
      tabIndex={-1}
      data-testid={`card-task-${t.id}`}
    >
      <div className="flex items-start gap-2">
        <button ref={setActivatorNodeRef} type="button" {...attributes} onTouchStart={onTouchStart} onKeyDown={onKeyDown}
          className="flex-1 min-w-0 -ml-1 -mt-1 p-1.5 rounded-lg flex items-start gap-2 text-left text-[15px] font-semibold leading-snug text-[#23291E] hover:bg-black/[0.035] cursor-grab active:cursor-grabbing touch-none disabled:cursor-not-allowed"
          aria-label={`Drag task: ${t.title}`} disabled={busy} data-testid={`drag-task-${t.id}`}>
          <svg className="shrink-0 mt-0.5 text-muted-ink" width="14" height="18" viewBox="0 0 16 20" fill="currentColor" aria-hidden="true">
            {[5, 10, 15].flatMap(y => [5, 11].map(x => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.5" />))}
          </svg>
          <span className={`min-w-0 ${done ? "line-through text-muted-ink" : ""}`} data-testid={`text-task-title-${t.id}`}>{t.title}<span className="sr-only">. Drag to move between task columns.</span></span>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger disabled={busy} onMouseDown={e => e.stopPropagation()} className="w-9 h-9 -mr-1.5 -mt-1.5 shrink-0 rounded-full inline-flex items-center justify-center text-muted-ink hover:bg-black/5" aria-label={`Actions for ${t.title}`} data-testid={`button-task-menu-${t.id}`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52 rounded-xl" style={{ background: "#FEFCF0" }}>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger data-testid={`menu-move-${t.id}`}>Move to…</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="rounded-xl" style={{ background: "#FEFCF0" }}>
                {COLS.map((c) => <DropdownMenuItem key={c.id} disabled={c.id === t.status} onSelect={() => onMove(c.id)} data-testid={`menu-move-${t.id}-${c.id}`}>{c.label}</DropdownMenuItem>)}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem disabled={index === 0} onSelect={() => onReorder(-1)} data-testid={`menu-up-${t.id}`}>Move up</DropdownMenuItem>
            <DropdownMenuItem disabled={index === colLen - 1} onSelect={() => onReorder(1)} data-testid={`menu-down-${t.id}`}>Move down</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger data-testid={`menu-assign-${t.id}`}>Assign</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="rounded-xl max-h-[320px] overflow-auto" style={{ background: "#FEFCF0" }}>
                <DropdownMenuItem onSelect={() => onAssign("none")}>Unassigned</DropdownMenuItem>
                {b.organizers.length > 0 && <DropdownMenuLabel className="mono-label">Organizers</DropdownMenuLabel>}
                {b.organizers.map((o) => <DropdownMenuItem key={`u${o.id}`} onSelect={() => onAssign(`u:${o.id}`)}>{o.name || o.email}</DropdownMenuItem>)}
                {b.volunteers.length > 0 && <DropdownMenuLabel className="mono-label">Volunteers</DropdownMenuLabel>}
                {b.volunteers.map((v) => <DropdownMenuItem key={`v${v.id}`} onSelect={() => onAssign(`v:${v.id}`)}>{v.name}</DropdownMenuItem>)}
                {b.roles.length > 0 && <DropdownMenuLabel className="mono-label">Whole role</DropdownMenuLabel>}
                {b.roles.map((r) => <DropdownMenuItem key={`r${r.id}`} onSelect={() => onAssign(`r:${r.id}`)}>{r.name}</DropdownMenuItem>)}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem onSelect={onEdit} data-testid={`menu-edit-${t.id}`}>Edit</DropdownMenuItem>
            <DropdownMenuItem onSelect={onDelete} className="text-[#8A3426]" data-testid={`menu-delete-${t.id}`}>Delete</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {(chip || t.recurring) && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {chip && <span className={`chip ${chip.cls}`} title={t.source_note || undefined}>{chip.label}</span>}
          {t.recurring && <span className="chip chip-todo">Recurring</span>}
        </div>
      )}
      <div className="flex items-center justify-between gap-2 mt-3">
        {who ? (
          <span className="flex items-center gap-1.5 min-w-0"><Avatar name={who} size={26} /><span className="text-[13px] truncate" style={{ color: "#3D3D3A" }}>{who}</span></span>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger disabled={busy} onMouseDown={e => e.stopPropagation()} className="text-[12px] font-semibold rounded-full px-2.5 py-0.5 hover:bg-white/60" style={{ color: "#37442E", border: "1.5px dashed #37442E" }} data-testid={`button-quick-assign-${t.id}`}>+ Assign</DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="rounded-xl max-h-[300px] overflow-auto" style={{ background: "#FEFCF0" }}>
              {b.organizers.map((o) => <DropdownMenuItem key={`u${o.id}`} onSelect={() => onAssign(`u:${o.id}`)}>{o.name || o.email}</DropdownMenuItem>)}
              {b.volunteers.map((v) => <DropdownMenuItem key={`v${v.id}`} onSelect={() => onAssign(`v:${v.id}`)}>{v.name} <span className="text-muted-ink ml-1 text-[12px]">volunteer</span></DropdownMenuItem>)}
              {b.roles.map((r) => <DropdownMenuItem key={`r${r.id}`} onSelect={() => onAssign(`r:${r.id}`)}>{r.name} <span className="text-muted-ink ml-1 text-[12px]">role</span></DropdownMenuItem>)}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {t.due_date && <span className="text-[12px] text-muted-ink whitespace-nowrap">Due {dueLabel(t.due_date)}</span>}
      </div>
      <label className="flex items-center justify-between gap-2 mt-3 pt-2.5 border-t text-[12px] text-muted-ink" style={{ borderColor: "var(--line)" }}>
        Status
        <select className="rounded-lg py-1.5 pl-2 pr-6 bg-white/70 text-[13px] font-semibold text-[#37442E] max-w-[150px]"
          value={t.status} disabled={busy} onMouseDown={e => e.stopPropagation()} onChange={e => onMove(e.target.value as TaskStatus)}
          aria-label={`Status for ${t.title}`} data-testid={`select-task-status-${t.id}`}>
          {COLS.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </label>
    </article>
  );
}

export default function TasksPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const qc = useQueryClient();
  const { toast } = useToast();
  const [moving, setMoving] = useState(false);
  const moveLock = useRef(false);
  const q = useEventBundle(id, moving ? 0 : 5000);
  const createTask = useCreateTask();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();
  const key = getGetEventQueryKey(id);

  const [mobileCol, setMobileCol] = useState<TaskStatus>("todo");
  const [dialog, setDialog] = useState<{ task: Task | null; status: TaskStatus } | null>(null);
  const [confirmDel, setConfirmDel] = useState<Task | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const b = q.data;
  useEffect(()=>{
    const target=Number(new URLSearchParams(window.location.search).get("task"));
    if(!target||!b?.tasks.some((task)=>task.id===target))return;
    const timer=window.setTimeout(()=>{const card=document.querySelector<HTMLElement>(`[data-testid="card-task-${target}"]`);card?.scrollIntoView({behavior:"smooth",block:"center"});card?.focus({preventScroll:true});},100);
    return()=>window.clearTimeout(timer);
  },[b?.tasks]);
  const columns = useMemo(() => {
    const m: Record<TaskStatus, Task[]> = { todo: [], doing: [], done: [] };
    for (const t of b?.tasks ?? []) (m[t.status] ?? m.todo).push(t);
    for (const k of Object.keys(m) as TaskStatus[]) m[k].sort((a, c) => a.sort_order - c.sort_order || a.id - c.id);
    return m;
  }, [b?.tasks]);

  const patch = (fn: (ts: Task[]) => Task[]) => qc.setQueryData<EventBundle>(key, (old) => (old ? { ...old, tasks: fn(old.tasks) } : old));
  const fail = (e: unknown) => { toast({ title: "That did not save", description: errorMessage(e), variant: "destructive" }); qc.invalidateQueries({ queryKey: key }); };

  const moveTo = (t: Task, status: TaskStatus, index?: number) => {
    if (moveLock.current || (t.status === status && index === undefined)) return;
    moveLock.current = true;
    setMoving(true);
    void qc.cancelQueries({ queryKey: key });
    const col = columns[status].filter((x) => x.id !== t.id);
    const at = index === undefined ? col.length : Math.max(0, Math.min(index, col.length));
    col.splice(at, 0, { ...t, status });
    const changes = col.map((x, i) => ({ x, i })).filter(({ x, i }) => x.id === t.id || x.sort_order !== i);
    patch((ts) => ts.map((x) => { const c = changes.find((ch) => ch.x.id === x.id); return c ? { ...x, status: x.id === t.id ? status : x.status, sort_order: c.i } : x; }));
    Promise.all(changes.map(({ x, i }) => updateTask.mutateAsync({ id, itemId: x.id, data: x.id === t.id ? { status, sort_order: i } : { sort_order: i } })))
      .then(() => { if (t.status !== status) toast({ title: `Moved to ${COLS.find((c) => c.id === status)?.label}` }); qc.invalidateQueries({ queryKey: key }); })
      .catch(fail)
      .finally(() => { moveLock.current = false; setMoving(false); });
  };
  const assign = (t: Task, k: string) => {
    const fields = assigneeFields(k);
    patch((ts) => ts.map((x) => (x.id === t.id ? { ...x, ...fields } : x)));
    updateTask.mutate({ id, itemId: t.id, data: fields }, { onSuccess: () => { toast({ title: k === "none" ? "Unassigned" : "Assigned" }); qc.invalidateQueries({ queryKey: key }); }, onError: fail });
  };
  const save = (f: FormState) => {
    const data = { title: f.title.trim(), group_name: f.group, status: f.status, due_date: f.due || null, recurring: f.recurring, ...assigneeFields(f.assignee) };
    const done = () => { setDialog(null); qc.invalidateQueries({ queryKey: key }); };
    if (dialog?.task) updateTask.mutate({ id, itemId: dialog.task.id, data }, { onSuccess: () => { toast({ title: "Task saved" }); done(); }, onError: fail });
    else createTask.mutate({ id, data: { ...data, sort_order: columns[f.status].length } }, { onSuccess: () => { toast({ title: "Task added" }); done(); }, onError: fail });
  };
  const remove = (t: Task) => {
    setConfirmDel(null);
    patch((ts) => ts.filter((x) => x.id !== t.id));
    deleteTask.mutate({ id, itemId: t.id }, { onSuccess: () => { toast({ title: "Task deleted" }); qc.invalidateQueries({ queryKey: key }); }, onError: fail });
  };
  const finishDrag = ({ active, over }: DragEndEvent) => {
    setDragId(null);
    if (!over || active.id === over.id) return;
    const status = over.data.current?.status as TaskStatus | undefined;
    const t = b?.tasks.find(x => x.id === active.id);
    if (!t || !status || !COLS.some(c => c.id === status)) return;
    const index = columns[status].findIndex(x => x.id === over.id);
    moveTo(t, status, index < 0 ? undefined : index);
    setMobileCol(status);
  };

  if (q.isLoading) return <Shell><div data-testid="status-loading-tasks"><Skel className="h-10 w-48 mb-3" /><Skel className="h-4 w-72 mb-8" /><div className="grid min-[900px]:grid-cols-3 gap-4">{[0, 1, 2].map((i) => <div key={i} className="space-y-3"><Skel className="h-6 w-24" /><Skel className="h-28 !rounded-2xl" /><Skel className="h-28 !rounded-2xl" /></div>)}</div></div></Shell>;
  if (q.isError || !b) {
    const nf = errorStatus(q.error) === 404 || errorStatus(q.error) === 403;
    return <Shell><ErrorPanel title={nf ? "Event not found" : "That did not load"} message={nf ? "This event does not exist or belongs to someone else." : errorMessage(q.error)} onRetry={nf ? undefined : () => void q.refetch()} /></Shell>;
  }

  return (
    <Shell event={{ id: b.event.id, name: b.event.name }}>
      <PageHeader
        title="Tasks"
        subtitle={`${b.event.name} · ${fmtDate(b.event.starts_at, b.event.timezone)} · ${b.tasks.length} task${b.tasks.length === 1 ? "" : "s"}`}
        actions={<button className="btn btn-primary" onClick={() => setDialog({ task: null, status: "todo" })} data-testid="button-new-task"><Icon name="plus" size={16} /> New task</button>}
      />
      <p className="text-[13px] text-muted-ink mb-4" role="status">
        {dragId !== null ? `Moving “${b.tasks.find(t => t.id === dragId)?.title ?? "task"}”. Drop it into a highlighted column.` : moving ? "Saving task position…" : "Drag a task card from its body into another column. On a phone, hold the title and drag it to a tab."}
      </p>
      <DndContext sensors={sensors} collisionDetection={boardCollision} onDragStart={({ active }) => { setDragId(Number(active.id)); void qc.cancelQueries({ queryKey: key }); }}
        onDragOver={({ over }) => { const status = over?.data.current?.status as TaskStatus | undefined; if (status && window.matchMedia("(max-width: 899px)").matches) setMobileCol(status); }}
        onDragCancel={() => setDragId(null)} onDragEnd={finishDrag}
        accessibility={{ screenReaderInstructions: { draggable: "Press space to pick up a task. Use arrow keys to move, space to drop, or escape to cancel. You can also use the Status selector or Move to menu." } }}>
      <div className="min-[900px]:hidden flex p-1 rounded-[12px] mb-4" style={{ background: "rgba(31,30,29,0.07)" }} role="tablist" aria-label="Task columns">
        {COLS.map((c) => (
          <TaskColumnTab key={c.id} status={c.id} label={c.label} count={columns[c.id].length} active={mobileCol === c.id} onSelect={() => setMobileCol(c.id)} />
        ))}
      </div>
      <div className="grid min-[1200px]:grid-cols-[1fr_300px] gap-5 items-start">
        <div className="grid min-[900px]:grid-cols-3 gap-4">
          {COLS.map((c) => (
            <TaskColumn key={c.id} status={c.id} label={c.label} active={mobileCol === c.id} dragging={dragId !== null}>
              <div className="flex items-center justify-between px-1">
                <h2 className="font-display text-[18px]">{c.label}</h2>
                <span className="font-mono-ui text-[12px] text-muted-ink">{columns[c.id].length}</span>
              </div>
              <SortableContext items={columns[c.id].map(t => t.id)} strategy={verticalListSortingStrategy}>
              {columns[c.id].map((t, i) => (
                <TaskCard key={t.id} b={b} t={t} index={i} colLen={columns[c.id].length}
                  onMove={(s) => moveTo(t, s)}
                  onReorder={(d) => moveTo(t, c.id, i + d)}
                  onEdit={() => setDialog({ task: t, status: t.status })}
                  onAssign={(k) => assign(t, k)}
                  onDelete={() => setConfirmDel(t)}
                  busy={moving}
                />
              ))}
              </SortableContext>
              {columns[c.id].length === 0 && (
                <div className="rounded-[16px] border-[1.5px] border-dashed px-4 py-6 text-center text-[14px] text-muted-ink" style={{ borderColor: "rgba(31,30,29,0.18)" }}>
                  {c.id === "todo" ? "Nothing waiting. Add a task or draft a plan." : c.id === "doing" ? "Drag a card here when someone starts it." : "Finished tasks land here."}
                </div>
              )}
              <button className="h-11 rounded-[14px] border-[1.5px] border-dashed text-[14px] font-semibold flex items-center justify-center gap-1.5 transition-colors hover:bg-white/60" style={{ borderColor: "#9C9A92", color: "#3D3D3A", background: "rgba(255,255,255,0.4)" }} onClick={() => setDialog({ task: null, status: c.id })} data-testid={`button-add-task-${c.id}`}>
                <Icon name="plus" size={15} /> Add task
              </button>
            </TaskColumn>
          ))}
        </div>
        <aside className="min-[1200px]:sticky min-[1200px]:top-7"><HelperPanel b={b} screen="tasks" /></aside>
      </div>
      <DragOverlay dropAnimation={null}>
        {dragId !== null && <div className="glass !p-4 shadow-xl font-semibold cursor-grabbing" style={{ maxWidth: 360 }}>{b.tasks.find(t => t.id === dragId)?.title}</div>}
      </DragOverlay>
      </DndContext>

      <TaskDialog b={b} open={!!dialog} onOpenChange={(v) => !v && setDialog(null)} task={dialog?.task ?? null} defaultStatus={dialog?.status ?? "todo"} onSave={save} saving={createTask.isPending || updateTask.isPending} />
      <ConfirmDialog open={!!confirmDel} onOpenChange={(v) => !v && setConfirmDel(null)} title="Delete this task?" description={confirmDel ? `"${confirmDel.title}" will be removed from the board and from any volunteer checklist.` : ""} confirmLabel="Delete" danger onConfirm={() => confirmDel && remove(confirmDel)} />
    </Shell>
  );
}
