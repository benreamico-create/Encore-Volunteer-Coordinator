import { useEffect, useRef, useState, type ReactNode } from "react";
import { CreateSeriesDialog } from "@/components/create-series-dialog";
import { useGetDashboard, getGetDashboardQueryKey, useGetEvent, getGetEventQueryKey } from "@workspace/api-client-react";
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

type TabKey = "plan" | "tasks" | "volunteers" | "blueprint" | "chat" | "wrapup";
const PRIMARY_TABS: { key: TabKey; label: string; icon: "plan" | "tasks" | "people" | "map" | "chat" }[] = [
  { key: "plan", label: "Plan", icon: "plan" },
  { key: "tasks", label: "Tasks", icon: "tasks" },
  { key: "volunteers", label: "Volunteers", icon: "people" },
  { key: "blueprint", label: "Blueprint", icon: "map" },
  { key: "chat", label: "Chat", icon: "chat" },
];
const TAB_KEYS: TabKey[] = ["plan", "tasks", "volunteers", "blueprint", "chat", "wrapup"];

function parseRoute(loc: string): { eventId: number | null; tab: TabKey | null } {
  const m = loc.match(/^\/app\/events\/(\d+)(?:\/([a-z]+))?/);
  if (!m) return { eventId: null, tab: null };
  const tab = (TAB_KEYS as string[]).includes(m[2] ?? "") ? (m[2] as TabKey) : null;
  return { eventId: Number(m[1]), tab };
}

function eventInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join("").toUpperCase() || "EV";
}

function UserMenu({ side = "right" }: { side?: "right" | "top" }) {
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
      <DropdownMenuContent align="end" side={side} className="w-[240px] rounded-xl" style={{ background: "#FEFCF0" }}>
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

function EventRail({ activeId, tab, onAddSeries }: { activeId: number | null; tab: TabKey | null; onAddSeries: () => void }) {
  const { selectedSeries } = useEncore();
  const [loc] = useLocation();
  const seriesId = selectedSeries?.id ?? 0;
  const dash = useGetDashboard(seriesId, { query: { enabled: !!seriesId, queryKey: getGetDashboardQueryKey(seriesId) } });
  const events = dash.data?.events ?? [];
  const known = activeId == null || events.some((e) => e.id === activeId);
  const newEventPath = selectedSeries ? `/app/series/${selectedSeries.id}/events/new` : null;
  const targetTab = tab ?? "plan";
  return (
    <aside className="event-rail" aria-label="Events">
      <Tooltip>
        <TooltipTrigger asChild>
          <Link href="/app" className="rail-home echo-hover" aria-label="Dashboard" aria-current={loc === "/app" ? "page" : undefined} data-active={loc === "/app"} data-testid="link-home"><EchoMark tone="dark" size={34} /></Link>
        </TooltipTrigger>
        <TooltipContent side="right">Dashboard</TooltipContent>
      </Tooltip>
      <div className="rail-divider" />
      <nav className="event-rail-list" aria-label={selectedSeries ? `Events in ${selectedSeries.name}` : "Events"}>
        {dash.isLoading && [0, 1, 2].map((i) => <span key={i} className="event-tile is-skeleton" aria-hidden="true" />)}
        {!known && activeId != null && (
          <span className="event-tile-wrap" data-active="true">
            <Link href={`/app/events/${activeId}/${targetTab}`} className="event-tile" aria-current="page" aria-label="Current event" data-testid={`link-event-${activeId}`}>#</Link>
          </span>
        )}
        {events.map((e) => {
          const active = e.id === activeId;
          return (
            <Tooltip key={e.id}>
              <TooltipTrigger asChild>
                <span className="event-tile-wrap" data-active={active}>
                  <Link href={`/app/events/${e.id}/${targetTab}`} className="event-tile" aria-label={e.name} aria-current={active ? "page" : undefined} data-testid={`link-event-${e.id}`}>{eventInitials(e.name)}</Link>
                </span>
              </TooltipTrigger>
              <TooltipContent side="right">{e.name}</TooltipContent>
            </Tooltip>
          );
        })}
        {dash.isError && <button type="button" className="event-tile is-disabled" onClick={() => void dash.refetch()} aria-label="Events did not load, retry" title="Retry">!</button>}
        <Tooltip>
          <TooltipTrigger asChild>
            {newEventPath ? <Link href={newEventPath} className="rail-add" aria-label="Create new event" data-testid="button-rail-new-event"><Icon name="plus" size={19} /></Link> : <button type="button" className="rail-add" aria-label="Create a series" onClick={onAddSeries} data-testid="button-rail-new-event"><Icon name="plus" size={19} /></button>}
          </TooltipTrigger>
          <TooltipContent side="right">{newEventPath ? "Create new event" : "Create a series"}</TooltipContent>
        </Tooltip>
      </nav>
      <div className="mt-auto flex flex-col items-center pt-2">
        <div className="rail-divider" />
        <UserMenu />
      </div>
    </aside>
  );
}

function SectionNav({ eventId, eventName, tab, onNavigate, onNewSeries, onClose }: { eventId: number | null; eventName: string | null; tab: TabKey | null; onNavigate: () => void; onNewSeries: () => void; onClose: () => void }) {
  const { toast } = useToast();
  const [moreOpen, setMoreOpen] = useState(tab === "wrapup");
  useEffect(() => { if (tab === "wrapup") setMoreOpen(true); }, [tab]);
  const link = (key: TabKey, label: string, icon: "plan" | "tasks" | "people" | "map" | "chat" | "loop") =>
    eventId ? (
      <Link key={key} href={`/app/events/${eventId}/${key}`} onClick={onNavigate} className="section-item" aria-current={tab === key ? "page" : undefined} data-active={tab === key} data-testid={`nav-${key}`}>
        <Icon name={icon} size={19} /><span>{label}</span>
      </Link>
    ) : (
      <button key={key} type="button" className="section-item is-disabled" aria-disabled="true" onClick={() => toast({ title: "Open an event first" })} data-testid={`nav-${key}-disabled`}>
        <Icon name={icon} size={19} /><span>{label}</span>
      </button>
    );
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="px-3 pt-4 pb-3">
        <div className="flex items-center justify-between mb-2 px-1"><span className="rail-label">Series</span><button type="button" className="section-close" onClick={onClose} aria-label="Close sections menu" data-testid="button-close-sections"><Icon name="x" size={18} /></button></div>
        <SeriesSwitcher onNew={() => { onNavigate(); onNewSeries(); }} />
      </div>
      <div className="px-4 pb-3">
        <div className="rail-label">Event</div>
        <div className="section-event-name" data-testid="text-shell-event">{eventName ?? (eventId ? "Loading event" : "Pick an event")}</div>
      </div>
      <nav className="flex flex-col gap-1 px-2.5 overflow-y-auto min-h-0" aria-label="Event sections">
        {PRIMARY_TABS.map((t) => link(t.key, t.label, t.icon))}
        <button type="button" className="section-item" aria-expanded={moreOpen} aria-controls="section-more" onClick={() => setMoreOpen((v) => !v)} data-testid="button-nav-more">
          <Icon name="chevron" size={19} style={{ transform: moreOpen ? "none" : "rotate(-90deg)", transition: "transform .15s" }} /><span>More</span>
        </button>
        {moreOpen && (
          <div id="section-more" className="flex flex-col gap-1 pl-3">
            {link("wrapup", "Wrap-up", "loop")}
            <button type="button" className="section-item is-disabled" aria-disabled="true" onClick={() => toast({ title: "Sponsors is coming soon" })} data-testid="nav-sponsors-disabled">
              <Icon name="tag" size={19} /><span>Sponsors</span><span className="section-soon">Soon</span>
            </button>
          </div>
        )}
      </nav>
      <div className="mt-auto p-3">
        {eventId ? (
          <Link href={`/app/events/${eventId}/tasks`} onClick={onNavigate} className="section-helper" data-testid="button-ask-helper"><Icon name="spark" size={18} /><span>Ask the helper</span></Link>
        ) : (
          <button type="button" className="section-helper is-disabled" disabled title="Open an event to ask the helper" data-testid="button-ask-helper"><Icon name="spark" size={18} /><span>Ask the helper</span></button>
        )}
      </div>
    </div>
  );
}

export function Shell({ event = null, children }: { event?: ShellEvent; children: ReactNode }) {
  const [loc, navigate] = useLocation();
  const route = parseRoute(loc);
  const eventId = route.eventId ?? event?.id ?? null;
  const { selectedSeries, selectSeries } = useEncore();
  const routeId = route.eventId ?? 0;
  const bundle = useGetEvent(routeId, { query: { enabled: !!routeId, queryKey: getGetEventQueryKey(routeId) } });
  const bundleSeriesId = bundle.data && bundle.data.event.id === routeId ? bundle.data.event.series_id : null;
  useEffect(() => {
    if (bundleSeriesId && bundleSeriesId !== selectedSeries?.id) selectSeries(bundleSeriesId);
  }, [bundleSeriesId, selectedSeries?.id, selectSeries]);
  const eventName = event && event.id === eventId ? event.name : bundle.data && bundle.data.event.id === eventId ? bundle.data.event.name : null;
  const [seriesOpen, setSeriesOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeDrawer = (restore = true) => {
    setDrawerOpen(false);
    if (restore) requestAnimationFrame(() => toggleRef.current?.focus());
  };
  useEffect(() => { setDrawerOpen(false); }, [loc]);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 900px)");
    const onResize = () => { if (desktop.matches) setDrawerOpen(false); };
    desktop.addEventListener("change", onResize);
    return () => desktop.removeEventListener("change", onResize);
  }, []);
  useEffect(() => {
    if (!drawerOpen) return;
    const el = drawerRef.current;
    const focusables = () => Array.from(el?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])') ?? []).filter((n) => n.offsetParent !== null);
    requestAnimationFrame(() => (el?.querySelector<HTMLElement>(".section-close") ?? focusables()[0])?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); setDrawerOpen(false); toggleRef.current?.focus(); return; }
      if (e.key !== "Tab") return;
      const f = focusables();
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && (document.activeElement === first || !el?.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !el?.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  return (
    <div className="min-h-[100dvh]">
      <Orbs />
      <EventRail activeId={eventId} tab={route.tab} onAddSeries={() => setSeriesOpen(true)} />
      <div className={`section-backdrop ${drawerOpen ? "is-open" : ""}`} onClick={() => closeDrawer()} aria-hidden="true" />
      <aside ref={drawerRef} id="section-sidebar" className={`section-sidebar ${drawerOpen ? "is-open" : ""}`} aria-label="Event navigation" {...(drawerOpen ? { role: "dialog", "aria-modal": true } : {})}>
        <SectionNav eventId={eventId} eventName={eventName} tab={route.tab} onNavigate={() => closeDrawer(false)} onNewSeries={() => setSeriesOpen(true)} onClose={() => closeDrawer()} />
      </aside>
      <main className="shell-main">
        <button ref={toggleRef} type="button" className="section-toggle" aria-expanded={drawerOpen} aria-controls="section-sidebar" onClick={() => setDrawerOpen((v) => !v)} data-testid="button-toggle-sections">
          <Icon name={drawerOpen ? "x" : "menu"} size={18} /><span>{eventName ?? "Sections"}</span>
        </button>
        <div className="max-w-[1180px]">{children}</div>
      </main>
      <CreateSeriesDialog open={seriesOpen} onOpenChange={setSeriesOpen} onCreated={() => navigate("/app")} />
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
