import useSWR from "swr";
import { adminListUsers } from "../api";
import type { AdminUser } from "../types";

export function useAdminUsers() {
  const { data, error, isLoading, mutate } = useSWR<AdminUser[]>(
    "admin/users",
    adminListUsers,
    { shouldRetryOnError: false, revalidateOnFocus: false }
  );
  return { users: data ?? [], error, isLoading, refresh: mutate };
}
