import { useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useDeleteAccount } from "@workspace/api-client-react";
import { EchoMark, Icon } from "@/components/brand";
import { useEncore } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";

export default function AccountPage() {
  const { session } = useEncore();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const deletion = useDeleteAccount();
  const [showDelete, setShowDelete] = useState(false);
  const [typed, setTyped] = useState("");
  const remove = () => deletion.mutate(undefined, {
    onSuccess: () => { qc.clear(); navigate("/"); },
    onError: () => toast({ title: "Account was not deleted", description: "Please try again.", variant: "destructive" }),
  });
  return (
    <main className="min-h-[100dvh] px-5 py-8 md:px-10" style={{ background: "var(--cream)" }}>
      <div className="max-w-[760px] mx-auto">
        <header className="flex items-center justify-between mb-10">
          <a href="/app" aria-label="Back to dashboard"><EchoMark size={40} /></a>
          <a href="/app" className="btn btn-secondary btn-sm"><Icon name="arrow" size={14} style={{ transform: "rotate(180deg)" }} /> Dashboard</a>
        </header>
        <div className="mono-label mb-2">Organizer settings</div>
        <h1 className="font-display text-[36px] sm:text-[46px]">Your account</h1>
        <p className="text-muted-ink mt-2">Manage your sign-in and your personal Encore data.</p>
        <section className="glass mt-7 space-y-4">
          <div><div className="field-label">Name</div><p className="text-[16px]">{session?.user?.name}</p></div>
          <div><div className="field-label">Email</div><p className="text-[16px]">{session?.user?.email}</p></div>
          <p className="text-[13px] text-muted-ink">Your organizer account is separate from volunteer sign-up links. Volunteers do not need accounts.</p>
        </section>
        <section className="glass mt-5">
          <h2 className="font-display text-[24px]">Your data</h2>
          <p className="text-muted-ink mt-1 mb-4">Download your organizer profile, event plans, tasks, roles, volunteers, sponsors and team messages. Private volunteer link tokens are excluded.</p>
          <a href="/api/account" className="btn btn-secondary btn-sm" data-testid="button-export-account"><Icon name="copy" size={15} /> Download my data</a>
        </section>
        <section className="mt-5 rounded-[18px] border border-[#a6402f]/30 bg-[#fffaf5] p-5 sm:p-6">
          <h2 className="font-display text-[24px]" style={{ color: "#8A3426" }}>Delete account</h2>
          <p className="text-[14px] text-muted-ink mt-2 mb-4">This permanently removes your account, sign-in sessions and the event series you own. Other organizers’ accounts and series are not deleted. This cannot be undone.</p>
          {!showDelete ? <button className="btn btn-sm" style={{ background: "#8A3426", color: "#fff" }} onClick={() => setShowDelete(true)} data-testid="button-start-delete">Delete my account</button> :
            <div className="space-y-3">
              <label htmlFor="confirm-delete" className="field-label">Type DELETE to confirm</label>
              <input id="confirm-delete" className="field max-w-[260px]" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" data-testid="input-confirm-delete" />
              <div className="flex gap-2">
                <button className="btn btn-secondary btn-sm" onClick={() => { setShowDelete(false); setTyped(""); }}>Keep my account</button>
                <button className="btn btn-sm" style={{ background: "#8A3426", color: "#fff" }} disabled={typed !== "DELETE" || deletion.isPending} onClick={remove} data-testid="button-confirm-delete">{deletion.isPending ? "Deleting" : "Permanently delete"}</button>
              </div>
            </div>}
        </section>
      </div>
    </main>
  );
}
