"use client";
import { useState } from "react";
import { Library } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/PageHeader";
import { PolicyCard } from "@/components/policies/PolicyCard";
import { PolicyUploadModal } from "@/components/policies/PolicyUploadModal";
import { LoadingSpinner } from "@/components/shared/LoadingSpinner";
import { EmptyState } from "@/components/shared/EmptyState";
import { BookOpen } from "lucide-react";
import { usePolicies } from "@/lib/hooks/usePolicies";
import { MARKET_LABELS } from "@/lib/constants";
import type { PolicyResponse } from "@/lib/types";
import Link from "next/link";

export default function PoliciesPage() {
  const { policies, isLoading, refresh } = usePolicies();
  const [uploadPolicy, setUploadPolicy] = useState<PolicyResponse | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  // Group by market — guard against non-array API responses
  const safePolicies = Array.isArray(policies) ? policies : [];
  const grouped: Record<string, PolicyResponse[]> = {};
  safePolicies.forEach((p) => {
    (grouped[p.market_region] ??= []).push(p);
  });

  function handleUpload(policy: PolicyResponse) {
    setUploadPolicy(policy);
    setModalOpen(true);
  }

  return (
    <div className="acos-page">
        <PageHeader
          title="Policy Management"
        />

        <div className="mt-6">
          <div className="glass-card px-4 py-4 sm:px-5">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="ui-eyebrow">Policy Actions</p>
                <p className="mt-1 text-sm text-text-secondary">
                  Add new policy files and manage the library without crowding the top header.
                </p>
              </div>
              <Button size="sm" className="ui-button-primary gap-1.5 text-sm font-semibold" asChild>
                <Link href="/admin/policies">
                  <Library className="h-3.5 w-3.5" />
                  Upload New Policy
                </Link>
              </Button>
            </div>
          </div>
        </div>

        {isLoading ? (
          <LoadingSpinner message="Loading policies…" />
        ) : !safePolicies.length ? (
          <EmptyState
            icon={BookOpen}
            title="No policies configured"
            description="Policy configuration is managed through the backend."
          />
        ) : (
          <div className="space-y-8">
            {Object.entries(grouped).map(([market, mPolicies]) => {
              const active = mPolicies.filter((p) => p.status === "ACTIVE");
              const inactive = mPolicies.filter((p) => p.status !== "ACTIVE");
              return (
                <section key={market}>
                  <div className="mb-3 flex items-center gap-2">
                    <h2 className="ui-eyebrow">
                      {MARKET_LABELS[market] ?? market}
                    </h2>
                    <span className="text-xs text-text-muted">
                      ({mPolicies.length}{" "}
                      {mPolicies.length === 1 ? "policy" : "policies"})
                    </span>
                  </div>

                  {active.length > 0 && (
                    <div className="mb-4">
                      <div className="mb-2 flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-[var(--status-success)]" />
                        <span className="text-xs font-medium text-[var(--status-success)]">
                          Active ({active.length})
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {active.map((p) => (
                          <PolicyCard key={p.id} policy={p} onUpload={handleUpload} />
                        ))}
                      </div>
                    </div>
                  )}

                  {inactive.length > 0 && (
                    <div>
                      <div className="mb-2 flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-text-muted" />
                        <span className="text-xs font-medium text-text-muted">
                          Inactive ({inactive.length})
                        </span>
                      </div>
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        {inactive.map((p) => (
                          <PolicyCard key={p.id} policy={p} onUpload={handleUpload} />
                        ))}
                      </div>
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}

        <PolicyUploadModal
          policy={uploadPolicy}
          policies={safePolicies}
          open={modalOpen}
          onOpenChange={(open) => {
            setModalOpen(open);
            if (!open) setUploadPolicy(null);
          }}
          onSuccess={() => {
            refresh();
          }}
        />
    </div>
  );
}
