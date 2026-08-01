import useSWR from "swr";
import { getClaim, getClaimAudit, getClaimSettlement } from "../api";
import type { ClaimResponse, AuditTrailResponse, SettlementResponse } from "../types";

export function useClaimDetail(reference: string | null) {
  const { data: claim, error: claimError, isLoading: claimLoading } =
    useSWR<ClaimResponse>(
      reference ? `claims/${reference}` : null,
      () => getClaim(reference!),
      { shouldRetryOnError: false, revalidateOnFocus: false }
    );

  const { data: audit, isLoading: auditLoading } =
    useSWR<AuditTrailResponse>(
      reference ? `claims/${reference}/audit` : null,
      () => getClaimAudit(reference!),
      { shouldRetryOnError: false, revalidateOnFocus: false }
    );

  const { data: settlement, isLoading: settlementLoading } =
    useSWR<SettlementResponse | null>(
      reference ? `claims/${reference}/settlement` : null,
      () => getClaimSettlement(reference!),
      { shouldRetryOnError: false, revalidateOnFocus: false }
    );

  // Enrich with currency from claim (API omits it from the settlement sub-object).
  // normalizeSettlement() already returns null for empty/zero settlements,
  // so we only need to patch the currency field here.
  const enrichedSettlement =
    settlement && claim && !settlement.currency
      ? { ...settlement, currency: claim.currency }
      : settlement;

  return {
    claim,
    audit,
    settlement: enrichedSettlement,
    isLoading: claimLoading || auditLoading || settlementLoading,
    // Don't let settlement/audit errors block the entire claim page
    error: claimError,
  };
}
