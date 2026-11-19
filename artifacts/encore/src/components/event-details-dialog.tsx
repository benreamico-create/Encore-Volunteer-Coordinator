import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUpdateEvent, getGetEventQueryKey, getGetDashboardQueryKey, type EventBundle } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { errorMessage, zonedToUtcIso } from "@/lib/encore";
import { useToast } from "@/hooks/use-toast";

function localFields(iso: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

export function EventDetailsDialog({ b, onClose }: { b: EventBundle; onClose: () => void }) {
  const ev = b.event;
  const initial = localFields(ev.starts_at, ev.timezone);
  const [f, setF] = useState({
    name: ev.name, description_raw: ev.description_raw, ...initial,
    city: ev.city || "", place_text: ev.place_text || "",
    guests_expected: String(ev.guests_expected ?? ""), budget_amount: String(ev.budget_amount ?? ""),
    purpose_why: ev.purpose_why || "", purpose_audience: ev.purpose_audience || "",
    purpose_takeaway: ev.purpose_takeaway || "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const update = useUpdateEvent();
  const qc = useQueryClient();
  const { toast } = useToast();
  const change = (key: keyof typeof f, value: string) => {
    setF(o => ({ ...o, [key]: value }));
    setErrors(o => ({ ...o, [key]: "", form: "" }));
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
        starts_at = f.date === initial.date && f.time === initial.time
          ? ev.starts_at : zonedToUtcIso(f.date, f.time, ev.timezone);
        const roundtrip = localFields(starts_at, ev.timezone);
        if (roundtrip.date !== f.date || roundtrip.time !== f.time) next.time = `That local time does not exist in ${ev.timezone}. Choose another time.`;
      } catch { next.date = "Choose a valid date and time."; }
    }
    setErrors(next);
    if (Object.keys(next).length) return;
    update.mutate({ id: ev.id, data: {
      name: f.name.trim(), description_raw: f.description_raw.trim(), starts_at,
      city: f.city.trim(), place_text: f.place_text.trim(),
      guests_expected: f.guests_expected ? Number(f.guests_expected) : 0,
      budget_amount: f.budget_amount ? Number(f.budget_amount) : 0,
      purpose_why: f.purpose_why.trim(), purpose_audience: f.purpose_audience.trim(),
      purpose_takeaway: f.purpose_takeaway.trim(),
    } }, {
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
    <Dialog open onOpenChange={open => { if (!open && !update.isPending) onClose(); }}>
      <DialogContent className="border-0 rounded-[20px] p-0 w-[calc(100%-2rem)] max-w-[640px] max-h-[90dvh] overflow-y-auto" style={{ background: "#FEFCF0" }}>
        <form onSubmit={submit} noValidate className="p-5 sm:p-7 space-y-5" data-testid="form-edit-event">
          <div>
            <DialogTitle className="font-display text-[26px] font-normal">Edit event information</DialogTitle>
            <DialogDescription className="mt-2 text-muted-ink">Update the overview without redrafting your plan or changing your tasks and volunteer signups.</DialogDescription>
          </div>
          <fieldset disabled={update.isPending} className="space-y-4">
            {field("name", "Event name", "text", 160)}
            <div className="grid sm:grid-cols-2 gap-4">
              {field("date", "Date", "date")}
              {field("time", "Start time", "time")}
            </div>
            <p className="text-[13px] text-muted-ink !mt-2">Times are in {ev.timezone}. Existing task due dates won’t change if you move the event.</p>
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
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={update.isPending}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={update.isPending} data-testid="button-save-event">{update.isPending ? "Saving…" : "Save changes"}</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
