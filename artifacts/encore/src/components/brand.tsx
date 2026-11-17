import type { CSSProperties, SVGProps } from "react";
import { initials as initialsFor, pastel as pastelFor } from "@/lib/encore";

export function EchoMark({ size = 28, tone = "light", className = "" }: { size?: number; tone?: "light" | "dark"; className?: string }) {
  const outer = tone === "dark" ? "#F0EEE6" : "#37442E";
  const mid = tone === "dark" ? "#C8D98F" : "#37442E";
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" strokeWidth={7} strokeLinecap="round" className={`echo-breathe ${className}`} aria-hidden="true">
      <path stroke={outer} d="M75.46 24.54 A36 36 0 1 0 75.46 75.46" />
      <path stroke={mid} d="M66.97 33.03 A24 24 0 1 0 66.97 66.97" />
      <path stroke={outer} d="M58.49 41.51 A12 12 0 1 0 58.49 58.49" />
    </svg>
  );
}

export function Wordmark({ tone = "light", size = 26 }: { tone?: "light" | "dark"; size?: number }) {
  return (
    <span className="echo-hover inline-flex items-center gap-2.5" data-testid="brand-wordmark">
      <EchoMark size={size} tone={tone} />
      <span className="font-display" style={{ fontSize: size * 0.85, color: tone === "dark" ? "#F0EEE6" : "#37442E", lineHeight: 1 }}>encore</span>
    </span>
  );
}

export function Star({ size = 14, className = "", style }: { size?: number; className?: string; style?: CSSProperties }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={`twinkle ${className}`} style={style} aria-hidden="true">
      <path fill="#C9A84C" d="M12 0 C12.9 7.6 16.4 11.1 24 12 C16.4 12.9 12.9 16.4 12 24 C11.1 16.4 7.6 12.9 0 12 C7.6 11.1 11.1 7.6 12 0Z" />
    </svg>
  );
}

type IconName = "home" | "tasks" | "people" | "spark" | "plan" | "loop" | "plus" | "check" | "copy" | "link" | "calendar" | "arrow" | "clock" | "chevron" | "x" | "trash" | "logout" | "menu" | "pin";
const PATHS: Record<IconName, string> = {
  home: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z",
  tasks: "M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2",
  people: "M16 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 18.5V20M10 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M20 20v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 4.15a3.5 3.5 0 0 1 0 6.7",
  spark: "M12 3c.6 4.6 2.4 6.4 7 7-4.6.6-6.4 2.4-7 7-.6-4.6-2.4-6.4-7-7 4.6-.6 6.4-2.4 7-7zM19 16c.2 1.6.8 2.2 2.4 2.4-1.6.2-2.2.8-2.4 2.4-.2-1.6-.8-2.2-2.4-2.4 1.6-.2 2.2-.8 2.4-2.4z",
  plan: "M8 4h8M6 4h-.5A1.5 1.5 0 0 0 4 5.5v14A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5v-14A1.5 1.5 0 0 0 18.5 4H18M8 11h8M8 15h5",
  loop: "M17 2l3 3-3 3M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3M20 13v2a4 4 0 0 1-4 4H4",
  plus: "M12 5v14M5 12h14",
  check: "M5 12.5l4.5 4.5L19 7",
  copy: "M9 9h10v10H9zM5 15V5h10",
  link: "M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1",
  calendar: "M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5zM4 10h16M8 3v4M16 3v4",
  arrow: "M5 12h14M13 6l6 6-6 6",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  chevron: "M8 10l4 4 4-4",
  x: "M6 6l12 12M18 6 6 18",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3",
  logout: "M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10",
  menu: "M4 7h16M4 12h16M4 17h16",
  pin: "M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21zM12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
};
export function Icon({ name, size = 18, ...rest }: { name: IconName; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      <path d={PATHS[name]} />
    </svg>
  );
}

export function Orbs() {
  return (
    <>
      <div className="orb orb-gold" style={{ width: 420, height: 420, top: -120, right: -80 }} />
      <div className="orb orb-forest" style={{ width: 520, height: 520, bottom: -200, left: 120 }} />
    </>
  );
}

export function Skel({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return <div className={`skel ${className}`} style={style} />;
}

export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  return <span className="avatar" style={{ width: size, height: size, background: `var(--av, ${pastelFor(name)})` }} title={name}>{initialsFor(name)}</span>;
}

export function ErrorPanel({ title = "That did not load", message, onRetry }: { title?: string; message: string; onRetry?: () => void }) {
  return (
    <div className="glass rise flex flex-col items-start gap-3" role="alert" data-testid="panel-error">
      <div className="mono-label" style={{ color: "#9A3A2A" }}>Error</div>
      <div className="font-display text-[22px] leading-tight">{title}</div>
      <p className="text-muted-ink">{message}</p>
      {onRetry && <button className="btn btn-secondary" onClick={onRetry} data-testid="button-retry">Try again</button>}
    </div>
  );
}
