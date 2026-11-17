import { useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon, Orbs, Wordmark, Avatar } from "@/components/brand";
import { CreateSeriesDialog } from "@/components/create-series-dialog";
import { useEncore } from "@/lib/session";

type ShellEvent = { id: number; name: string } | null;

function SeriesSwitcher({ onNew }: { onNew: () => void }) {
  const { series, selectedSeries, selectSeries, seriesLoading } = useEncore();
  const [, navigate] = useLocation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="w-full flex items-center justify-between gap-2 rounded-xl px-3 h-11 text-left transition-colors hover:bg-white/10"
        style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.10)", color: "#F0EEE6" }}
        data-testid="button-series-switcher"
      >
        <span className="truncate text-[14px] font-medium">{seriesLoading ? "Loading series" : selectedSeries?.name ?? "No series yet"}</span>
        <Icon name="chevron" size={16} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[220px] rounded-xl" style={{ background: "#FEFCF0" }}>
        <DropdownMenuLabel className="mono-label">Your series</DropdownMenuLabel>
        {series.map((s) => (
          <DropdownMenuItem key={s.id} onSelect={() => { selectSeries(s.id); navigate("/app"); }} className="cursor-pointer gap-2" data-testid={`menu-series-${s.id}`}>
            <span className="w-4">{s.id === selectedSeries?.id && <Icon name="check" size={14} />}</span>
            <span className="truncate">{s.name}</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onNew} className="cursor-pointer gap-2" data-testid="menu-new-series">
          <Icon name="plus" size={14} /> New series
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NavList({ event, onNavigate }: { event: ShellEvent; onNavigate?: () => void }) {
  const [loc] = useLocation();
  const items: { label: string; icon: "home" | "tasks" | "people" | "plan" | "loop"; href: string | null }[] = [
    { label: "Dashboard", icon: "home", href: "/app" },
    { label: "Tasks", icon: "tasks", href: event ? `/app/events/${event.id}/tasks` : null },
    { label: "Volunteers", icon: "people", href: event ? `/app/events/${event.id}/volunteers` : null },
    { label: "Plan", icon: "plan", href: event ? `/app/events/${event.id}/plan` : null },
    { label: "Recap", icon: "loop", href: event ? `/app/events/${event.id}/recap` : null },
  ];
  return (
    <nav className="flex flex-col gap-1" aria-label="Main">
      {items.map((it) =>
        it.href ? (
          <Link key={it.label} href={it.href} onClick={onNavigate} className="rail-item" data-active={loc === it.href} data-testid={`nav-${it.label.toLowerCase()}`}>
            <Icon name={it.icon} /> {it.label}
          </Link>
        ) : (
          <span key={it.label} className="rail-item" aria-disabled="true" title="Open an event first" data-testid={`nav-${it.label.toLowerCase()}-disabled`}>
            <Icon name={it.icon} /> {it.label}
          </span>
        ),
      )}
    </nav>
  );
}

function UserBlock() {
  const { session, logout, loggingOut } = useEncore();
  const user = session?.user;
  if (!user) return null;
  return (
    <div className="flex items-center gap-2.5 px-1">
      <Avatar name={user.name || user.email} />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold truncate" style={{ color: "#F0EEE6" }} data-testid="text-user-name">{user.name || "Organizer"}</div>
        <div className="text-[12px] truncate" style={{ color: "#B0AEA5" }}>{user.email}</div>
      </div>
      <button onClick={logout} disabled={loggingOut} className="w-11 h-11 inline-flex items-center justify-center rounded-full hover:bg-white/10" style={{ color: "#D1CFC5" }} aria-label="Log out" title="Log out" data-testid="button-logout">
        <Icon name="logout" size={17} />
      </button>
    </div>
  );
}

function HelperButton({ event }: { event: ShellEvent }) {
  const { session } = useEncore();
  const inner = (
    <>
      <Icon name="spark" size={16} /> Ask the helper
    </>
  );
  return (
    <div>
      {event ? (
        <Link href={`/app/events/${event.id}/tasks`} className="helper-btn" data-testid="button-ask-helper">{inner}</Link>
      ) : (
        <button className="helper-btn" disabled title="Open an event to ask the helper" data-testid="button-ask-helper">{inner}</button>
      )}
      {session && <div className="rail-label text-center mt-2" style={{ fontSize: 10 }} data-testid="text-ai-remaining">{session.ai_remaining} helper uses left</div>}
    </div>
  );
}

export function Shell({ event = null, children }: { event?: ShellEvent; children: ReactNode }) {
  const [newOpen, setNewOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-[100dvh]">
      <Orbs />
      {/* Floating sidebar, 900px+ */}
      <aside className="rail hidden min-[900px]:flex fixed left-3 top-3 bottom-3 w-[232px] rounded-[22px] flex-col p-4 z-30 border border-white/10">
        <Link href="/app" className="px-1.5 pt-1 pb-5 rounded-lg" data-testid="link-home"><Wordmark tone="dark" size={26} /></Link>
        <SeriesSwitcher onNew={() => setNewOpen(true)} />
        <div className="rail-label mt-6 mb-2 px-1.5 truncate" data-testid="text-current-event">{event ? event.name : "No event open"}</div>
        <NavList event={event} />
        <div className="mt-auto flex flex-col gap-4">
          <HelperButton event={event} />
          <div className="h-px" style={{ background: "rgba(255,255,255,0.1)" }} />
          <UserBlock />
        </div>
      </aside>

      {/* Top bar, below 900px */}
      <header className="min-[900px]:hidden sticky top-0 z-30 p-2.5">
        <div className="rail rounded-[18px] px-3 h-14 flex items-center justify-between">
          <Link href="/app" data-testid="link-home-mobile"><Wordmark tone="dark" size={22} /></Link>
          <button className="w-11 h-11 inline-flex items-center justify-center rounded-full" style={{ color: "#F0EEE6" }} onClick={() => setMenuOpen((v) => !v)} aria-expanded={menuOpen} aria-label="Menu" data-testid="button-mobile-menu">
            <Icon name={menuOpen ? "x" : "menu"} />
          </button>
        </div>
        {menuOpen && (
          <div className="rail rounded-[18px] mt-2 p-3 flex flex-col gap-3 rise">
            <SeriesSwitcher onNew={() => { setMenuOpen(false); setNewOpen(true); }} />
            <div className="rail-label px-1.5 truncate">{event ? event.name : "No event open"}</div>
            <NavList event={event} onNavigate={() => setMenuOpen(false)} />
            <HelperButton event={event} />
            <UserBlock />
          </div>
        )}
      </header>

      <main className="relative px-4 pb-16 pt-4 min-[900px]:pl-[268px] min-[900px]:pr-7 min-[900px]:pt-7">
        <div className="max-w-[1180px]">{children}</div>
      </main>
      <CreateSeriesDialog open={newOpen} onOpenChange={setNewOpen} />
    </div>
  );
}

export function PageHeader({ eyebrow, title, subtitle, actions }: { eyebrow?: string; title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between mb-7 rise">
      <div className="min-w-0">
        {eyebrow && <div className="mono-label mb-2">{eyebrow}</div>}
        <h1 className="page-title" data-testid="text-page-title">{title}</h1>
        {subtitle && <p className="text-muted-ink mt-2 max-w-[640px]">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2.5 shrink-0">{actions}</div>}
    </div>
  );
}
