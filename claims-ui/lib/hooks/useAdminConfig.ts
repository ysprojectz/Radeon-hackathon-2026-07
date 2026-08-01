import useSWR from "swr";
import { adminGetConfig } from "../api";
import type { SystemConfig } from "../types";

export function useAdminConfig() {
  const { data, error, isLoading, mutate } = useSWR<SystemConfig>(
    "admin/config",
    adminGetConfig,
    { shouldRetryOnError: false, revalidateOnFocus: false }
  );
  return { config: data, error, isLoading, refresh: mutate };
}
