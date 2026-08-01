import useSWR from "swr";
import { getHITLQueue } from "../api";
import { fetchCurrentUser } from "../auth";
import type { HITLQueueResponse } from "../types";

const HITL_QUEUE_ROLES = new Set(["ADMIN", "SENIOR_ADJUSTER", "MEDICAL_DIRECTOR"]);

export function useHITLQueue(enabled = true) {
  const { data: currentUser } = useSWR(
    enabled ? "auth/current-user-for-hitl-queue" : null,
    () => fetchCurrentUser(),
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    },
  );
  const canLoadQueue = enabled && Boolean(currentUser && HITL_QUEUE_ROLES.has(currentUser.role));

  const { data, error, isLoading, mutate } = useSWR<HITLQueueResponse>(
    canLoadQueue ? "hitl/queue" : null,
    () => getHITLQueue(),
    {
      // Use a function so SWR re-evaluates visibility on each tick.
      // Returns 0 (pause) when the tab is hidden to avoid wasted API calls.
      refreshInterval: () =>
        typeof document !== "undefined" && document.visibilityState === "hidden"
          ? 0
          : 10_000,
      refreshWhenHidden: false,   // belt-and-suspenders: explicit opt-out
      shouldRetryOnError: true,
      errorRetryCount: 3,
      errorRetryInterval: 1000,  // 1s, will exponentially increase
      revalidateOnFocus: false,
    }
  );
  return { queue: data, error, isLoading, refresh: mutate };
}
