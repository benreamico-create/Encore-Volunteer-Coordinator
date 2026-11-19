import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon, Orbs, EchoMark, Avatar } from "@/components/brand";
import { useEncore } from "@/lib/session";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";

type ShellEvent = { id: number; name: string } | null;

export function SeriesSwitcher({ onNew }: { onNew: () => void }) {
  const { series, selectedSeries, selectSeries, seriesLoading } = useEncore();
  const [, navigate] = useLocation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="max-w-full w-fit flex items-center justify-between gap-2 rounded-xl px-3 h-11 text-left transition-colors hover:bg-white/10"
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

function NavList({ event, onNavigate, mobile = false }: { event: ShellEvent; onNavigate?: () => void; mobile?: boolean }) {
  const [loc] = useLocation();
  const { toast } = useToast();
  const items: { label: string; icon: "tasks" | "people" | "plan" | "loop" | "map" | "chat" | "tag"; href: string | null; soon?: boolean }[] = [
    { label: "Plan", icon: "plan", href: event ? `/app/events/${event.id}/plan` : null },
    { label: "Tasks", icon: "tasks", href: event ? `/app/events/${event.id}/tasks` : null },
    { label: "Volunteers", icon: "people", href: event ? `/app/events/${event.id}/volunteers` : null },
    { label: "Blueprint", icon: "map", href: null, soon: true },
    { label: "Chat", icon: "chat", href: null, soon: true },
    { label: "Sponsors", icon: "tag", href: null, soon: true },
    { label: "Wrap-up", icon: "loop", href: event ? `/app/events/${event.id}/wrapup` : null },
  ];
  const visibleItems = mobile ? items.filter((item) => ["Plan", "Tasks", "Volunteers", "Blueprint", "Chat"].includes(item.label)) : items;
  return (
    <nav className={mobile ? "flex items-center justify-around gap-1" : "flex flex-col items-center gap-2"} aria-label="Main">
      {visibleItems.map((it) =>
        it.href ? (
          <Tooltip key={it.label}>
            <TooltipTrigger asChild>
              <Link key={it.label} href={it.href} onClick={onNavigate} className={mobile ? "bottom-nav-item" : "rail-icon"} aria-label={it.label} aria-current={loc === it.href || loc.startsWith(`${it.href}/`) ? "page" : undefined} data-active={loc === it.href || loc.startsWith(`${it.href}/`)} data-testid={`nav-${it.label.toLowerCase()}`}>
                <Icon name={it.icon} size={22} />{mobile && <span>{it.label}</span>}
              </Link>
            </TooltipTrigger>
            <TooltipContent side={mobile ? "top" : "right"}>{it.label}</TooltipContent>
          </Tooltip>
        ) : (
          <Tooltip key={it.label}>
            <TooltipTrigger asChild>
              <button type="button" className={mobile ? "bottom-nav-item is-disabled" : "rail-icon is-disabled"} aria-label={it.soon ? `${it.label}, coming soon` : `${it.label}, open an event first`} aria-disabled="true" title={it.soon ? `${it.label} is coming soon` : "Open an event first"} onClick={() => toast({ title: it.soon ? `${it.label} is coming soon` : "Open an event first" })} data-testid={`nav-${it.label.toLowerCase()}-disabled`}>
                <Icon name={it.icon} size={22} />{mobile && <span>{it.label}</span>}
              </button>
            </TooltipTrigger>
            <TooltipContent side={mobile ? "top" : "right"}>{it.soon ? `${it.label} · coming soon` : `${it.label} · open an event first`}</TooltipContent>
          </Tooltip>
        ),
      )}
    </nav>
  );
}

function UserMenu() {
  const { session, logout, loggingOut } = useEncore();
  const user = session?.user;
  if (!user) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="rail-avatar" aria-label={`Account: ${user.name || user.email}`} title={user.name || user.email} data-testid="button-account-menu">
          <Avatar name={user.name || user.email} size={32} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="right" className="w-[240px] rounded-xl" style={{ background: "#FEFCF0" }}>
        <DropdownMenuLabel>
          <span className="block font-semibold">{user.name || "Organizer"}</span>
          <span className="block text-[12px] text-muted-ink font-normal">{user.email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => logout()} disabled={loggingOut} className="cursor-pointer gap-2" data-testid="button-logout">
          <Icon name="logout" size={16} /> {loggingOut ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function HelperButton({ event }: { event: ShellEvent }) {
  return (
    event ? (
      <Link href={`/app/events/${event.id}/tasks`} className="rail-helper" aria-label="Ask the helper" data-testid="button-ask-helper"><Icon name="spark" size={20} /></Link>
    ) : (
      <button className="rail-helper is-disabled" disabled title="Open an event to ask the helper" aria-label="Ask the helper" data-testid="button-ask-helper"><Icon name="spark" size={20} /></button>
    )
  );
}

export function Shell({ event = null, children }: { event?: ShellEvent; children: ReactNode }) {
  const { selectedSeries } = useEncore();
  const [, navigate] = useLocation();
  const newEventPath = selectedSeries ? `/app/series/${selectedSeries.id}/events/new` : null;
  const shortName = event?.name.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join("").toUpperCase() || "EV";

  return (
    <div className="min-h-[100dvh]">
      <Orbs />
      {/* Slim floating navigation rail, 900px+ */}
      <aside className="rail hidden min-[900px]:flex fixed left-3 top-3 bottom-3 w-[72px] rounded-[22px] flex-col items-center py-3 z-30 border border-white/10 overflow-x-hidden overflow-y-auto" aria-label="Encore navigation">
        <Tooltip>
          <TooltipTrigger asChild>
            <Link href="/app" className="rail-home" aria-label="Dashboard" data-testid="link-home"><EchoMark tone="dark" size={34} /></Link>
          </TooltipTrigger>
          <TooltipContent side="right">Dashboard</TooltipContent>
        </Tooltip>
        <div className="rail-divider" />
        <Tooltip>
          <TooltipTrigger asChild>
            {event ? <Link href={`/app/events/${event.id}/plan`} className="event-tile" aria-label={`Current event: ${event.name}`} title={event.name} data-testid="link-current-event">{shortName}</Link> : <button type="button" className="event-tile is-disabled" aria-label="No event open" disabled>No</button>}
          </TooltipTrigger>
          <TooltipContent side="right">{event?.name ?? "No event open"}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            {newEventPath ? <Link href={newEventPath} className="rail-add" aria-label="Create new event" data-testid="button-rail-new-event"><Icon name="plus" size={19} /></Link> : <button type="button" className="rail-add is-disabled" aria-label="Create new event" disabled><Icon name="plus" size={19} /></button>}
          </TooltipTrigger>
          <TooltipContent side="right">Create new event</TooltipContent>
        </Tooltip>
        <div className="rail-divider" />
        <NavList event={event} />
        <div className="mt-auto flex flex-col items-center gap-3 pt-3">
          <Tooltip>
            <TooltipTrigger asChild><HelperButton event={event} /></TooltipTrigger>
            <TooltipContent side="right">Ask the helper</TooltipContent>
          </Tooltip>
          <div className="rail-divider" />
          <UserMenu />
        </div>
      </aside>

      {/* Compact bottom navigation on phones and tablets */}
      <nav className="mobile-bottom-nav min-[900px]:hidden" aria-label="Mobile navigation">
        <NavList event={event} mobile />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="bottom-nav-item" aria-label="More navigation" data-testid="button-mobile-more"><Icon name="chevron" size={21} /><span>More</span></button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top" className="w-56 rounded-xl" style={{ background: "#FEFCF0" }}>
            <DropdownMenuItem onSelect={() => navigate("/app")} className="cursor-pointer gap-2"><Icon name="home" size={16} /> Dashboard</DropdownMenuItem>
            <DropdownMenuItem disabled className="gap-2"><Icon name="tag" size={16} /> Sponsors · coming soon</DropdownMenuItem>
            {event && <DropdownMenuItem onSelect={() => navigate(`/app/events/${event.id}/wrapup`)} className="cursor-pointer gap-2"><Icon name="loop" size={16} /> Wrap-up</DropdownMenuItem>}
            {newEventPath && <DropdownMenuItem onSelect={() => navigate(newEventPath)} className="cursor-pointer gap-2"><Icon name="plus" size={16} /> New event</DropdownMenuItem>}
            <DropdownMenuSeparator />
            <div className="flex items-center justify-between px-2 py-1.5"><span className="text-[12px] text-muted-ink">Account</span><UserMenu /></div>
          </DropdownMenuContent>
        </DropdownMenu>
      </nav>

      <main className="relative px-4 pb-24 pt-5 min-[900px]:pl-[104px] min-[900px]:pr-7 min-[900px]:pt-7 min-[900px]:pb-12">
        <div className="max-w-[1180px]">{children}</div>
      </main>
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
