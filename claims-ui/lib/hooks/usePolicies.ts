import useSWR from "swr";
import { getPolicies } from "../api";
import type { PolicyResponse } from "../types";

export function usePolicies(market_region?: string) {
  const key = ["policies", market_region ?? "all"];
  const { data, error, isLoading, mutate } = useSWR<PolicyResponse[]>(
    key,
    () => getPolicies(market_region),
    { shouldRetryOnError: false, revalidateOnFocus: false }
  );
  return { policies: data, error, isLoading, refresh: mutate };
}
