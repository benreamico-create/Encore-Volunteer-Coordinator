import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateSeries, getListSeriesQueryKey } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useEncore } from "@/lib/session";
import { errorMessage } from "@/lib/encore";
import { Star } from "@/components/brand";

export function CreateSeriesDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated?: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const qc = useQueryClient();
  const { toast } = useToast();
  const { selectSeries } = useEncore();
  const m = useCreateSeries();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setErr("Give your series a name."); return; }
    setErr(null);
    m.mutate(
      { data: { name: name.trim(), description: description.trim() || undefined } },
      {
        onSuccess: (s) => {
          qc.invalidateQueries({ queryKey: getListSeriesQueryKey() });
          selectSeries(s.id);
          toast({ title: "Series created", description: s.name });
          setName(""); setDescription("");
          onOpenChange(false);
          onCreated?.();
        },
        onError: (er) => setErr(errorMessage(er)),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-0 rounded-[20px] p-0 max-w-[480px] overflow-hidden" style={{ background: "#FEFCF0" }}>
        <form onSubmit={submit} className="p-7 relative">
          <Star size={14} className="absolute top-6 right-14" />
          <div className="mono-label mb-2">New series</div>
          <DialogTitle className="font-display text-[28px] font-normal leading-tight">Name the thing you keep coming back to.</DialogTitle>
          <DialogDescription className="text-muted-ink mt-2">A series holds every edition of your event, so each one starts from the last.</DialogDescription>
          <div className="mt-6 space-y-4">
            <div>
              <label className="field-label" htmlFor="series-name">Series name</label>
              <input id="series-name" className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Calgary Builder Nights" aria-invalid={!!err && !name.trim()} autoFocus data-testid="input-series-name" />
            </div>
            <div>
              <label className="field-label" htmlFor="series-desc">What is it, in a line? <span className="text-muted-ink font-normal">(optional)</span></label>
              <textarea id="series-desc" className="field" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} placeholder="A monthly night for people building things in public." data-testid="input-series-description" />
            </div>
            {err && <p className="field-error" role="alert">{err}</p>}
          </div>
          <div className="mt-7 flex flex-wrap justify-end gap-3">
            <button type="button" className="btn btn-secondary" onClick={() => onOpenChange(false)} data-testid="button-cancel-series">Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={m.isPending} data-testid="button-create-series">{m.isPending ? "Creating" : "Create series"}</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
