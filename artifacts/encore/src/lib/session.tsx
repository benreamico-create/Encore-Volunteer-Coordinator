import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  useGetSession, useListSeries, useLogOut, getGetSessionQueryKey, getListSeriesQueryKey,
  type SessionInfo, type Series,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

const SERIES_KEY = "encore.series";

type Ctx = {
  session: SessionInfo | undefined;
  series: Series[];
  seriesLoading: boolean;
  seriesError: unknown;
  refetchSeries: () => void;
  selectedSeries: Series | null;
  selectSeries: (id: number) => void;
  logout: () => void;
  loggingOut: boolean;
};
const SessionCtx = createContext<Ctx | null>(null);

export function useEncore() {
  const c = useContext(SessionCtx);
  if (!c) throw new Error("useEncore outside provider");
  return c;
}

export function EncoreProvider({ session, children }: { session: SessionInfo; children: ReactNode }) {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const seriesQ = useListSeries({ query: { enabled: !!session.user, queryKey: getListSeriesQueryKey() } });
  const [selectedId, setSelectedId] = useState<number | null>(() => {
    const v = Number(localStorage.getItem(SERIES_KEY));
    return Number.isFinite(v) && v > 0 ? v : null;
  });
  const list = useMemo(() => seriesQ.data ?? [], [seriesQ.data]);
  const selectedSeries = useMemo(
    () => list.find((s) => s.id === selectedId) ?? list[0] ?? null,
    [list, selectedId],
  );
  useEffect(() => {
    if (selectedSeries && selectedSeries.id !== selectedId) setSelectedId(selectedSeries.id);
  }, [selectedSeries, selectedId]);

  const selectSeries = useCallback((id: number) => {
    setSelectedId(id);
    localStorage.setItem(SERIES_KEY, String(id));
  }, []);

  const logoutM = useLogOut();
  const logout = () => {
    logoutM.mutate(undefined, {
      onSuccess: () => {
        localStorage.removeItem(SERIES_KEY);
        qc.clear();
        qc.setQueryData(getGetSessionQueryKey(), { ...session, user: null });
        navigate("/");
        qc.invalidateQueries({ queryKey: getGetSessionQueryKey() });
        toast({ title: "Logged out", description: "See you at the next one." });
      },
      onError: () => {
        toast({ title: "Could not log out", description: "Please try again. Your session is still active.", variant: "destructive" });
      },
    });
  };

  return (
    <SessionCtx.Provider
      value={{
        session, series: list, seriesLoading: seriesQ.isLoading, seriesError: seriesQ.error,
        refetchSeries: () => void seriesQ.refetch(), selectedSeries, selectSeries, logout, loggingOut: logoutM.isPending,
      }}
    >
      {children}
    </SessionCtx.Provider>
  );
}

export function useSessionQuery() {
  return useGetSession({ query: { queryKey: getGetSessionQueryKey(), retry: 1, staleTime: 30_000 } });
}
