import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogTitle } from "@/components/ui/alert-dialog";

export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel, onConfirm, danger }: {
  open: boolean; onOpenChange: (v: boolean) => void; title: string; description: string; confirmLabel: string; onConfirm: () => void; danger?: boolean;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="border-0 rounded-[20px] max-w-[440px] p-7" style={{ background: "#FEFCF0" }}>
        <AlertDialogTitle className="font-display text-[24px] font-normal leading-tight">{title}</AlertDialogTitle>
        <AlertDialogDescription className="text-muted-ink">{description}</AlertDialogDescription>
        <div className="flex flex-wrap justify-end gap-3 mt-3">
          <button className="btn btn-secondary" onClick={() => onOpenChange(false)} data-testid="button-confirm-cancel">Cancel</button>
          <button className="btn btn-primary" style={danger ? { background: "#8A3426" } : undefined} onClick={onConfirm} data-testid="button-confirm-ok">{confirmLabel}</button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
