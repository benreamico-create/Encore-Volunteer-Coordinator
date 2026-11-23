export const EVENT_TZ = "America/Edmonton";

function tzOffsetMs(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date);
  const m: Record<string, string> = {};
  for (const p of parts) m[p.type] = p.value;
  const asUtc = Date.UTC(+m.year, +m.month - 1, +m.day, +m.hour % 24, +m.minute, +m.second);
  return asUtc - date.getTime();
}

/** Interpret a wall-clock date ("YYYY-MM-DD") and time ("HH:mm") in tz; return UTC ISO. */
export function zonedToUtcIso(date: string, time: string, tz = EVENT_TZ): string {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = (time || "00:00").split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const off1 = tzOffsetMs(new Date(guess), tz);
  let t = guess - off1;
  const off2 = tzOffsetMs(new Date(t), tz);
  if (off2 !== off1) t = guess - off2;
  return new Date(t).toISOString();
}

export function fmtInTz(iso: string | Date, tz = EVENT_TZ, opts: Intl.DateTimeFormatOptions = {}): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, ...opts }).format(d);
}

export const fmtDate = (iso: string, tz?: string) =>
  fmtInTz(iso, tz, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
export const fmtTime = (iso: string, tz?: string) =>
  fmtInTz(iso, tz, { hour: "numeric", minute: "2-digit" });
export const fmtShort = (iso: string | Date, tz?: string) =>
  fmtInTz(iso, tz, { month: "short", day: "numeric" });

export function addDays(iso: string, days: number): Date {
  return new Date(new Date(iso).getTime() + days * 86400000);
}

export function offsetLabel(n: number): string {
  if (n === 0) return "Event day";
  const a = Math.abs(n);
  return `${a} day${a === 1 ? "" : "s"} ${n < 0 ? "before" : "after"}`;
}

export function errorMessage(err: unknown, fallback = "Something went wrong. Please try again."): string {
  const e = err as { status?: number; data?: unknown; message?: string } | null;
  const data = e?.data as Record<string, unknown> | string | null | undefined;
  if (data && typeof data === "object") {
    for (const k of ["error", "message", "detail"]) {
      const v = data[k];
      if (typeof v === "string" && v.trim()) return v;
    }
  }
  if (typeof data === "string" && data.trim() && data.length < 200) return data;
  if (e?.status === 0 || e?.message?.includes("Failed to fetch")) return "Cannot reach Encore right now. Check your connection.";
  return fallback;
}
export const errorStatus = (err: unknown) => (err as { status?: number } | null)?.status;

export const GROUPS = ["Venue and logistics", "Volunteers", "Promotion", "Event day", "Follow-up"];

const PASTELS = ["#E7DDB8", "#D6E2B8", "#E9D0C2", "#CFDCD6", "#E2D6E6", "#F0E2A8", "#D9D2C2"];
export function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}
export function pastel(seed: string) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PASTELS[h % PASTELS.length];
}

const DRAFT_KEY = (id: number) => `encore.draft.${id}`;
export function stashDraft(id: number, draft: unknown) {
  try { sessionStorage.setItem(DRAFT_KEY(id), JSON.stringify(draft)); } catch { /* storage full */ }
}
export function readDraft<T>(id: number): T | null {
  try { const s = sessionStorage.getItem(DRAFT_KEY(id)); return s ? (JSON.parse(s) as T) : null; } catch { return null; }
}
export function clearDraft(id: number) {
  try { sessionStorage.removeItem(DRAFT_KEY(id)); } catch { /* ignore */ }
}

/** Chip for task provenance. source: manual|ai_plan|signup|carryover|starter */
export function sourceChip(source: string, sourceNote: string | undefined, previousName?: string | null): { label: string; cls: string } | null {
  if (source === "carryover" || source === "starter") return { label: "From last event", cls: "chip-gold" };
  if (source === "signup") return { label: "From volunteer sign-up", cls: "chip-auto" };
  if (source === "ai_plan" && sourceNote && sourceNote.trim()) return { label: `from your ${previousName || "last event"} lesson`, cls: "chip-gold" };
  return null;
}

export function dueLabel(due: string | null | undefined): string {
  if (!due) return "";
  const d = due.slice(0, 10);
  const [y, m, day] = d.split("-").map(Number);
  if (!y || !m || !day) return "";
  return new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, day)));
}

export function publicOrigin(): string {
  return `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}`;
}

export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch {
    try {
      const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select(); const ok = document.execCommand("copy"); ta.remove(); return ok;
    } catch { return false; }
  }
}

/** Calendar date YYYY-MM-DD of an instant in tz */
export function ymdInTz(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
