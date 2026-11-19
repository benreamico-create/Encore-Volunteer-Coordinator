import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUpdateEvent, getGetEventQueryKey, getGetDashboardQueryKey, type EventBundle } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { errorMessage, fmtDate, fmtTime, zonedToUtcIso } from "@/lib/encore";
import { useToast } from "@/hooks/use-toast";

function localFields(iso: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

function localDayDelta(from: string, to: string, timezone: string) {
  const day = (iso: string) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
    return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day));
  };
  return Math.round((day(to) - day(from)) / 86400000);
}

type EventEdit = {
  name: string; description_raw: string; starts_at: string; city: string; place_text: string;
  guests_expected: number; budget_amount: number; purpose_why: string; purpose_audience: string; purpose_takeaway: string;
};

export function EventDetailsDialog({ b, onClose }: { b: EventBundle; onClose: () => void }) {
  const ev = b.event;
  const localStart = localFields(ev.starts_at, ev.timezone);
  const initialForm = {
    name: ev.name, description_raw: ev.description_raw, ...localStart,
    city: ev.city || "", place_text: ev.place_text || "",
    guests_expected: String(ev.guests_expected ?? ""), budget_amount: String(ev.budget_amount ?? ""),
    purpose_why: ev.purpose_why || "", purpose_audience: ev.purpose_audience || "",
    purpose_takeaway: ev.purpose_takeaway || "",
  };
  const [f, setF] = useState(initialForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [closeConfirm, setCloseConfirm] = useState(false);
  const [rescheduleOpen, setRescheduleOpen] = useState(false);
  const [pendingEdit, setPendingEdit] = useState<EventEdit | null>(null);
  const [moveDueDates, setMoveDueDates] = useState(true);
  const update = useUpdateEvent();
  const qc = useQueryClient();
  const { toast } = useToast();
  const change = (key: keyof typeof f, value: string) => {
    setF(o => ({ ...o, [key]: value }));
    setErrors(o => ({ ...o, [key]: "", form: "" }));
  };

  const close = () => {
    if (update.isPending) return;
    if (JSON.stringify(f) !== JSON.stringify(initialForm)) {
      setCloseConfirm(true);
    } else onClose();
  };

  const save = (data: EventEdit, moveDates: boolean) => {
    update.mutate({ id: ev.id, data: { ...data, move_task_due_dates: moveDates } }, {
      onSuccess: async (event) => {
        qc.setQueryData<EventBundle>(getGetEventQueryKey(ev.id), old => old ? { ...old, event } : old);
        await Promise.all([
          qc.invalidateQueries({ queryKey: getGetEventQueryKey(ev.id) }),
          qc.invalidateQueries({ queryKey: getGetDashboardQueryKey(b.series.id) }),
        ]);
        toast({ title: "Event information saved" });
        onClose();
      },
      onError: error => setErrors({ form: errorMessage(error, "Could not save the event. Your changes are still here.") }),
    });
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (update.isPending) return;
    const next: Record<string, string> = {};
    if (!f.name.trim()) next.name = "Give the event a name.";
    if (!f.description_raw.trim()) next.description_raw = "Add a description.";
    if (!f.date) next.date = "Choose an event date.";
    if (!f.time) next.time = "Choose a start time.";
    if (f.guests_expected && (!/^\d+$/.test(f.guests_expected) || Number(f.guests_expected) > 100000)) next.guests_expected = "Use a whole number from 0 to 100,000.";
    if (f.budget_amount && (!Number.isFinite(Number(f.budget_amount)) || Number(f.budget_amount) < 0)) next.budget_amount = "Use an amount of 0 or more.";
    let starts_at = ev.starts_at;
    if (f.date && f.time) {
      try {
        starts_at = f.date === localStart.date && f.time === localStart.time
          ? ev.starts_at : zonedToUtcIso(f.date, f.time, ev.timezone);
        const roundtrip = localFields(starts_at, ev.timezone);
        if (roundtrip.date !== f.date || roundtrip.time !== f.time) next.time = `That local time does not exist in ${ev.timezone}. Choose another time.`;
      } catch { next.date = "Choose a valid date and time."; }
    }
    setErrors(next);
    if (Object.keys(next).length) return;
    const data: EventEdit = {
      name: f.name.trim(), description_raw: f.description_raw.trim(), starts_at,
      city: f.city.trim(), place_text: f.place_text.trim(),
      guests_expected: f.guests_expected ? Number(f.guests_expected) : 0,
      budget_amount: f.budget_amount ? Number(f.budget_amount) : 0,
      purpose_why: f.purpose_why.trim(), purpose_audience: f.purpose_audience.trim(),
      purpose_takeaway: f.purpose_takeaway.trim(),
    };
    const dueDatesExist = b.tasks.some((task) => !!task.due_date);
    if (starts_at !== ev.starts_at && dueDatesExist) {
      setPendingEdit(data);
      setMoveDueDates(true);
      setRescheduleOpen(true);
      return;
    }
    save(data, false);
  };

  const volunteers = b.volunteers.filter((volunteer) => volunteer.status === "confirmed");
  const dueTasks = b.tasks.filter((task) => !!task.due_date);
  const dayDelta = pendingEdit ? localDayDelta(ev.starts_at, pendingEdit.starts_at, ev.timezone) : 0;
  const shareMessage = pendingEdit
    ? `Hi everyone, ${pendingEdit.name}'s event date or time has changed. It is now ${fmtDate(pendingEdit.starts_at, ev.timezone)} at ${fmtTime(pendingEdit.starts_at, ev.timezone)}. Your existing private page has the updated details. Please check it before the event.`
    : "";
  const copyUpdateMessage = async () => {
    try {
      await navigator.clipboard.writeText(shareMessage);
      toast({ title: "Message copied" });
    } catch {
      toast({ title: "Could not copy the message", description: "Select and copy the message text manually.", variant: "destructive" });
    }
  };

  const field = (key: keyof typeof f, label: string, type = "text", maxLength?: number) => (
    <div key={key}>
      <label className="field-label" htmlFor={`edit-event-${key}`}>{label}</label>
      <input id={`edit-event-${key}`} className="field" type={type} value={f[key]} maxLength={maxLength}
        min={type === "number" ? 0 : undefined} max={key === "guests_expected" ? 100000 : undefined}
        step={key === "budget_amount" ? "0.01" : undefined}
        onChange={e => change(key, e.target.value)} aria-invalid={!!errors[key]}
        aria-describedby={errors[key] ? `error-event-${key}` : undefined}
        data-testid={`input-edit-event-${key}`} />
      {errors[key] && <p className="field-error" id={`error-event-${key}`}>{errors[key]}</p>}
    </div>
  );

  return (
    <>
    <Dialog open onOpenChange={open => { if (!open) close(); }}>
      <DialogContent className="border-0 rounded-[20px] p-0 w-[calc(100%-2rem)] max-w-[640px] max-h-[90dvh] overflow-y-auto" style={{ background: "#FEFCF0" }}>
        <form onSubmit={submit} noValidate className="p-5 sm:p-7 space-y-5" data-testid="form-edit-event">
          <div>
            <DialogTitle className="font-display text-[26px] font-normal">Edit details</DialogTitle>
            <DialogDescription className="mt-2 text-muted-ink">Update the overview without redrafting your plan or changing your tasks and volunteer signups.</DialogDescription>
          </div>
          <fieldset disabled={update.isPending} className="space-y-4">
            {field("name", "Event name", "text", 160)}
            <div className="grid sm:grid-cols-2 gap-4">
              {field("date", "Date", "date")}
              {field("time", "Start time", "time")}
            </div>
            <p className="text-[13px] text-muted-ink !mt-2">Times are in {ev.timezone}. If you change the date, you can choose whether unfinished task deadlines move with it.</p>
            <div className="grid sm:grid-cols-2 gap-4">
              {field("city", "City", "text", 160)}
              {field("place_text", "Place or address", "text", 500)}
              {field("guests_expected", "Expected guests", "number")}
              {field("budget_amount", "Budget (CAD)", "number")}
            </div>
            <div>
              <label className="field-label" htmlFor="edit-event-description_raw">Description</label>
              <textarea id="edit-event-description_raw" className="field" rows={4} maxLength={10000} value={f.description_raw}
                onChange={e => change("description_raw", e.target.value)} aria-invalid={!!errors.description_raw}
                data-testid="input-edit-event-description_raw" />
              {errors.description_raw && <p className="field-error">{errors.description_raw}</p>}
            </div>
            <div className="pt-3 border-t space-y-4" style={{ borderColor: "var(--line)" }}>
              <h3 className="mono-label">Purpose (optional)</h3>
              {field("purpose_why", "Why this event", "text", 2000)}
              {field("purpose_audience", "Who it is for", "text", 2000)}
              {field("purpose_takeaway", "What people leave with", "text", 2000)}
            </div>
          </fieldset>
          {errors.form && <p className="field-error" role="alert">{errors.form}</p>}
          <div className="flex justify-end gap-3 pt-2 sticky bottom-0 py-3" style={{ background: "#FEFCF0" }}>
            <button type="button" className="btn btn-secondary" onClick={close} disabled={update.isPending}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={update.isPending} data-testid="button-save-event">{update.isPending ? "Saving…" : "Save changes"}</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
    <ConfirmDialog open={closeConfirm} onOpenChange={setCloseConfirm} title="Discard unsaved changes?" description="Your event details have not been saved." confirmLabel="Discard changes" danger onConfirm={() => { setCloseConfirm(false); onClose(); }} />
    <AlertDialog open={rescheduleOpen} onOpenChange={setRescheduleOpen}>
      <AlertDialogContent className="border-0 rounded-[20px] max-w-[520px] p-6" style={{ background: "#FEFCF0" }}>
        <AlertDialogTitle className="font-display text-[24px] font-normal">Move task due dates by {dayDelta} day{Math.abs(dayDelta) === 1 ? "" : "s"}?</AlertDialogTitle>
        <AlertDialogDescription className="text-muted-ink">
          {dueTasks.length} task{dueTasks.length === 1 ? " has" : "s have"} due dates. Completed tasks stay unchanged. Your {volunteers.length} confirmed volunteer{volunteers.length === 1 ? "" : "s"} will see the new event details on their existing private page.
        </AlertDialogDescription>
        <label className="flex items-start gap-3 rounded-xl border p-3 text-[14px]" style={{ borderColor: "var(--line)" }}>
          <input type="checkbox" className="mt-1 accent-[#37442E]" checked={moveDueDates} onChange={(e) => setMoveDueDates(e.target.checked)} data-testid="checkbox-move-due-dates" />
          <span>Move unfinished task due dates by {dayDelta} day{Math.abs(dayDelta) === 1 ? "" : "s"} (recommended)</span>
        </label>
        {volunteers.length > 0 && (
          <div className="rounded-xl p-3 text-[14px]" style={{ background: "rgba(55,68,46,0.06)" }}>
            <p className="whitespace-pre-wrap">{shareMessage}</p>
            <button type="button" className="btn btn-secondary btn-sm mt-3" onClick={copyUpdateMessage} data-testid="button-copy-date-change-message">Copy message</button>
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-3">
          <AlertDialogCancel className="btn btn-secondary" onClick={() => setPendingEdit(null)}>Back</AlertDialogCancel>
          <AlertDialogAction className="btn btn-primary" onClick={() => { if (pendingEdit) save(pendingEdit, moveDueDates); setRescheduleOpen(false); setPendingEdit(null); }}>
            Save changes
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
