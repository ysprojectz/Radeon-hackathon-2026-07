import useSWR from "swr";
import { getCustomerAccounts, type GetCustomerAccountsParams } from "../api";
import type { CustomerAccountListResponse } from "../types";

interface UseCustomerAccountsOptions {
  enabled?: boolean;
}

export function useCustomerAccounts(
  params: GetCustomerAccountsParams = {},
  options: UseCustomerAccountsOptions = {}
) {
  const { enabled = true } = options;
  const key = enabled ? JSON.stringify(["customer-accounts", params]) : null;
  const { data, error, isLoading, isValidating, mutate } = useSWR<CustomerAccountListResponse>(
    key,
    () => getCustomerAccounts(params),
    {
      keepPreviousData: true,
      revalidateOnFocus: false,
      errorRetryCount: 2,
    }
  );
  return { data, error, isLoading, isValidating, refresh: mutate };
}
