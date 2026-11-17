import { useGetEvent, getGetEventQueryKey } from "@workspace/api-client-react";
export function useEventBundle(id: number, poll = 5000) {
  return useGetEvent(id, { query: { enabled: !!id, queryKey: getGetEventQueryKey(id), refetchInterval: poll, refetchIntervalInBackground: false } });
}
