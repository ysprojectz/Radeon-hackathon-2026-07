"use client";
import { useState } from "react";
import { CheckCircle, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { EmptyState } from "@/components/shared/EmptyState";
import { cn } from "@/lib/utils";
import { usePolicies } from "@/lib/hooks/usePolicies";
import { TIER_LABELS, MARKET_LABELS } from "@/lib/constants";
import type { PolicyResponse } from "@/lib/types";
import { BookOpen } from "lucide-react";

interface Step1Props {
  onNext: (policy: PolicyResponse) => void;
}

export function Step1PolicySelect({ onNext }: Step1Props) {
  const [selectedMarket, setSelectedMarket] = useState<string | undefined>();
  const [selectedPolicy, setSelectedPolicy] = useState<PolicyResponse | null>(null);
  const { policies, isLoading, error } = usePolicies(selectedMarket);

  // Group by market — guard against non-array API responses
  const safePolicies = Array.isArray(policies) ? policies : [];
  const grouped: Record<string, PolicyResponse[]> = {};
  safePolicies.forEach((p) => {
    const key = p.market_region;
    (grouped[key] ??= []).push(p);
  });

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Select Insurance Policy</h2>
      </div>

      {/* API error banner */}
      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Failed to load policies — {String(error)}. Please refresh the page.
          </AlertDescription>
        </Alert>
      )}

      {/* Market filter pills */}
      <div className="flex gap-2 flex-wrap">
        {["all", "INDIA"].map((m) => (
          <Button
            key={m}
            size="sm"
            variant={selectedMarket === (m === "all" ? undefined : m) ? "secondary" : "outline"}
            className="h-7 text-xs"
            onClick={() => setSelectedMarket(m === "all" ? undefined : m)}
          >
            {m === "all" ? "All" : MARKET_LABELS[m] ?? m}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <LoadingSpinner message="Loading policies…" />
      ) : !safePolicies.length ? (
        <EmptyState
          icon={BookOpen}
          title="No policies found"
          description="Upload policy documents on the Policies page to get started."
        />
      ) : (
        <div className="space-y-5">
          {Object.entries(grouped).map(([market, mPolicies]) => (
            <div key={market}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {MARKET_LABELS[market] ?? market}
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {mPolicies.map((p) => {
                  const isSelected = selectedPolicy?.id === p.id;
                  const isInactive = p.status !== "ACTIVE";
                  const noClauses = (p.clauses_count ?? 0) === 0;
                  return (
                    <button
                      key={p.id}
                      onClick={() => !isInactive && setSelectedPolicy(p)}
                      disabled={isInactive}
                      className={cn(
                        "text-left rounded-lg border-2 p-4 transition-all",
                        isInactive
                          ? "border-muted bg-muted/20 opacity-50 cursor-not-allowed"
                          : isSelected
                          ? "border-primary bg-primary/5"
                          : "border-muted hover:border-primary/40 hover:bg-muted/30"
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="space-y-1">
                          <p className="font-mono text-xs text-muted-foreground">
                            {p.policy_number}
                          </p>
                          <p className="font-semibold text-sm leading-tight">
                            {p.policy_name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {p.carrier_name}
                          </p>
                        </div>
                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          {isSelected && !isInactive && (
                            <CheckCircle className="h-5 w-5 text-primary" />
                          )}
                          {isInactive && (
                            <Badge
                              variant="outline"
                              className="text-xs text-muted-foreground border-muted"
                            >
                              Inactive
                            </Badge>
                          )}
                        </div>
                      </div>
                      <div className="mt-3 flex items-center gap-2 flex-wrap">
                        <Badge variant="secondary" className="text-xs">
                          {TIER_LABELS[p.tier] ?? p.tier}
                        </Badge>
                        <Badge variant="outline" className="text-xs">
                          {p.currency}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {p.annual_limit
                            ? `${p.currency} ${Number(p.annual_limit).toLocaleString()} limit`
                            : "—"}
                        </span>
                      </div>
                      {/* 0-clause warning */}
                      {!isInactive && noClauses && (
                        <p className="mt-2 flex items-center gap-1 text-xs text-[var(--status-warning)]">
                          <AlertTriangle className="h-3 w-3 shrink-0" />
                          No clauses uploaded — adjudication may be inaccurate
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-end pt-2">
        <Button
          disabled={!selectedPolicy}
          onClick={() => selectedPolicy && onNext(selectedPolicy)}
          className="gap-1.5"
        >
          Next: Upload PDF →
        </Button>
      </div>
    </div>
  );
}
