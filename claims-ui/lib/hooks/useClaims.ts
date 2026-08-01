import useSWR from "swr";
import { getClaims, type GetClaimsParams } from "../api";
import type { ClaimListResponse } from "../types";

interface UseClaimsOptions {
  enabled?: boolean;
}

export function useClaims(params: GetClaimsParams = {}, options: UseClaimsOptions = {}) {
  const { enabled = true } = options;
  const key = enabled ? JSON.stringify(["claims", params]) : null;
  const { data, error, isLoading, mutate } = useSWR<ClaimListResponse>(
    key,
    () => getClaims(params),
    {
      keepPreviousData: true,
      shouldRetryOnError: true,
      errorRetryCount: 3,
      errorRetryInterval: 1000,  // 1s, will exponentially increase
      revalidateOnFocus: false,
    }
  );
  return { data, error, isLoading, refresh: mutate };
}
