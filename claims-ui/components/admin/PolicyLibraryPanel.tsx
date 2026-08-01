"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Library, Upload, Trash2, ChevronDown, ChevronRight,
  FileText, Building2, Globe, AlertCircle, CheckCircle2,
  Loader2, Calendar, Hash, Layers, Download,
} from "lucide-react";
import { fetchCurrentUser } from "@/lib/auth";
import { PageHeader } from "@/components/shared/PageHeader";
import {
  policyLibraryList,
  policyLibraryUpload,
  policyLibraryGet,
  policyLibraryDelete,
  policyLibraryExtractMetadata,
  policyLibraryDownloadDocument,
  ApiError,
} from "@/lib/api";
import type {
  PolicyLibraryEntry,
  PolicyLibraryDocument,
  PolicyLibraryUploadResponse,
  PolicyMetadataResponse,
  MetadataField,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { UploadZone } from "@/components/shared/UploadZone";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// ── Constants ────────────────────────────────────────────────────────────────

const MARKETS = ["UAE", "KSA", "BAHRAIN", "OMAN", "QATAR", "KUWAIT", "INDIA"];
const POLICY_TYPES = ["NATIONAL", "COMPANY"];

const TYPE_CONFIG = {
  NATIONAL: {
    label:       "National / Regulatory",
    description: "Government or regulatory body mandates (IRDAI, DHA, DOH, MOH)",
    color:       "dark:bg-blue-500/10 bg-blue-50 dark:text-blue-400 text-blue-700 dark:border-blue-500/20 border-blue-200",
    icon:        Globe,
  },
  COMPANY: {
    label:       "Company Policy",
    description: "Insurance company-specific terms and benefit schedules",
    color:       "dark:bg-violet-500/10 bg-violet-50 dark:text-violet-400 text-violet-700 dark:border-violet-500/20 border-violet-200",
    icon:        Building2,
  },
};

// ── Types ────────────────────────────────────────────────────────────────────

type UploadPhase = "idle" | "uploading" | "done" | "error";

interface UploadForm {
  market:         string;
  policy_type:    string;
  insurer_name:   string;
  policy_name:    string;
  effective_date: string;
  version:        string;
}

// ── Main page ────────────────────────────────────────────────────────────────

export default function PolicyLibraryPage() {
  const router = useRouter();
  const [checking, setChecking]     = useState(true);
  const [entries, setEntries]        = useState<PolicyLibraryEntry[]>([]);
  const [loading, setLoading]        = useState(false);
  const [filterMarket, setFilterMarket]     = useState<string>("all");
  const [filterType,   setFilterType]       = useState<string>("all");
  const [filterSearch, setFilterSearch]     = useState<string>("");
  const [expanded,  setExpanded]     = useState<string | null>(null);
  const [detail,    setDetail]       = useState<PolicyLibraryDocument | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [uploadOpen, setUploadOpen]  = useState(false);
  const [deletingId, setDeletingId]  = useState<string | null>(null);

  // ADMIN guard
  useEffect(() => {
    fetchCurrentUser().then((user) => {
      if (!user || user.role !== "ADMIN") {
        router.replace("/");
      } else {
        setChecking(false);
      }
    });
  }, [router]);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    try {
      const data = await policyLibraryList({
        market:      filterMarket !== "all" ? filterMarket : undefined,
        policy_type: filterType   !== "all" ? filterType   : undefined,
      });
      setEntries(data);
    } catch (err) {
      toast.error("Failed to load policy library", {
        description: err instanceof ApiError ? err.detail : String(err),
      });
    } finally {
      setLoading(false);
    }
  }, [filterMarket, filterType]);

  useEffect(() => {
    if (!checking) loadEntries();
  }, [checking, loadEntries]);

  async function handleExpand(entry: PolicyLibraryEntry) {
    if (expanded === entry.id) {
      setExpanded(null);
      setDetail(null);
      return;
    }
    setExpanded(entry.id);
    setDetailLoading(true);
    try {
      const doc = await policyLibraryGet(entry.id);
      setDetail(doc);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleDelete(entry: PolicyLibraryEntry) {
    if (!confirm(`Delete "${entry.policy_name}"? This cannot be undone.`)) return;
    setDeletingId(entry.id);
    try {
      await policyLibraryDelete(entry.id);
      toast.success("Policy deleted");
      setEntries((prev) => prev.filter((e) => e.id !== entry.id));
      if (expanded === entry.id) { setExpanded(null); setDetail(null); }
    } catch (err) {
      toast.error("Delete failed", {
        description: err instanceof ApiError ? err.detail : String(err),
      });
    } finally {
      setDeletingId(null);
    }
  }

  async function handleDownloadPDF(policyId: string, policyName: string) {
    try {
      const blob = await policyLibraryDownloadDocument(policyId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `policy_${policyId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Document downloaded", { description: policyName });
    } catch (err) {
      toast.error("Download failed", {
        description: err instanceof ApiError ? err.detail : String(err),
      });
    }
  }

  // Filtered + searched display list
  const displayed = entries.filter((e) => {
    if (!filterSearch.trim()) return true;
    const q = filterSearch.toLowerCase();
    return (
      e.policy_name.toLowerCase().includes(q) ||
      e.insurer_name.toLowerCase().includes(q) ||
      e.market.toLowerCase().includes(q)
    );
  });

  if (checking) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <PageHeader
        title="Policy Library"
        actions={
          <Button onClick={() => setUploadOpen(true)} className="gap-2 bg-cyan-600 hover:bg-cyan-500 text-white">
            <Upload className="h-4 w-4" />
            Upload Policy
          </Button>
        }
      />

      {/* Info cards */}
      <div className="grid grid-cols-2 gap-3">
        {Object.entries(TYPE_CONFIG).map(([type, cfg]) => {
          const Icon = cfg.icon;
          const count = entries.filter((e) => e.policy_type === type).length;
          return (
            <div
              key={type}
              className={cn("rounded-lg border p-4 text-sm", cfg.color)}
            >
              <div className="flex items-center gap-2 font-medium">
                <Icon className="h-4 w-4" />
                {cfg.label}
                <Badge variant="outline" className="ml-auto text-[10px]">
                  {count} {count === 1 ? "doc" : "docs"}
                </Badge>
              </div>
              <p className="mt-1 text-xs opacity-75">{cfg.description}</p>
            </div>
          );
        })}
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <Input
          placeholder="Search by name, insurer, market…"
          value={filterSearch}
          onChange={(e) => setFilterSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={filterMarket} onValueChange={setFilterMarket}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Market" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Markets</SelectItem>
            {MARKETS.map((m) => (
              <SelectItem key={m} value={m}>{m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterType} onValueChange={setFilterType}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="NATIONAL">National</SelectItem>
            <SelectItem value="COMPANY">Company</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <div className="glass-card rounded-xl">
        {loading ? (
          <div className="flex h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading…
          </div>
        ) : displayed.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 text-muted-foreground">
            <Library className="h-8 w-8 opacity-30" />
            <p className="text-sm">
              {entries.length === 0
                ? "No policies uploaded yet. Click \"Upload Policy\" to get started."
                : "No results match your filters."}
            </p>
          </div>
        ) : (
          <div className="divide-y">
            {displayed.map((entry) => {
              const cfg = TYPE_CONFIG[entry.policy_type as keyof typeof TYPE_CONFIG];
              const TypeIcon = cfg?.icon ?? FileText;
              const isExpanded = expanded === entry.id;

              return (
                <div key={entry.id}>
                  {/* Row */}
                  <div className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors">
                    {/* Expand toggle */}
                    <button
                      onClick={() => handleExpand(entry)}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {isExpanded
                        ? <ChevronDown className="h-4 w-4" />
                        : <ChevronRight className="h-4 w-4" />}
                    </button>

                    {/* Type icon */}
                    <TypeIcon className="h-4 w-4 shrink-0 text-muted-foreground" />

                    {/* Main info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">
                          {entry.policy_name}
                        </span>
                        <Badge
                          variant="outline"
                          className={cn("text-[10px] shrink-0", cfg?.color)}
                        >
                          {entry.policy_type}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {entry.insurer_name} · {entry.market} · v{entry.version}
                      </p>
                    </div>

                    {/* Clause count */}
                    <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                      <Layers className="h-3.5 w-3.5" />
                      {entry.clauses_count} clauses
                    </div>

                    {/* Effective date */}
                    <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0 hidden sm:flex">
                      <Calendar className="h-3.5 w-3.5" />
                      {entry.effective_date}
                    </div>

                    {/* Delete */}
                    <button
                      onClick={() => handleDelete(entry)}
                      disabled={deletingId === entry.id}
                      className="text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
                      title="Delete policy"
                    >
                      {deletingId === entry.id
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <Trash2 className="h-4 w-4" />}
                    </button>
                  </div>

                  {/* Expanded clauses panel */}
                  {isExpanded && (
                    <div className="border-t bg-muted/20 px-4 py-3">
                      {detailLoading ? (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Loading clauses…
                        </div>
                      ) : detail ? (
                        <div className="space-y-4">
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                            <Hash className="h-3.5 w-3.5" />
                            <span>Source: {detail.source_filename || "—"}</span>
                            <span>·</span>
                            <span>Uploaded by {detail.uploaded_by}</span>
                            <span>·</span>
                            <span>{new Date(detail.uploaded_at).toLocaleDateString()}</span>
                          </div>

                          {/* Documents Section */}
                          <div className="glass-card rounded-lg p-3 space-y-2">
                            <div className="flex items-center gap-2 text-sm font-medium">
                              <FileText className="h-4 w-4 text-muted-foreground" />
                              Documents
                            </div>
                            {detail.document_path ? (
                              <div className="rounded-md border bg-background p-3 space-y-2">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex-1 min-w-0 space-y-1">
                                    <p className="text-xs font-medium truncate">
                                      {detail.source_filename || detail.document_path.split("/").pop() || "policy.pdf"}
                                    </p>
                                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                                      {detail.file_size_bytes && (
                                        <span>
                                          {(detail.file_size_bytes / 1024 / 1024).toFixed(2)} MB
                                        </span>
                                      )}
                                      <span>
                                        {new Date(detail.uploaded_at).toLocaleDateString()}
                                      </span>
                                      {detail.document_hash && (
                                        <span className="font-mono" title={detail.document_hash}>
                                          {detail.document_hash.substring(0, 16)}...
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => handleDownloadPDF(detail.id, detail.policy_name)}
                                    className="gap-1.5 shrink-0"
                                  >
                                    <Download className="h-3.5 w-3.5" />
                                    Download
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <div className="rounded-md border border-dashed bg-muted/30 p-3 text-center">
                                <p className="text-xs text-muted-foreground">
                                  No source document available (extracted from API or uploaded pre-PDF storage)
                                </p>
                              </div>
                            )}
                          </div>

                          {/* Clauses Section */}
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 text-sm font-medium">
                              <Layers className="h-4 w-4 text-muted-foreground" />
                              Extracted Clauses
                            </div>
                            {detail.clauses.length === 0 ? (
                              <p className="text-xs text-muted-foreground italic">
                                No clauses extracted — re-upload after configuring the Intelligence AI Agent.
                              </p>
                            ) : (
                              <div className="scrollbar-styled space-y-2 max-h-80 overflow-y-auto pr-1">
                                {detail.clauses.map((clause, idx) => (
                                  <div
                                    key={clause.section_reference || clause.title || idx}
                                    className="rounded-md border bg-background p-3 text-xs"
                                  >
                                    <div className="flex items-start justify-between gap-2 mb-1">
                                      <span className="font-medium text-foreground">
                                        {clause.title || clause.section_reference}
                                      </span>
                                      <Badge
                                        variant="outline"
                                        className="text-[9px] shrink-0"
                                      >
                                        {clause.clause_type}
                                      </Badge>
                                    </div>
                                    <p className="text-muted-foreground line-clamp-2">
                                      {clause.full_text}
                                    </p>
                                    {clause.section_reference && (
                                      <p className="mt-1 text-[10px] text-muted-foreground/70">
                                        § {clause.section_reference}
                                      </p>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          Could not load clauses.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Upload Dialog */}
      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        onSuccess={() => {
          setUploadOpen(false);
          loadEntries();
        }}
      />
    </div>
  );
}

// ── Confidence badge helper ───────────────────────────────────────────────────

function ConfBadge({ field }: { field: MetadataField | undefined }) {
  if (!field || field.source === "missing") return null;
  const pct = Math.round((field.confidence ?? 0) * 100);
  const color =
    pct >= 85 ? "text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800"
    : pct >= 60 ? "text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800"
    : "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800";
  const label = field.source === "inferred" ? `~${pct}%` : `${pct}%`;
  return (
    <span className={cn("ml-1.5 rounded border px-1 py-0.5 text-[9px] font-medium", color)}>
      {label}
    </span>
  );
}

// ── Upload Dialog ────────────────────────────────────────────────────────────

function UploadDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open:         boolean;
  onOpenChange: (v: boolean) => void;
  onSuccess:    () => void;
}) {
  const [file,        setFile]        = useState<File | null>(null);
  const [phase,       setPhase]       = useState<UploadPhase>("idle");
  const [progress,    setProgress]    = useState(0);
  const [result,      setResult]      = useState<PolicyLibraryUploadResponse | null>(null);
  const [errMsg,      setErrMsg]      = useState<string | null>(null);
  const [extracting,  setExtracting]  = useState(false);
  const [metadata,    setMetadata]    = useState<PolicyMetadataResponse | null>(null);
  const [extractErr,  setExtractErr]  = useState<string | null>(null);

  const [form, setForm] = useState<UploadForm>({
    market:         "",
    policy_type:    "COMPANY",
    insurer_name:   "",
    policy_name:    "",
    effective_date: "",
    version:        "1.0",
  });

  function reset() {
    setFile(null);
    setPhase("idle");
    setProgress(0);
    setResult(null);
    setErrMsg(null);
    setExtracting(false);
    setMetadata(null);
    setExtractErr(null);
    setForm({ market: "", policy_type: "COMPANY", insurer_name: "", policy_name: "", effective_date: "", version: "1.0" });
  }

  function handleClose(v: boolean) {
    if (!v) reset();
    onOpenChange(v);
  }

  // Auto-extract metadata whenever a file is selected
  async function handleFileSelected(f: File | null) {
    setFile(f);
    setMetadata(null);
    setExtractErr(null);
    if (!f) return;

    setExtracting(true);
    try {
      const meta = await policyLibraryExtractMetadata(f);
      setMetadata(meta);
      // Pre-fill form with extracted values
      setForm((prev) => ({
        market:         meta.market.value        ?? prev.market,
        policy_type:    meta.policy_type.value   ?? prev.policy_type,
        insurer_name:   meta.insurer_name.value  ?? prev.insurer_name,
        policy_name:    meta.policy_name.value   ?? prev.policy_name,
        effective_date: meta.effective_date.value ?? prev.effective_date,
        version:        meta.version.value       ?? prev.version,
      }));
    } catch (err) {
      setExtractErr(err instanceof ApiError ? err.detail : "Metadata extraction failed — fill fields manually.");
    } finally {
      setExtracting(false);
    }
  }

  const missingRequired = [
    !form.market         && "Market",
    !form.insurer_name.trim() && (form.policy_type === "NATIONAL" ? "Regulatory Body" : "Insurance Company"),
    !form.policy_name.trim()  && "Policy Name",
    !form.effective_date && "Effective Date",
  ].filter(Boolean) as string[];

  const canSubmit = file && missingRequired.length === 0 && !extracting;

  async function handleUpload() {
    if (!canSubmit) return;
    setPhase("uploading");
    setProgress(10);
    const ticker = setInterval(() => {
      setProgress((p) => Math.min(p + 7, 85));
    }, 600);

    try {
      const res = await policyLibraryUpload(file!, {
        market:         form.market,
        policy_type:    form.policy_type,
        insurer_name:   form.insurer_name.trim(),
        policy_name:    form.policy_name.trim(),
        effective_date: form.effective_date,
        version:        form.version.trim() || "1.0",
      });
      clearInterval(ticker);
      setProgress(100);
      setResult(res);
      setPhase("done");
      toast.success(`${res.clauses_extracted} clauses extracted`, { description: res.policy_name });
      onSuccess();
    } catch (err) {
      clearInterval(ticker);
      setErrMsg(err instanceof ApiError ? err.detail : "Upload failed. Try again.");
      setPhase("error");
    }
  }

  const phaseLabel =
    progress < 35 ? "Uploading PDF…"
    : progress < 65 ? "OCR extraction…"
    : "Intelligence AI Agent clause extraction…";

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Upload Policy Document
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {phase === "idle" && (
            <>
              {/* File drop zone */}
              <UploadZone
                onFile={handleFileSelected}
                file={file}
                onClear={() => handleFileSelected(null)}
                maxSizeMB={50}
                label="Drop policy PDF here — fields auto-fill from document"
              />

              {/* Auto-extract loading */}
              {extracting && (
                <div className="flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 dark:bg-blue-950/20 dark:border-blue-800 px-3 py-2 text-sm text-blue-700 dark:text-blue-400">
                  <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                  Analysing PDF — extracting metadata…
                </div>
              )}

              {/* Document warning — not an insurance document */}
              {metadata && !extracting && !metadata.is_insurance_document && (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    This document does not appear to be an insurance policy
                    (confidence {Math.round(metadata.document_confidence * 100)}%).
                    Please upload a valid insurance policy PDF.
                  </AlertDescription>
                </Alert>
              )}

              {/* Intelligence agent extract error */}
              {extractErr && !extracting && (
                <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                  ⚠ {extractErr}
                </div>
              )}

              {/* Show fields only after file is selected */}
              {file && !extracting && (
                <>
                  {/* Extracted metadata summary */}
                  {metadata && metadata.is_insurance_document && !extractErr && (
                    <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">Auto-filled from PDF</span>
                      {" · "}
                      {metadata.missing_fields.length === 0
                        ? "All fields detected"
                        : `${metadata.missing_fields.length} field${metadata.missing_fields.length > 1 ? "s" : ""} need manual input`}
                      {metadata.warnings.length > 0 && (
                        <span className="ml-1 text-amber-600"> · {metadata.warnings[0]}</span>
                      )}
                    </div>
                  )}

                  {/* Market + Type */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="flex items-center text-xs font-medium text-muted-foreground">
                        Market *
                        <ConfBadge field={metadata?.market} />
                        {!form.market && <span className="ml-1 text-destructive">required</span>}
                      </label>
                      <Select value={form.market} onValueChange={(v) => setForm((f) => ({ ...f, market: v }))}>
                        <SelectTrigger className={!form.market ? "border-amber-500/60" : ""}>
                          <SelectValue placeholder="Select market" />
                        </SelectTrigger>
                        <SelectContent>
                          {MARKETS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="flex items-center text-xs font-medium text-muted-foreground">
                        Policy Type *
                        <ConfBadge field={metadata?.policy_type} />
                      </label>
                      <Select value={form.policy_type} onValueChange={(v) => setForm((f) => ({ ...f, policy_type: v }))}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {POLICY_TYPES.map((t) => (
                            <SelectItem key={t} value={t}>
                              {t === "NATIONAL" ? "National / Regulatory" : "Company Policy"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {/* Insurer */}
                  <div className="space-y-1.5">
                    <label className="flex items-center text-xs font-medium text-muted-foreground">
                      {form.policy_type === "NATIONAL" ? "Regulatory Body *" : "Insurance Company *"}
                      <ConfBadge field={metadata?.insurer_name} />
                      {!form.insurer_name.trim() && <span className="ml-1 text-destructive">required</span>}
                    </label>
                    <Input
                      placeholder={form.policy_type === "NATIONAL" ? "e.g. IRDAI, DHA, DOH, MOH" : "e.g. Daman, ICICI Lombard, NGI"}
                      value={form.insurer_name}
                      onChange={(e) => setForm((f) => ({ ...f, insurer_name: e.target.value }))}
                      className={!form.insurer_name.trim() ? "border-amber-500/60" : ""}
                    />
                  </div>

                  {/* Policy Name */}
                  <div className="space-y-1.5">
                    <label className="flex items-center text-xs font-medium text-muted-foreground">
                      Policy Name *
                      <ConfBadge field={metadata?.policy_name} />
                      {!form.policy_name.trim() && <span className="ml-1 text-destructive">required</span>}
                    </label>
                    <Input
                      placeholder="e.g. Health Insurance Regulations 2024"
                      value={form.policy_name}
                      onChange={(e) => setForm((f) => ({ ...f, policy_name: e.target.value }))}
                      className={!form.policy_name.trim() ? "border-amber-500/60" : ""}
                    />
                  </div>

                  {/* Effective Date + Version */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="flex items-center text-xs font-medium text-muted-foreground">
                        Effective Date *
                        <ConfBadge field={metadata?.effective_date} />
                        {!form.effective_date && <span className="ml-1 text-destructive">required</span>}
                      </label>
                      <Input
                        type="date"
                        value={form.effective_date}
                        onChange={(e) => setForm((f) => ({ ...f, effective_date: e.target.value }))}
                        className={!form.effective_date ? "border-amber-500/60" : ""}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="flex items-center text-xs font-medium text-muted-foreground">
                        Version
                        <ConfBadge field={metadata?.version} />
                      </label>
                      <Input
                        placeholder="1.0"
                        value={form.version}
                        onChange={(e) => setForm((f) => ({ ...f, version: e.target.value }))}
                      />
                    </div>
                  </div>

                  {/* Missing fields warning */}
                  {missingRequired.length > 0 && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                      The PDF did not contain: <strong>{missingRequired.join(", ")}</strong>.
                      Please fill these fields manually to proceed.
                    </div>
                  )}
                </>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" onClick={() => handleClose(false)}>Cancel</Button>
                <Button disabled={!canSubmit} onClick={handleUpload}>
                  Upload &amp; Extract
                </Button>
              </div>
            </>
          )}

          {phase === "uploading" && (
            <div className="space-y-3 py-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {phaseLabel}
              </div>
              <Progress value={progress} className="h-2" />
              <p className="text-right text-xs text-muted-foreground">{progress}%</p>
            </div>
          )}

          {phase === "done" && result && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-green-700 dark:text-green-400">
                <CheckCircle2 className="h-5 w-5" />
                <span className="font-semibold text-sm">{result.clauses_extracted} clauses extracted</span>
              </div>
              <div className="rounded-md bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800 p-3 text-xs space-y-1">
                <p>Policy: {result.policy_name}</p>
                <p>Market: {result.market} · Type: {result.policy_type}</p>
                <p>Pages: {result.page_count} · Document reader: {result.ocr_engine_used}</p>
                <p>Assistant: {result.llm_model_used || (result.llm_available ? "active" : "not configured")}</p>
                <p>Time: {result.processing_time_ms.toLocaleString()} ms</p>
                {result.warnings.length > 0 && (
                  <p className="text-amber-700 dark:text-amber-400">⚠ {result.warnings.join(" · ")}</p>
                )}
              </div>
              <Button className="w-full" onClick={() => handleClose(false)}>Done</Button>
            </div>
          )}

          {phase === "error" && (
            <div className="space-y-3">
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{errMsg}</AlertDescription>
              </Alert>
              <div className="flex gap-2">
                <Button variant="outline" onClick={reset} className="flex-1">Try Again</Button>
                <Button variant="ghost" onClick={() => handleClose(false)} className="flex-1">Close</Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
