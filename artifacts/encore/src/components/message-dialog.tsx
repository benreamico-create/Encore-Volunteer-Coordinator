import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Icon } from "@/components/brand";
import { copyText } from "@/lib/encore";
import { useToast } from "@/hooks/use-toast";

export function MessageDialog({ open, onOpenChange, title, initial, recipients = [], notice, loading, subject }: {
  open: boolean; onOpenChange: (v: boolean) => void; title: string; initial: string; recipients?: string[]; notice?: string; loading?: boolean; subject?: string;
}) {
  const [text, setText] = useState(initial);
  const { toast } = useToast();
  useEffect(() => { if (open) setText(initial); }, [open, initial]);
  const mailto = `mailto:${encodeURIComponent(recipients.join(","))}?subject=${encodeURIComponent(subject ?? "A note about the event")}&body=${encodeURIComponent(text)}`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-0 rounded-[20px] p-7 max-w-[560px]" style={{ background: "#FEFCF0" }}>
        <div className="mono-label flex items-center gap-2"><Icon name="spark" size={14} /> Draft, edit before sending</div>
        <DialogTitle className="font-display text-[26px] font-normal leading-tight">{title}</DialogTitle>
        <DialogDescription className="text-muted-ink text-[14px]">
          {notice || "Encore does not send this for you. Copy it, or open it in your own mail app."}
        </DialogDescription>
        {loading ? <div className="skel h-40" /> : (
          <textarea className="field text-[15px]" rows={8} value={text} onChange={(e) => setText(e.target.value)} data-testid="input-message" />
        )}
        {recipients.length > 0 && <p className="text-[13px] text-muted-ink">{recipients.length} recipient{recipients.length === 1 ? "" : "s"} with an email on file.</p>}
        <div className="flex flex-wrap justify-end gap-3 mt-1">
          <a className="btn btn-secondary" href={mailto} data-testid="link-mailto"><Icon name="link" size={15} /> Open in mail</a>
          <button className="btn btn-primary" disabled={loading || !text.trim()} onClick={async () => { const ok = await copyText(text); toast(ok ? { title: "Message copied" } : { title: "Could not copy", description: "Select the text and copy it by hand.", variant: "destructive" }); }} data-testid="button-copy-message">
            <Icon name="copy" size={15} /> Copy message
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
