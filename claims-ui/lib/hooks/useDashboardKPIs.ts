import useSWR from "swr";
import { getDashboardKPIs } from "../api";
import type { DashboardKPIs } from "../types";

interface UseDashboardKPIsOptions {
  dateFrom?: string;
  dateTo?: string;
  marketRegion?: string;
  displayCurrency?: string;
  enabled?: boolean;
  initialData?: DashboardKPIs;
}

export function useDashboardKPIs(options: UseDashboardKPIsOptions = {}) {
  const {
    dateFrom,
    dateTo,
    marketRegion,
    displayCurrency,
    enabled = true,
    initialData,
  } = options;

  const cacheKey = enabled
    ? JSON.stringify([
        "dashboard/kpis",
        dateFrom ?? "",
        dateTo ?? "",
        marketRegion ?? "",
        displayCurrency ?? "",
      ])
    : null;

  const { data, error, isLoading, mutate } = useSWR<DashboardKPIs>(
    cacheKey,
    () => getDashboardKPIs(dateFrom, dateTo, marketRegion, displayCurrency),
    {
      fallbackData: initialData,
      // Use a function so SWR re-evaluates visibility on each tick.
      // Returns 0 (pause) when the tab is hidden to avoid wasted API calls.
      refreshInterval: () =>
        typeof document !== "undefined" && document.visibilityState === "hidden"
          ? 0
          : 30_000,
      refreshWhenHidden: false,   // belt-and-suspenders: explicit opt-out
      shouldRetryOnError: true,
      errorRetryCount: 3,
      errorRetryInterval: 1000,  // 1s, will exponentially increase
      revalidateOnFocus: false,
      revalidateIfStale: true,    // Always fetch if cache is stale
      dedupingInterval: 0,        // No deduping - fetch immediately on key change
      keepPreviousData: false,    // Don't show old data while fetching new
    }
  );
  return { kpis: data, error, isLoading, refresh: mutate };
}
