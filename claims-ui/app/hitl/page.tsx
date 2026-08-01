"use client";
import { useCallback, useEffect, useMemo, useState, useOptimistic, useTransition } from "react";
import useSWR from "swr";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Clock3, Flame, ListChecks, Loader2, SortAsc, XCircle } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { HITLQueueTable } from "@/components/hitl/HITLQueueTable";
import { HITLDecisionPanel } from "@/components/hitl/HITLDecisionPanel";
import { useHITLQueue } from "@/lib/hooks/useHITLQueue";
import type { BulkClaimDecision, HITLDecision, HITLQueueItem, HITLQueueResponse } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { bulkHITLDecision, getHITLQueue } from "@/lib/api";
import { getNextQueueIndex, isEditableShortcutTarget } from "@/lib/hitl-workflow";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const PAGE_LIMIT = 20;
const MARKET_OPTIONS = ["ALL", "UAE", "KSA", "BAHRAIN", "OMAN", "QATAR", "KUWAIT", "INDIA"];

async function fetchHITLPage(page: number, marketRegion: string): Promise<HITLQueueResponse> {
  return getHITLQueue(page, PAGE_LIMIT, marketRegion);
}

function getTimestamp(value?: string, fallback = Number.POSITIVE_INFINITY) {
  if (!value) return fallback;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : fallback;
}

function compareQueueItemsByPriority(a: HITLQueueItem, b: HITLQueueItem) {
  if (a.priority !== b.priority) {
    return a.priority - b.priority;
  }

  const now = Date.now();
  const aSla = getTimestamp(a.sla_deadline);
  const bSla = getTimestamp(b.sla_deadline);
  const aOverdue = aSla < now;
  const bOverdue = bSla < now;

  if (aOverdue !== bOverdue) {
    return aOverdue ? -1 : 1;
  }

  if (aSla !== bSla) {
    return aSla - bSla;
  }

  const aCreated = getTimestamp(a.created_at, 0);
  const bCreated = getTimestamp(b.created_at, 0);

  if (aCreated !== bCreated) {
    return aCreated - bCreated;
  }

  return a.claim_reference.localeCompare(b.claim_reference);
}

function formatTimeToDeadline(deadline?: string) {
  if (!deadline) return "No due time";
  const ms = new Date(deadline).getTime() - Date.now();
  if (!Number.isFinite(ms)) return "No due time";

  const abs = Math.abs(ms);
  const hours = Math.floor(abs / (1000 * 60 * 60));
  const minutes = Math.floor((abs % (1000 * 60 * 60)) / (1000 * 60));

  if (ms < 0) {
    return hours >= 1 ? `${hours}h overdue` : `${Math.max(1, minutes)}m overdue`;
  }

  if (hours >= 24) {
    return `${Math.floor(hours / 24)}d left`;
  }

  return hours >= 1 ? `${hours}h ${minutes}m left` : `${Math.max(1, minutes)}m left`;
}

function HITLStatusCards({
  items,
  pendingCount,
  overdueCount,
  totalItems,
  isLoading,
}: {
  items: HITLQueueItem[];
  pendingCount?: number;
  overdueCount?: number;
  totalItems: number;
  isLoading: boolean;
}) {
  const now = Date.now();
  const priorityOneCount = items.filter((item) => item.priority === 1).length;
  const dueTodayCount = items.filter((item) => {
    const deadline = getTimestamp(item.sla_deadline);
    return deadline >= now && deadline - now <= 24 * 60 * 60 * 1000;
  }).length;
  const nextDeadline = items
    .map((item) => ({ item, timestamp: getTimestamp(item.sla_deadline) }))
    .filter(({ timestamp }) => Number.isFinite(timestamp))
    .sort((a, b) => a.timestamp - b.timestamp)[0]?.item;
  const visibleCount = items.length;

  // Semantic only (DESIGN_SYSTEM.md §1.2/§1.3): neutral for a plain count
  // (Pending Reviews, Next Deadline), success/warning/danger only when the
  // card's number actually communicates that status.
  const cards = [
    {
      label: "Pending Reviews",
      value: isLoading ? "..." : String(pendingCount ?? totalItems),
      detail: `${visibleCount} visible on this page`,
      icon: ListChecks,
      tone: "border-[var(--border-subtle)] text-[var(--text-secondary)]",
    },
    {
      label: "Overdue",
      value: isLoading ? "..." : String(overdueCount ?? 0),
      detail: overdueCount && overdueCount > 0 ? "Move these first" : "No overdue reviews",
      icon: AlertTriangle,
      tone: overdueCount && overdueCount > 0
        ? "border-[rgba(220,38,38,0.20)] bg-[rgba(220,38,38,0.04)] text-[var(--status-danger)]"
        : "border-[rgba(5,150,105,0.18)] bg-[rgba(5,150,105,0.04)] text-[var(--status-success)]",
    },
    {
      label: "Priority P1",
      value: isLoading ? "..." : String(priorityOneCount),
      detail: dueTodayCount > 0 ? `${dueTodayCount} due inside 24h` : "No same-day due-time pressure",
      icon: Flame,
      tone: priorityOneCount > 0
        ? "border-[rgba(217,119,6,0.20)] bg-[rgba(217,119,6,0.04)] text-[var(--status-warning)]"
        : "border-[var(--border-subtle)] text-[var(--text-secondary)]",
    },
    {
      label: "Next Deadline",
      value: isLoading ? "..." : formatTimeToDeadline(nextDeadline?.sla_deadline),
      detail: nextDeadline?.claim_reference ?? "Queue clear",
      icon: Clock3,
      tone: "border-[var(--border-subtle)] text-[var(--text-secondary)]",
    },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className={cn("dashboard-panel min-h-[132px] border", card.tone)}
        >
          <div className="relative flex h-full flex-col justify-center p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.18em] text-[var(--text-muted)]">{card.label}</p>
                <p className="mt-3 font-mono text-3xl font-black leading-none tabular-nums text-current">
                  {card.value}
                </p>
              </div>
              <span className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card-muted)] p-2.5 text-current">
                <card.icon className="h-4 w-4" />
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

const MEDICAL_TRIGGERS = new Set(["REGULATORY_VIOLATION", "MANUAL_REVIEW", "REVIEW"]);

export default function HitlPage() {
  // Badge counts come from the auto-refreshing hook (page 1, no pagination concern)
  const { queue: queueMeta } = useHITLQueue();

  const [page, setPage] = useState(1);
  const [marketRegion, setMarketRegion] = useState("ALL");
  const { data, isLoading, error, mutate } = useSWR<HITLQueueResponse>(
    `hitl/queue/page/${page}/market/${marketRegion}`,
    () => fetchHITLPage(page, marketRegion),
    {
      refreshInterval: () =>
        typeof document !== "undefined" && document.visibilityState === "hidden" ? 0 : 10_000,
      refreshWhenHidden: false,
      shouldRetryOnError: true,
      errorRetryCount: 3,
    }
  );

  const [reviewItem, setReviewItem] = useState<HITLQueueItem | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [priorityOrderEnabled, setPriorityOrderEnabled] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState<"all" | "medical" | "technical">("all");
  const [selectedClaimRefs, setSelectedClaimRefs] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState<BulkClaimDecision | null>(null);
  const [activeClaimReference, setActiveClaimReference] = useState<string | null>(null);
  const [shortcutDecision, setShortcutDecision] = useState<{ decision: HITLDecision; nonce: number } | null>(null);

  useEffect(() => {
    setPage(1);
    setSelectedClaimRefs(new Set());
  }, [marketRegion, categoryFilter]);

  const orderedItems = useMemo(() => {
    let items = data?.items ?? [];
    if (categoryFilter === "medical") {
      items = items.filter((i) => MEDICAL_TRIGGERS.has(i.trigger_reason));
    } else if (categoryFilter === "technical") {
      items = items.filter((i) => !MEDICAL_TRIGGERS.has(i.trigger_reason));
    }
    return priorityOrderEnabled ? [...items].sort(compareQueueItemsByPriority) : items;
  }, [data?.items, priorityOrderEnabled, categoryFilter]);
  const totalItems = data?.total ?? orderedItems.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_LIMIT));
  const currentPage = Math.min(page, totalPages);
  const pageStart = totalItems === 0 ? 0 : (currentPage - 1) * PAGE_LIMIT + 1;
  const pageEnd = Math.min(currentPage * PAGE_LIMIT, totalItems);

  const [optimisticItems, removeOptimisticItem] = useOptimistic(
    orderedItems,
    (state, claimReferenceToRemove: string) => {
      return state.filter(i => i.claim_reference !== claimReferenceToRemove);
    }
  );
  const [, startTransition] = useTransition();
  const visibleClaimRefs = useMemo(() => optimisticItems.map((item) => item.claim_reference), [optimisticItems]);
  const allVisibleSelected = visibleClaimRefs.length > 0 && visibleClaimRefs.every((claimRef) => selectedClaimRefs.has(claimRef));
  const someVisibleSelected = visibleClaimRefs.some((claimRef) => selectedClaimRefs.has(claimRef));

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  useEffect(() => {
    const visibleRefs = new Set(visibleClaimRefs);
    setSelectedClaimRefs((current) => {
      const next = new Set([...current].filter((claimRef) => visibleRefs.has(claimRef)));
      return next.size === current.size ? current : next;
    });
  }, [visibleClaimRefs]);

  const handleReview = useCallback((item: HITLQueueItem) => {
    setActiveClaimReference(item.claim_reference);
    setReviewItem(item);
    setPanelOpen(true);
  }, []);

  const openQueueItemAt = useCallback((index: number) => {
    const item = optimisticItems[index];
    if (!item) return;
    handleReview(item);
  }, [handleReview, optimisticItems]);

  const handleQueueStep = useCallback((direction: "next" | "previous") => {
    const currentRef = reviewItem?.claim_reference ?? activeClaimReference;
    const currentIndex = currentRef ? optimisticItems.findIndex((item) => item.claim_reference === currentRef) : -1;
    openQueueItemAt(getNextQueueIndex(currentIndex, optimisticItems.length, direction));
  }, [activeClaimReference, openQueueItemAt, optimisticItems, reviewItem?.claim_reference]);

  const handleShortcutDecision = useCallback((decision: HITLDecision) => {
    if (!panelOpen) {
      const currentIndex = activeClaimReference
        ? optimisticItems.findIndex((item) => item.claim_reference === activeClaimReference)
        : -1;
      openQueueItemAt(currentIndex >= 0 ? currentIndex : 0);
    }

    setShortcutDecision((current) => ({
      decision,
      nonce: (current?.nonce ?? 0) + 1,
    }));
  }, [activeClaimReference, openQueueItemAt, optimisticItems, panelOpen]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.metaKey || event.ctrlKey || event.altKey || isEditableShortcutTarget(event.target)) return;

      const key = event.key.toLowerCase();
      const decisions: Partial<Record<string, HITLDecision>> = {
        a: "APPROVE_AI",
        d: "DENY_CLAIM",
        e: "ESCALATE",
        o: "OVERRIDE_AMOUNT",
      };

      if (key === "j" || key === "k") {
        event.preventDefault();
        handleQueueStep(key === "j" ? "next" : "previous");
        return;
      }

      const decision = decisions[key];
      if (decision) {
        event.preventDefault();
        handleShortcutDecision(decision);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleQueueStep, handleShortcutDecision]);

  function handleToggleSelect(claimReference: string) {
    setSelectedClaimRefs((current) => {
      const next = new Set(current);
      if (next.has(claimReference)) {
        next.delete(claimReference);
      } else {
        next.add(claimReference);
      }
      return next;
    });
  }

  function handleToggleSelectAll() {
    setSelectedClaimRefs((current) => {
      const next = new Set(current);
      if (allVisibleSelected) {
        visibleClaimRefs.forEach((claimRef) => next.delete(claimRef));
      } else {
        visibleClaimRefs.forEach((claimRef) => next.add(claimRef));
      }
      return next;
    });
  }

  async function handleBulkDecision(decision: BulkClaimDecision) {
    const claimRefs = Array.from(selectedClaimRefs);
    if (claimRefs.length === 0 || bulkLoading) return;

    if (decision === "DENIED" && !window.confirm(`Deny ${claimRefs.length} selected review claim${claimRefs.length === 1 ? "" : "s"}?`)) {
      return;
    }

    setBulkLoading(decision);
    mutate(
      (current) => current
        ? { ...current, items: current.items.filter((item) => !selectedClaimRefs.has(item.claim_reference)) }
        : current,
      false,
    );

    try {
      await bulkHITLDecision(claimRefs, decision);
      toast.success(decision === "SETTLED" ? "Selected claims approved" : "Selected claims denied", {
        description: `${claimRefs.length} review claim${claimRefs.length === 1 ? "" : "s"} updated`,
      });
      setSelectedClaimRefs(new Set());
      await mutate();
    } catch {
      toast.error("Bulk action failed", {
        description: "Queue has been refreshed so you can retry safely.",
      });
      await mutate();
    } finally {
      setBulkLoading(null);
    }
  }

  return (
    <div className="acos-page">
        <PageHeader
          title="Review Queue"
        />

        <HITLStatusCards
          items={orderedItems}
          pendingCount={queueMeta?.pending_count ?? data?.pending_count}
          overdueCount={queueMeta?.overdue_count ?? data?.overdue_count}
          totalItems={totalItems}
          isLoading={isLoading}
        />

        <div className="dashboard-panel px-4 py-4 sm:px-5">
          <p className="ui-eyebrow">Queue Status</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                {queueMeta && (
                  <>
                    <Badge variant="outline">
                      {queueMeta.pending_count} pending
                    </Badge>
                    {queueMeta.overdue_count > 0 && (
                      <Badge variant="destructive">
                        {queueMeta.overdue_count} overdue
                      </Badge>
                    )}
                  </>
                )}
                <label className="inline-flex items-center gap-2 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-card-muted)] px-3 py-1 text-xs text-[var(--text-secondary)]">
                  <span className="font-semibold text-[var(--text-muted)]">Market</span>
                  <select
                    value={marketRegion}
                    onChange={(event) => setMarketRegion(event.target.value)}
                    className="bg-transparent text-xs font-semibold text-[var(--text-primary)] outline-none"
                  >
                    {MARKET_OPTIONS.map((market) => (
                      <option key={market} value={market} className="bg-[var(--bg-card)] text-[var(--text-primary)]">
                        {market}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="inline-flex rounded-full border border-[var(--border-subtle)] overflow-hidden text-xs">
                  {(["all", "medical", "technical"] as const).map((cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setCategoryFilter(cat)}
                      className={cn(
                        "px-3 py-1 font-semibold capitalize transition",
                        categoryFilter === cat
                          ? "bg-brand-primary text-white"
                          : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-card-muted)]"
                      )}
                    >
                      {cat}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setPriorityOrderEnabled((value) => !value)}
                  aria-pressed={priorityOrderEnabled}
                  className="inline-flex items-center gap-1 rounded-full border border-[var(--border-subtle)] px-2.5 py-1 text-xs text-[var(--text-secondary)] transition hover:border-[var(--border-strong)] hover:text-[var(--text-primary)]"
                >
                  <SortAsc className="h-3.5 w-3.5" />
                  {priorityOrderEnabled ? "Priority order on" : "Priority order off"}
                </button>
              </div>
            </div>

        <div className="dashboard-panel p-3 sm:p-4">
          {selectedClaimRefs.size > 0 && (
            <div className="relative mb-3 rounded-2xl border border-[rgba(37,99,235,0.18)] bg-[rgba(37,99,235,0.04)] px-4 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-semibold text-brand-primary">
                  {selectedClaimRefs.size} selected
                </span>
                <Button
                  size="sm"
                  onClick={() => handleBulkDecision("SETTLED")}
                  disabled={bulkLoading !== null}
                  loading={bulkLoading === "SETTLED"}
                >
                  {bulkLoading !== "SETTLED" && <CheckCircle2 className="h-3.5 w-3.5" />}
                  Approve selected
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => handleBulkDecision("DENIED")}
                  disabled={bulkLoading !== null}
                  loading={bulkLoading === "DENIED"}
                >
                  {bulkLoading !== "DENIED" && <XCircle className="h-3.5 w-3.5" />}
                  Deny selected
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setSelectedClaimRefs(new Set())}
                  disabled={bulkLoading !== null}
                >
                  Clear
                </Button>
                <p className="ml-auto text-xs text-[var(--text-muted)]">
                  Bulk escalation is unavailable until the service supports an escalation decision.
                </p>
              </div>
            </div>
          )}
          <div className="relative">
            <HITLQueueTable
              items={optimisticItems}
              isLoading={isLoading}
              error={error}
              onReview={handleReview}
              selectedClaimRefs={selectedClaimRefs}
              allSelected={allVisibleSelected}
              someSelected={someVisibleSelected}
              activeClaimReference={activeClaimReference}
              onToggleSelect={handleToggleSelect}
              onToggleSelectAll={handleToggleSelectAll}
            />
          </div>
        </div>

        {/* Pagination controls */}
        <div className="flex flex-col gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.025] px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <span className="text-white/46">
              Showing <span className="font-semibold text-white/74">{pageStart}–{pageEnd}</span> of{" "}
              <span className="font-semibold text-white/74">{totalItems}</span> claim details · Page{" "}
              <span className="font-semibold text-white/74">{currentPage}</span> of{" "}
              <span className="font-semibold text-white/74">{totalPages}</span>
              {marketRegion !== "ALL" && <> · Market <span className="font-semibold text-brand-primary">{marketRegion}</span></>}
            </span>
            <div className="flex items-center gap-2">
              <button
                className="ui-button-secondary px-2 py-1 disabled:opacity-30"
                disabled={currentPage <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                aria-label="Previous page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-white/42 text-xs px-1">
                {currentPage} / {totalPages}
              </span>
              <button
                className="ui-button-secondary px-2 py-1 disabled:opacity-30"
                disabled={currentPage >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                aria-label="Next page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>

        <HITLDecisionPanel
          item={reviewItem}
          open={panelOpen}
          onOpenChange={setPanelOpen}
          onSuccess={() => {
            const decidedRef = reviewItem?.claim_reference;
            if (decidedRef) {
              setSelectedClaimRefs((current) => {
                const next = new Set(current);
                next.delete(decidedRef);
                return next;
              });
            }
            mutate(
              (current) => current && decidedRef
                ? { ...current, items: current.items.filter(i => i.claim_reference !== decidedRef) }
                : current,
              false,
            );
          }}
          onOptimisticSubmit={(claimRef, actionPromise) => {
            startTransition(() => {
              removeOptimisticItem(claimRef);
            });
            actionPromise().catch((err) => {
              // Error is already toasted inside actionPromise
              // SWR will revert optimistic update on its own
              console.error("Optimistic submission failed:", err);
            });
          }}
          shortcutDecision={shortcutDecision}
        />
    </div>
  );
}
