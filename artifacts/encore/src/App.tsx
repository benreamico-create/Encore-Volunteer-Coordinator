import { useEffect, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import AuthPage from '@/pages/auth';
import DashboardPage from '@/pages/dashboard';
import NewEventPage from '@/pages/new-event';
import PlanPage from '@/pages/plan';
import TasksPage from '@/pages/tasks';
import VolunteersPage from '@/pages/volunteers';
import RecapPage from '@/pages/recap';
import NextEventPage from '@/pages/next';
import JoinPage from '@/pages/join';
import VolunteerPrivatePage from '@/pages/volunteer';
import { EncoreProvider, useSessionQuery } from '@/lib/session';
import { EchoMark, ErrorPanel, Orbs } from '@/components/brand';
import { errorMessage } from '@/lib/encore';
import { Route, Switch, useLocation, useParams, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

function Splash() {
  return (
    <div className="min-h-[100dvh] flex items-center justify-center" data-testid="status-loading-session">
      <Orbs />
      <div className="flex flex-col items-center gap-4 rise">
        <EchoMark size={56} className="twinkle" />
        <span className="mono-label">Opening encore</span>
      </div>
    </div>
  );
}

function Redirect({ to }: { to: string }) {
  const [, navigate] = useLocation();
  useEffect(() => { navigate(to, { replace: true }); }, [to, navigate]);
  return <Splash />;
}

function LegacyWrapupRedirect() {
  const params = useParams<{ id: string }>();
  return <Redirect to={`/app/events/${params.id}/wrapup`} />;
}

function Gate() {
  const session = useSessionQuery();
  const [location] = useLocation();
  if (session.isLoading) return <Splash />;
  if (session.isError || !session.data) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center p-5">
        <Orbs />
        <div className="max-w-[440px] w-full">
          <ErrorPanel title="Encore could not start" message={errorMessage(session.error)} onRetry={() => void session.refetch()} />
        </div>
      </div>
    );
  }
  const user = session.data.user;
  const inApp = location === '/app' || location.startsWith('/app/');
  if (!user && inApp) return <Redirect to="/" />;
  if (user && location === '/') return <Redirect to="/app" />;

  return (
    <EncoreProvider session={session.data}>
      <RoutedErrorBoundary>
        <Switch>
          <Route path="/" component={AuthPage} />
          <Route path="/app" component={DashboardPage} />
          <Route path="/app/series/:id/events/new" component={NewEventPage} />
          <Route path="/app/events/:id/plan" component={PlanPage} />
          <Route path="/app/events/:id/tasks" component={TasksPage} />
          <Route path="/app/events/:id/volunteers" component={VolunteersPage} />
          <Route path="/app/events/:id/wrapup" component={RecapPage} />
          <Route path="/app/events/:id/recap" component={LegacyWrapupRedirect} />
          <Route path="/app/events/:id/next" component={NextEventPage} />
          <Route component={NotFound} />
        </Switch>
      </RoutedErrorBoundary>
    </EncoreProvider>
  );
}

function Entry() {
  const [location] = useLocation();
  if (location.startsWith('/join/') || location.startsWith('/v/')) {
    return (
      <RoutedErrorBoundary>
        <Switch>
          <Route path="/join/:slug" component={JoinPage} />
          <Route path="/v/:token" component={VolunteerPrivatePage} />
          <Route component={NotFound} />
        </Switch>
      </RoutedErrorBoundary>
    );
  }
  return <Gate />;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Entry />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
