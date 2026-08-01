"use client";

import { useEffect, useMemo, useState, useCallback } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  FilePlus2,
  RefreshCw,
  ShieldCheck,
  ShieldX,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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
import {
  adminGetComplianceDrift,
  adminIngestComplianceUpdate,
  adminListComplianceUpdates,
  adminListComplianceVerifications,
  adminRunComplianceVerification,
} from "@/lib/api";
import type {
  ComplianceDriftResult,
  ComplianceUpdateRecord,
  ComplianceVerificationRecord,
  ReliabilitySnapshot,
} from "@/lib/types";
import { formatDateTime, formatRelative, truncateHash } from "@/lib/utils";
import {
  adminActionButtonClass,
  adminMetricCardClass,
  adminOutlineButtonClass,
  adminPanelClass,
  adminSectionCopyClass,
  adminSectionTitleClass,
} from "@/components/admin/admin-theme";

const MARKETS = ["UAE", "INDIA", "SAUDI", "BAHRAIN", "OMAN", "QATAR", "KUWAIT"] as const;

const SAMPLE_CLAUSES = `[
  {
    "clause_type": "BENEFIT",
    "section_reference": "MOH-2026-OP-12",
    "title": "Outpatient specialist visit cap",
    "full_text": "Specialist consultations are reimbursable up to the approved market schedule.",
    "structured_data": {
      "limit_type": "SCHEDULED_RATE",
      "requires_preauth": false
    }
  }
]`;

function DriftBadge({ driftDetected }: { driftDetected: boolean }) {
  return driftDetected ? (
    <Badge variant="destructive" className="gap-1">
      <ShieldX className="h-3 w-3" />
      Drift detected
    </Badge>
  ) : (
    <Badge variant="default" className="gap-1">
      <ShieldCheck className="h-3 w-3" />
      In sync
    </Badge>
  );
}

function VerificationStatusBadge({ status }: { status: string }) {
  if (status === "PASSED") {
    return (
      <Badge variant="default" className="gap-1">
        <CheckCircle2 className="h-3 w-3" />
        Passed
      </Badge>
    );
  }

  if (status === "REVIEW_REQUIRED") {
    return (
      <Badge variant="destructive" className="gap-1">
        <AlertTriangle className="h-3 w-3" />
        Review required
      </Badge>
    );
  }

  return <Badge variant="secondary">{status}</Badge>;
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

export function ComplianceTab() {
  const [selectedMarket, setSelectedMarket] = useState<string>("UAE");
  const [updates, setUpdates] = useState<ComplianceUpdateRecord[]>([]);
  const [verifications, setVerifications] = useState<ComplianceVerificationRecord[]>([]);
  const [drift, setDrift] = useState<ComplianceDriftResult | null>(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [runningVerification, setRunningVerification] = useState(false);
  const [checkingDrift, setCheckingDrift] = useState(false);

  const [formMarket, setFormMarket] = useState<string>("UAE");
  const [regulatoryBody, setRegulatoryBody] = useState("");
  const [source, setSource] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [notes, setNotes] = useState("");
  const [clausesJson, setClausesJson] = useState(SAMPLE_CLAUSES);

  const loadSnapshot = useCallback(
    async (market = selectedMarket, withSpinner = true) => {
      if (withSpinner) setLoading(true);
      setRefreshing(!withSpinner);
      try {
        const [updatesData, verificationData, driftData] = await Promise.all([
          adminListComplianceUpdates(),
          adminListComplianceVerifications(12),
          adminGetComplianceDrift(market),
        ]);
        setUpdates(updatesData);
        setVerifications(verificationData);
        setDrift(driftData);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to load compliance controls");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [selectedMarket]
  );

  useEffect(() => {
    void loadSnapshot(selectedMarket, true);
  }, [loadSnapshot, selectedMarket]);

  const refreshDrift = useCallback(
    async (market: string) => {
      setCheckingDrift(true);
      try {
        setDrift(await adminGetComplianceDrift(market));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to check compliance drift");
      } finally {
        setCheckingDrift(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!loading) {
      void refreshDrift(selectedMarket);
    }
  }, [selectedMarket, loading, refreshDrift]);

  async function handleIngest() {
    setSubmitting(true);
    try {
      const parsed = JSON.parse(clausesJson);
      if (!Array.isArray(parsed)) {
        throw new Error("Clauses payload must be a JSON array");
      }
      await adminIngestComplianceUpdate({
        market: formMarket,
        regulatory_body: regulatoryBody.trim(),
        source: source.trim(),
        effective_date: effectiveDate,
        clauses: parsed,
        notes: notes.trim() || undefined,
      });
      toast.success("Compliance update ingested");
      setRegulatoryBody("");
      setSource("");
      setEffectiveDate("");
      setNotes("");
      setClausesJson(SAMPLE_CLAUSES);
      setSelectedMarket(formMarket);
      await loadSnapshot(formMarket, false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to ingest compliance update");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRunVerification() {
    setRunningVerification(true);
    try {
      const verification = await adminRunComplianceVerification(selectedMarket);
      setVerifications((current) => [verification, ...current].slice(0, 12));
      toast.success(`Verification completed for ${selectedMarket}`);
      await refreshDrift(selectedMarket);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to run verification");
    } finally {
      setRunningVerification(false);
    }
  }

  const marketUpdates = useMemo(
    () => updates.filter((item) => item.market === selectedMarket),
    [selectedMarket, updates]
  );

  const latestVerification = verifications[0];
  const latestReliability = latestVerification?.details?.reliability as ReliabilitySnapshot | undefined;
  const driftCount = useMemo(
    () =>
      verifications[0]?.details?.drift_results?.filter((item) => item.drift_detected).length ??
      (drift?.drift_detected ? 1 : 0),
    [drift, verifications]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            Ingest regulatory updates, compare live clause baselines, and capture verification workflows.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select value={selectedMarket} onValueChange={setSelectedMarket}>
            <SelectTrigger className="w-36 border-white/8 bg-black/20 text-white">
              <SelectValue placeholder="Market" />
            </SelectTrigger>
            <SelectContent>
              {MARKETS.map((market) => (
                <SelectItem key={market} value={market}>
                  {market}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={() => void refreshDrift(selectedMarket)} disabled={checkingDrift} className={adminOutlineButtonClass}>
            <ShieldCheck className={`mr-2 h-4 w-4 ${checkingDrift ? "animate-pulse" : ""}`} />
            Check Drift
          </Button>
          <Button onClick={() => void handleRunVerification()} disabled={runningVerification} className={adminActionButtonClass}>
            <ShieldCheck className={`mr-2 h-4 w-4 ${runningVerification ? "animate-pulse" : ""}`} />
            Run Verification
          </Button>
          <Button variant="ghost" onClick={() => void loadSnapshot(selectedMarket, false)} disabled={refreshing} className={adminOutlineButtonClass}>
            <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <MetricCard
          label="Tracked Updates"
          value={updates.length}
          hint="All ingested regulatory baselines"
        />
        <MetricCard
          label={`${selectedMarket} Baselines`}
          value={marketUpdates.length}
          hint="Updates available for the selected market"
        />
        <MetricCard
          label="Drift Flags"
          value={driftCount}
          hint="Latest verification items requiring policy review"
        />
        <MetricCard
          label="Open Dead Letters"
          value={latestReliability?.open_dead_letters ?? 0}
          hint="From the latest reliability verification snapshot"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card className={`${adminPanelClass} overflow-hidden border-white/8 bg-transparent`}>
          <CardHeader className="border-b border-white/8">
            <CardTitle className={adminSectionTitleClass}>Regulatory Update Ingestion</CardTitle>
            <CardDescription className={adminSectionCopyClass}>
              Store a new compliance baseline and make it available for drift comparison.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-sm font-medium">Market</label>
                <Select value={formMarket} onValueChange={setFormMarket}>
                  <SelectTrigger className="border-white/8 bg-black/20 text-white">
                    <SelectValue placeholder="Select market" />
                  </SelectTrigger>
                  <SelectContent>
                    {MARKETS.map((market) => (
                      <SelectItem key={market} value={market}>
                        {market}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Effective Date</label>
                <Input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} className="border-white/8 bg-black/20 text-white" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Regulatory Body</label>
                <Input
                  value={regulatoryBody}
                  onChange={(e) => setRegulatoryBody(e.target.value)}
                  placeholder="e.g. DHA, IRDAI, CCHI"
                  className="border-white/8 bg-black/20 text-white placeholder:text-white/24"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Source</label>
                <Input
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  placeholder="URL or bulletin reference"
                  className="border-white/8 bg-black/20 text-white placeholder:text-white/24"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Notes</label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Summarize what changed and why operations should care."
                className="min-h-20 border-white/8 bg-black/20 text-white placeholder:text-white/24"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Clause Payload</label>
              <Textarea
                value={clausesJson}
                onChange={(e) => setClausesJson(e.target.value)}
                className="min-h-56 border-white/8 bg-black/20 font-mono text-xs text-white"
                spellCheck={false}
              />
              <p className={adminSectionCopyClass}>
                Paste a JSON array of clause objects. The hash of this payload becomes the baseline for drift detection.
              </p>
            </div>

            <div className="flex justify-end">
              <Button onClick={() => void handleIngest()} disabled={submitting} className={adminActionButtonClass}>
                <FilePlus2 className="mr-2 h-4 w-4" />
                {submitting ? "Ingesting…" : "Ingest Update"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className={`${adminPanelClass} overflow-hidden border-white/8 bg-transparent`}>
          <CardHeader className="border-b border-white/8">
            <CardTitle className={adminSectionTitleClass}>Live Drift Status</CardTitle>
            <CardDescription className={adminSectionCopyClass}>
              Compares the selected market&apos;s active runtime clauses against the latest ingested baseline.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold">{selectedMarket}</p>
                <p className="text-xs text-muted-foreground">
                  {drift?.has_update ? "Baseline available" : "No baseline ingested yet"}
                </p>
              </div>
              {drift ? <DriftBadge driftDetected={drift.drift_detected} /> : <Badge variant="secondary">Pending</Badge>}
            </div>

            <div className="rounded-lg border bg-muted/20 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Current Runtime Hash
              </p>
              <p className="mt-2 break-all font-mono text-xs">{truncateHash(drift?.current_hash ?? "", 10)}</p>
            </div>

            <div className="rounded-lg border bg-muted/20 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Expected Baseline Hash
              </p>
              <p className="mt-2 break-all font-mono text-xs">
                {drift?.expected_hash ? truncateHash(drift.expected_hash, 10) : "No baseline captured"}
              </p>
            </div>

            {drift?.latest_update ? (
              <div className="rounded-lg border border-dashed p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{drift.latest_update.regulatory_body}</p>
                    <p className="text-xs text-muted-foreground">{drift.latest_update.source}</p>
                  </div>
                  <Badge variant="outline">{drift.latest_update.clause_count} clauses</Badge>
                </div>
                <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                  <p>Effective: {drift.latest_update.effective_date}</p>
                  <p>Uploaded {formatRelative(drift.latest_update.uploaded_at)} by {drift.latest_update.uploaded_by}</p>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                Ingest a regulatory update to activate drift comparisons for this market.
              </div>
            )}

            {latestReliability && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border px-3 py-2.5">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">Idempotency Replays</p>
                  <p className="mt-1 text-lg font-semibold">{latestReliability.idempotency_replays ?? 0}</p>
                </div>
                <div className="rounded-lg border px-3 py-2.5">
                  <p className="text-[11px] uppercase tracking-[0.12em] text-muted-foreground">In-Progress Requests</p>
                  <p className="mt-1 text-lg font-semibold">{latestReliability.in_progress_requests ?? 0}</p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <Card className={`${adminPanelClass} overflow-hidden border-white/8 bg-transparent`}>
          <CardHeader className="border-b border-white/8">
            <CardTitle className={adminSectionTitleClass}>Ingested Updates</CardTitle>
            <CardDescription className={adminSectionCopyClass}>
              Latest regulatory baselines currently available to drift detection.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Market</TableHead>
                  <TableHead>Regulator</TableHead>
                  <TableHead>Effective</TableHead>
                  <TableHead>Clauses</TableHead>
                  <TableHead>Uploaded</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {updates.slice(0, 8).map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge variant={item.market === selectedMarket ? "default" : "secondary"}>
                          {item.market}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div>
                        <p className="font-medium">{item.regulatory_body}</p>
                        <p className="text-xs text-muted-foreground">{item.source}</p>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{item.effective_date}</TableCell>
                    <TableCell>{item.clause_count}</TableCell>
                    <TableCell>
                      <div className="text-sm">
                        <p>{formatDateTime(item.uploaded_at)}</p>
                        <p className="text-xs text-muted-foreground">{item.uploaded_by}</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {!loading && updates.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">
                      No compliance updates have been ingested yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className={`${adminPanelClass} overflow-hidden border-white/8 bg-transparent`}>
          <CardHeader className="border-b border-white/8">
            <CardTitle className={adminSectionTitleClass}>Verification History</CardTitle>
            <CardDescription className={adminSectionCopyClass}>
              Drift and reliability workflow runs captured for audit and operational review.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {verifications.slice(0, 6).map((item) => {
              const driftResults = item.details?.drift_results ?? [];
              const flagged = driftResults.filter((result) => result.drift_detected).length;
              return (
                <div key={item.id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <VerificationStatusBadge status={item.result_status} />
                        <Badge variant="outline">{item.market}</Badge>
                      </div>
                      <p className="mt-2 text-sm font-semibold">{item.verification_type}</p>
                      <p className="text-xs text-muted-foreground">
                        {formatDateTime(item.verified_at)} by {item.verified_by ?? "system"}
                      </p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <p>{driftResults.length} markets checked</p>
                      <p>{flagged} drift flags</p>
                    </div>
                  </div>

                  {item.details?.reliability && (
                    <div className="mt-3 grid gap-2 sm:grid-cols-3">
                      <div className="rounded-md bg-muted/30 px-3 py-2">
                        <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">Open DLQ</p>
                        <p className="mt-1 font-semibold">{item.details.reliability.open_dead_letters ?? 0}</p>
                      </div>
                      <div className="rounded-md bg-muted/30 px-3 py-2">
                        <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">Conflicts</p>
                        <p className="mt-1 font-semibold">{item.details.reliability.idempotency_conflicts ?? 0}</p>
                      </div>
                      <div className="rounded-md bg-muted/30 px-3 py-2">
                        <p className="text-[11px] uppercase tracking-[0.1em] text-muted-foreground">Protected Fields</p>
                        <p className="mt-1 font-semibold">{item.details.reliability.audit_fields_protected ?? 0}</p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {!loading && verifications.length === 0 && (
              <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                No compliance verification runs recorded yet.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
