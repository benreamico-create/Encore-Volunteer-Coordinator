import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useLogIn, useSignUp, getGetSessionQueryKey, type SessionInfo } from "@workspace/api-client-react";
import { EchoMark, Orbs, Star, Wordmark, Icon } from "@/components/brand";
import { errorMessage, errorStatus } from "@/lib/encore";
import { useToast } from "@/hooks/use-toast";

type Mode = "signup" | "login";
type Errors = Partial<Record<"name" | "email" | "password" | "form", string>>;

export default function AuthPage() {
  const [mode, setMode] = useState<Mode>("signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const signUp = useSignUp();
  const logIn = useLogIn();
  const pending = signUp.isPending || logIn.isPending;

  const onDone = (s: SessionInfo) => {
    qc.clear();
    qc.setQueryData(getGetSessionQueryKey(), s);
    toast({ title: mode === "signup" ? "Account created" : "Welcome back", description: s.user?.name ? `Good to see you, ${s.user.name}.` : undefined });
    navigate("/app");
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const er: Errors = {};
    if (mode === "signup" && !name.trim()) er.name = "Tell us what to call you.";
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) er.email = "Enter a valid email address.";
    if (password.length < 8) er.password = "Use at least 8 characters.";
    setErrors(er);
    if (Object.keys(er).length) return;
    const data = { email: email.trim(), password, ...(mode === "signup" ? { name: name.trim() } : {}) };
    const onError = (err: unknown) => {
      const st = errorStatus(err);
      if (mode === "login" && (st === 401 || st === 400)) setErrors({ form: "That email and password do not match. Check both and try again." });
      else if (mode === "signup" && st === 409) setErrors({ email: "An account with this email already exists. Log in instead." });
      else setErrors({ form: errorMessage(err) });
    };
    if (mode === "signup") signUp.mutate({ data }, { onSuccess: onDone, onError });
    else logIn.mutate({ data }, { onSuccess: onDone, onError });
  };

  const switchMode = (m: Mode) => { setMode(m); setErrors({}); };

  return (
    <div className="min-h-[100dvh] relative overflow-hidden">
      <Orbs />
      <div className="absolute pointer-events-none opacity-[0.07] -right-[12vw] top-[8vh] hidden md:block" aria-hidden="true">
        <EchoMark size={760} />
      </div>
      <div className="relative max-w-[1180px] mx-auto px-5 md:px-10 py-6 md:py-10 min-h-[100dvh] flex flex-col">
        <header className="flex items-center justify-between rise">
          <Wordmark size={28} />
          <span className="mono-label hidden sm:inline">For volunteer-run, recurring events</span>
        </header>

        <div className="flex-1 grid md:grid-cols-[1.1fr_440px] gap-10 md:gap-16 items-center py-10">
          <section className="rise" style={{ animationDelay: "80ms" }}>
            <div className="mono-label mb-5 flex items-center gap-2"><Star size={12} /> Encore, for organizers</div>
            <h1 className="font-display text-[40px] sm:text-[54px] md:text-[68px] leading-[1.02] tracking-[-0.015em] text-[color:var(--ink)]">
              Plan the night.<br />
              <span style={{ color: "var(--forest)" }}>Remember it next time.</span>
            </h1>
            <p className="mt-6 text-[17px] text-muted-ink max-w-[480px]">
              Tasks, volunteers and an AI helper for small, volunteer-run events. Every event learns from the last.
            </p>
            <ol className="mt-9 grid gap-3 max-w-[460px]">
              {[
                ["01", "Describe it once", "Tasks and roles drafted from your words."],
                ["02", "Share one link", "Volunteers pick a role from their phone."],
                ["03", "Close the loop", "What you learned carries into the next event."],
              ].map(([n, t, d], i) => (
                <li key={n} className="flex gap-4 items-baseline rise" style={{ animationDelay: `${200 + i * 90}ms` }}>
                  <span className="font-mono-ui text-[12px] tracking-[0.1em]" style={{ color: "#8A7330" }}>{n}</span>
                  <span><span className="font-semibold">{t}.</span> <span className="text-muted-ink">{d}</span></span>
                </li>
              ))}
            </ol>
          </section>

          <section className="relative rise" style={{ animationDelay: "160ms" }}>
            <Star size={16} className="absolute -top-3 -left-2 z-10" />
            <Star size={12} className="absolute -bottom-2 right-8 z-10" style={{ animationDelay: "1.6s" }} />
            <form onSubmit={submit} noValidate className="glass !p-7 md:!p-8" data-testid="form-auth">
              <div className="flex p-1 rounded-full mb-6" style={{ background: "rgba(55,68,46,0.07)" }} role="tablist">
                {(["signup", "login"] as Mode[]).map((m) => (
                  <button
                    key={m} type="button" role="tab" aria-selected={mode === m} onClick={() => switchMode(m)}
                    className="flex-1 h-10 rounded-full font-mono-ui text-[11px] uppercase tracking-[0.12em] transition-all"
                    style={mode === m ? { background: "#fff", color: "var(--ink)", boxShadow: "0 2px 8px rgba(55,68,46,0.12)" } : { color: "var(--muted-ink)" }}
                    data-testid={`tab-${m}`}
                  >
                    {m === "signup" ? "New here" : "Returning"}
                  </button>
                ))}
              </div>
              <h2 className="font-display text-[26px] leading-tight mb-1">{mode === "signup" ? "Create your team space" : "Welcome back"}</h2>
              <p className="text-muted-ink text-[14px] mb-6">{mode === "signup" ? "Free while you try it. No card needed." : "Pick up where you left off."}</p>

              <div className="space-y-4">
                {mode === "signup" && (
                  <div>
                    <label className="field-label" htmlFor="name">Your name</label>
                    <input id="name" className="field" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-invalid={!!errors.name} placeholder="Your first name is fine" data-testid="input-name" />
                    {errors.name && <p className="field-error">{errors.name}</p>}
                  </div>
                )}
                <div>
                  <label className="field-label" htmlFor="email">Email</label>
                  <input id="email" type="email" className="field" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} aria-invalid={!!errors.email} placeholder="you@example.ca" data-testid="input-email" />
                  {errors.email && <p className="field-error">{errors.email}</p>}
                </div>
                <div>
                  <label className="field-label" htmlFor="password">Password</label>
                  <div className="relative">
                    <input id="password" type={showPw ? "text" : "password"} className="field pr-20" autoComplete={mode === "signup" ? "new-password" : "current-password"} value={password} onChange={(e) => setPassword(e.target.value)} maxLength={128} aria-invalid={!!errors.password} placeholder="At least 8 characters" data-testid="input-password" />
                    <button type="button" onClick={() => setShowPw((v) => !v)} className="absolute right-1.5 top-1/2 -translate-y-1/2 h-9 px-3 rounded-full font-mono-ui text-[10px] uppercase tracking-[0.12em] text-muted-ink hover:bg-black/5" data-testid="button-toggle-password">
                      {showPw ? "Hide" : "Show"}
                    </button>
                  </div>
                  {errors.password && <p className="field-error">{errors.password}</p>}
                </div>
              </div>

              {errors.form && (
                <div className="mt-5 rounded-xl px-4 py-3 text-[14px]" style={{ background: "rgba(166,64,47,0.08)", color: "#8A3426" }} role="alert" data-testid="text-auth-error">
                  {errors.form}
                </div>
              )}

              <div className="mt-6 flex flex-col gap-2.5">
                <button type="submit" className="btn btn-primary w-full" disabled={pending} data-testid="button-submit-auth">
                  {pending ? (mode === "signup" ? "Creating account" : "Logging in") : mode === "signup" ? "Create account" : "Log in"}
                  {!pending && <Icon name="arrow" size={16} />}
                </button>
                <button type="button" className="btn btn-secondary w-full" onClick={() => switchMode(mode === "signup" ? "login" : "signup")} data-testid="button-switch-mode">
                  {mode === "signup" ? "Log in" : "Create account"}
                </button>
              </div>
            </form>
          </section>
        </div>

        <footer className="mono-label flex flex-wrap gap-x-6 gap-y-2 justify-between">
          <span>Keep your RSVP tool. Encore runs the work around it.</span>
          <span>Times in America/Edmonton by default</span>
        </footer>
      </div>
    </div>
  );
}
