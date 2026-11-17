import { useState, type FormEvent } from "react";
import { useLocation, useParams } from "wouter";
import { useGetSignup, useJoinEvent, getGetSignupQueryKey } from "@workspace/api-client-react";
import { PublicFrame, PublicMessage } from "@/components/public-frame";
import { Icon, Skel } from "@/components/brand";
import { errorMessage, errorStatus, fmtInTz, fmtTime } from "@/lib/encore";

export default function JoinPage() {
  const { slug = "" } = useParams<{ slug: string }>();
  const [, navigate] = useLocation();
  const q = useGetSignup(slug, { query: { enabled: !!slug, queryKey: getGetSignupQueryKey(slug), retry: false } });
  const join = useJoinEvent();
  const [roleId, setRoleId] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [askAgain, setAskAgain] = useState(false);
  const [website, setWebsite] = useState("");
  const [err, setErr] = useState<{ role?: string; name?: string; email?: string; form?: string }>({});

  if (q.isLoading) return <PublicFrame label="Volunteer sign-up"><div data-testid="status-loading-join"><Skel className="h-10 w-3/4 mb-3" /><Skel className="h-4 w-full mb-7" />{[0, 1, 2].map((i) => <Skel key={i} className="h-[68px] mb-3 !rounded-2xl" />)}</div></PublicFrame>;
  if (q.isError || !q.data) {
    const nf = errorStatus(q.error) === 404;
    return <PublicFrame label="Volunteer sign-up"><PublicMessage title={nf ? "This link does not work" : "Could not load this page"} body={nf ? "Check the link with the organizer. It may have a typo, or the event was removed." : errorMessage(q.error)} /></PublicFrame>;
  }
  const { event: ev, roles } = q.data;
  const when = `${fmtInTz(ev.starts_at, ev.timezone, { weekday: "short", month: "short", day: "numeric" })} · ${fmtTime(ev.starts_at, ev.timezone)}`;

  if (!ev.signups_open) return (
    <PublicFrame label="Volunteer sign-up">
      <h1 className="page-title mb-2">{ev.name}</h1>
      <p className="text-muted-ink mb-6">{when}{ev.city ? ` · ${ev.city}` : ""}</p>
      <PublicMessage title="Sign-ups are closed for now" body="Thank you for wanting to help. The organizers have every spot they need or paused sign-ups. If you think this is a mistake, reach out to them directly." />
    </PublicFrame>
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const er: typeof err = {};
    if (!roleId) er.role = "Pick a role.";
    if (!name.trim()) er.name = "We need a name so the organizers know who you are.";
    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) er.email = "That email does not look right.";
    setErr(er);
    if (Object.keys(er).length) return;
    join.mutate({ slug, data: { name: name.trim(), role_id: roleId!, email: email.trim() || undefined, email_consent: !!email.trim() && consent, ask_again: askAgain, website } }, {
      onSuccess: (r) => navigate(`/v/${r.token}`),
      onError: (x) => {
        const st = errorStatus(x);
        if (st === 409) { setErr({ role: "That role just filled up. Pick another one." }); setRoleId(null); void q.refetch(); }
        else if (st === 429) setErr({ form: "Too many sign-ups from this connection. Try again in a little while." });
        else if (st === 403 || st === 410) { setErr({ form: "Sign-ups just closed." }); void q.refetch(); }
        else setErr({ form: errorMessage(x) });
      },
    });
  };

  return (
    <PublicFrame label="Volunteer sign-up">
      <h1 className="page-title rise" data-testid="text-event-name">{ev.name}</h1>
      <p className="text-muted-ink mt-2 mb-6 rise">{when}{ev.city ? ` · ${ev.city}` : ""}. Pick one role. No account needed.</p>
      {ev.place_text && <p className="flex items-center gap-2 text-[14px] -mt-3 mb-6"><Icon name="pin" size={16} /> {ev.place_text}</p>}
      <form onSubmit={submit} noValidate className="space-y-5" data-testid="form-join">
        <fieldset>
          <legend className="sr-only">Pick a role</legend>
          <div className="space-y-2.5" role="radiogroup">
            {roles.map((r) => {
              const left = r.slots_needed - r.filled;
              const full = left <= 0;
              const sel = roleId === r.id;
              return (
                <label key={r.id} className={`glass !p-4 flex items-center gap-3 transition-all ${full ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:-translate-y-0.5"}`} style={sel ? { boxShadow: "0 0 0 2px #37442E, 0 10px 30px rgba(55,68,46,0.12)" } : undefined} data-testid={`option-role-${r.id}`}>
                  <input type="radio" name="role" className="sr-only" disabled={full} checked={sel} onChange={() => setRoleId(r.id)} />
                  <span className="w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center" style={{ borderColor: sel ? "#37442E" : "rgba(31,30,29,0.3)" }}>{sel && <span className="w-2.5 h-2.5 rounded-full" style={{ background: "#37442E" }} />}</span>
                  <span className="flex-1 min-w-0"><span className="text-[15px] font-semibold block">{r.name}</span>{r.instruction && <span className="text-[12px] text-muted-ink block">{r.instruction}</span>}<span className="text-[12px] text-muted-ink">{r.filled} of {r.slots_needed} filled</span></span>
                  {full ? <span className="chip" style={{ background: "rgba(94,93,89,0.14)", color: "#3D3D3A" }}>Full</span> : <span className="chip" style={{ background: "rgba(240,214,120,0.8)", color: "#3A3200" }}>{left} spot{left === 1 ? "" : "s"} left</span>}
                </label>
              );
            })}
            {roles.length === 0 && <p className="text-muted-ink text-[14px]">The organizers have not added roles yet. Check back soon.</p>}
          </div>
          {err.role && <p className="field-error">{err.role}</p>}
        </fieldset>
        <div>
          <label className="field-label" htmlFor="j-name">Your name</label>
          <input id="j-name" className="field" value={name} maxLength={80} autoComplete="name" onChange={(e) => setName(e.target.value)} aria-invalid={!!err.name} data-testid="input-name" />
          {err.name && <p className="field-error">{err.name}</p>}
        </div>
        <div>
          <label className="field-label" htmlFor="j-email">Email <span className="text-muted-ink font-normal">(optional)</span></label>
          <input id="j-email" type="email" className="field" value={email} maxLength={254} autoComplete="email" onChange={(e) => { setEmail(e.target.value); if (!e.target.value.trim()) setConsent(false); }} aria-invalid={!!err.email} data-testid="input-email" />
          {err.email && <p className="field-error">{err.email}</p>}
        </div>
        <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
          <label htmlFor="j-website">Website</label>
          <input id="j-website" tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </div>
        <div className="space-y-3">
          {email.trim() && (
            <label className="flex gap-3 items-start text-[14px] cursor-pointer">
              <input type="checkbox" className="mt-0.5 w-5 h-5 accent-[#37442E]" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-testid="checkbox-consent" />
              <span>Email me a confirmation and reminders about this event</span>
            </label>
          )}
          <label className="flex gap-3 items-start text-[14px] cursor-pointer">
            <input type="checkbox" className="mt-0.5 w-5 h-5 accent-[#37442E]" checked={askAgain} onChange={(e) => setAskAgain(e.target.checked)} data-testid="checkbox-ask-again" />
            <span>Ask me again for future events</span>
          </label>
        </div>
        {err.form && <div className="rounded-xl px-4 py-3 text-[14px]" style={{ background: "rgba(166,64,47,0.08)", color: "#8A3426" }} role="alert">{err.form}</div>}
        <button type="submit" className="btn btn-primary w-full" disabled={join.isPending} data-testid="button-count-me-in">{join.isPending ? "Saving your spot" : "Count me in"}</button>
      </form>
    </PublicFrame>
  );
}
