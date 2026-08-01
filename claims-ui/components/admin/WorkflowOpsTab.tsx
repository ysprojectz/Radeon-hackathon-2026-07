"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  Clock3,
  RefreshCw,
  Workflow,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { adminGetWorkflowEvents, adminListWorkflowSagas } from "@/lib/api";
import type { WorkflowEventRecord, WorkflowSagaRecord } from "@/lib/types";
import { formatDateTime, formatRelative, truncateHash } from "@/lib/utils";
import {
  adminMetricCardClass,
  adminOutlineButtonClass,
  adminPanelClass,
  adminSectionCopyClass,
  adminSectionTitleClass,
} from "@/components/admin/admin-theme";

const SAGA_FILTERS = ["ALL", "IN_PROGRESS", "COMPLETED", "FAILED"] as const;

function sourceChannelLabel(source?: string | null) {
  const value = source ?? "API";
  return value === "ADVANCE_REGISTRY" ? "PRE_AUTH_REGISTRY" : value;
}

function SagaStatusBadge({ status }: { status: string }) {
  const normalized = status.toUpperCase();
  if (normalized === "COMPLETED") {
    return <Badge variant="default">Completed</Badge>;
  }
  if (normalized === "FAILED") {
    return <Badge variant="destructive">Failed</Badge>;
  }
  return <Badge variant="secondary">{status.replace(/_/g, " ")}</Badge>;
}

function EventBadge({ type }: { type: string }) {
  const variant =
    type.includes("ERROR") || type.includes("FAILED")
      ? "destructive"
      : type.includes("HITL")
        ? "secondary"
        : "outline";
  return <Badge variant={variant}>{type.replace(/_/g, " ")}</Badge>;
}

function MetricCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint: string;
}) {
  return (
    <div className={adminMetricCardClass}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-white/30">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-white">{value}</p>
      <p className={`mt-1 ${adminSectionCopyClass}`}>{hint}</p>
    </div>
  );
}

export function WorkflowOpsTab() {
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [sagas, setSagas] = useState<WorkflowSagaRecord[]>([]);
  const [selectedSaga, setSelectedSaga] = useState<WorkflowSagaRecord | null>(null);
  const [events, setEvents] = useState<WorkflowEventRecord[]>([]);

  const [loadingSagas, setLoadingSagas] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  
  // Track last error message to prevent toast spam
  const lastSagaErrorRef = useRef<string | null>(null);
  const lastEventsErrorRef = useRef<string | null>(null);

  const loadSagas = useCallback(
    async (filter = statusFilter, withSpinner = true) => {
      if (withSpinner) setLoadingSagas(true);
      setRefreshing(!withSpinner);
      try {
        const items = await adminListWorkflowSagas({
          status_filter: filter === "ALL" ? undefined : filter,
          limit: 80,
        });
        setSagas(items);
        setSelectedSaga((current) => {
          if (!current) return items[0] ?? null;
          return items.find((item) => item.claim_reference === current.claim_reference) ?? items[0] ?? null;
        });
        lastSagaErrorRef.current = null;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Failed to load workflow sagas";
        // Only show toast for the first unique error
        if (lastSagaErrorRef.current !== errorMsg) {
          toast.error(errorMsg);
          lastSagaErrorRef.current = errorMsg;
        }
        setSagas([]);
        setSelectedSaga(null);
      } finally {
        setLoadingSagas(false);
        setRefreshing(false);
      }
    },
    [statusFilter]
  );

  const loadEvents = useCallback(
    async (claimReference: string) => {
      setLoadingEvents(true);
      try {
        setEvents(await adminGetWorkflowEvents(claimReference));
        lastEventsErrorRef.current = null;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Failed to load workflow events";
        // Only show toast for the first unique error
        if (lastEventsErrorRef.current !== errorMsg) {
          toast.error(errorMsg);
          lastEventsErrorRef.current = errorMsg;
        }
        setEvents([]);
      } finally {
        setLoadingEvents(false);
      }
    },
    []
  );

  useEffect(() => {
    void loadSagas(statusFilter, true);
  }, [loadSagas, statusFilter]);

  useEffect(() => {
    if (selectedSaga?.claim_reference) {
      void loadEvents(selectedSaga.claim_reference);
    }
  }, [selectedSaga?.claim_reference, loadEvents]);

  const completed = useMemo(
    () => sagas.filter((item) => item.saga_status.toUpperCase() === "COMPLETED").length,
    [sagas]
  );
  const failed = useMemo(
    () => sagas.filter((item) => item.saga_status.toUpperCase() === "FAILED").length,
    [sagas]
  );
  const inProgress = useMemo(
    () => sagas.filter((item) => item.saga_status.toUpperCase() === "IN_PROGRESS").length,
    [sagas]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            Inspect live claim processing sagas, current step ownership, and per-claim event streams.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-40 border-white/8 bg-black/20 text-white">
              <SelectValue placeholder="Saga status" />
            </SelectTrigger>
            <SelectContent>
              {SAGA_FILTERS.map((item) => (
                <SelectItem key={item} value={item}>
                  {item === "ALL" ? "All statuses" : item.replace(/_/g, " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" asChild className={adminOutlineButtonClass}>
            <Link href="/admin/flows">
              <Workflow className="mr-2 h-4 w-4" />
              Process Map
            </Link>
          </Button>
          <Button variant="ghost" onClick={() => void loadSagas(statusFilter, false)} disabled={refreshing} className={adminOutlineButtonClass}>
            <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard label="Tracked Sagas" value={sagas.length} hint="Rows returned from the workflow store" />
        <MetricCard label="In Progress" value={inProgress} hint="Claims actively moving through the pipeline" />
        <MetricCard label="Completed" value={completed} hint="Claims with finalized workflow state" />
        <MetricCard label="Failed" value={failed} hint="Sagas with terminal workflow errors" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className={`${adminPanelClass} overflow-hidden border-white/8 bg-transparent`}>
          <CardHeader className="border-b border-white/8">
            <CardTitle className={adminSectionTitleClass}>Claim Processing Sagas</CardTitle>
            <CardDescription className={adminSectionCopyClass}>
              Select a row to inspect the detailed event stream for that claim.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Claim</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Current Step</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sagas.map((item) => {
                  const active = selectedSaga?.claim_reference === item.claim_reference;
                  return (
                    <TableRow
                      key={item.claim_reference}
                      data-state={active ? "selected" : undefined}
                      className="cursor-pointer"
                      onClick={() => setSelectedSaga(item)}
                    >
                      <TableCell>
                        <div>
                          <p className="font-medium">{item.claim_reference}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.tenant_id} · {sourceChannelLabel(item.source_channel)}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <SagaStatusBadge status={item.saga_status} />
                      </TableCell>
                      <TableCell>
                        <div>
                          <p className="text-sm">{item.current_step}</p>
                          {item.last_error && (
                            <p className="mt-1 line-clamp-1 text-xs text-rose-500">{item.last_error}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          <p>{formatDateTime(item.updated_at)}</p>
                          <p className="text-xs text-muted-foreground">{formatRelative(item.updated_at)}</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {!loadingSagas && sagas.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                      No workflow sagas found for this filter.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className={`${adminPanelClass} overflow-hidden border-white/8 bg-transparent`}>
          <CardHeader className="border-b border-white/8">
            <CardTitle className={adminSectionTitleClass}>Selected Workflow</CardTitle>
            <CardDescription className={adminSectionCopyClass}>
              Event-by-event trace for the selected claim processing workflow.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedSaga ? (
              <>
                <div className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <SagaStatusBadge status={selectedSaga.saga_status} />
                        <Badge variant="outline">{selectedSaga.current_step}</Badge>
                      </div>
                      <p className="mt-2 text-base font-semibold">{selectedSaga.claim_reference}</p>
                      <p className="text-xs text-muted-foreground">
                        Started {formatDateTime(selectedSaga.started_at)} · Updated {formatRelative(selectedSaga.updated_at)}
                      </p>
                    </div>
                    <Button variant="outline" asChild>
                      <Link href={`/claims/${selectedSaga.claim_reference}`}>Open Claim</Link>
                    </Button>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <div className="rounded-md bg-muted/30 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">Trace ID</p>
                      <p className="mt-1 font-mono text-xs">
                        {selectedSaga.trace_id ? truncateHash(selectedSaga.trace_id, 8) : "Not captured"}
                      </p>
                    </div>
                    <div className="rounded-md bg-muted/30 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">Channel</p>
                      <p className="mt-1 text-sm font-medium">{sourceChannelLabel(selectedSaga.source_channel)}</p>
                    </div>
                  </div>

                  {selectedSaga.last_error && (
                    <div className="mt-4 rounded-md border border-rose-500/20 bg-rose-500/5 px-3 py-2.5 text-sm text-rose-500">
                      <div className="flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        <span>{selectedSaga.last_error}</span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  {loadingEvents ? (
                    <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                      Loading workflow events…
                    </div>
                  ) : events.length === 0 ? (
                    <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                      No persisted workflow events found for this claim yet.
                    </div>
                  ) : (
                    events.map((event) => (
                      <div key={`${event.event_sequence}-${event.event_hash}`} className="rounded-lg border p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <Badge variant="secondary">#{event.event_sequence}</Badge>
                              <EventBadge type={event.event_type} />
                            </div>
                            <p className="mt-2 text-xs text-muted-foreground">
                              {formatDateTime(event.event_timestamp)} · {event.source_service}
                            </p>
                          </div>
                          <div className="text-right text-xs text-muted-foreground">
                            <div className="inline-flex items-center gap-1">
                              <Clock3 className="h-3 w-3" />
                              {formatRelative(event.event_timestamp)}
                            </div>
                            <p className="mt-1 font-mono">{truncateHash(event.event_hash, 8)}</p>
                          </div>
                        </div>

                        <pre className="mt-3 overflow-x-auto rounded-md bg-slate-950 p-3 text-xs text-emerald-400">
                          {JSON.stringify(event.event_payload ?? {}, null, 2)}
                        </pre>
                      </div>
                    ))
                  )}
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
                Select a saga row to inspect its workflow timeline.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
