"use client";
import { useState, useRef, useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Loader2,
  CheckCircle2,
  Clock,
  XCircle,
  Zap,
  Cpu,
  FileText,
  MousePointer2,
  PlusCircle,
  LayoutGrid,
  Globe,
  Upload,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { uploadClaimPDF, ApiError, DuplicateClaimError } from "@/lib/api";
import { ClaimProcessingOverlay } from "./ClaimProcessingOverlay";
import { MARKET_LABELS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { OCRUploadResult, DuplicateClaimInfo } from "@/lib/types";

const MARKETS = ["INDIA"];
const AI_INTAKE_MAX_BYTES = 20 * 1024 * 1024;
const MULTI_DOC_MAX_BYTES = 50 * 1024 * 1024;
const MULTI_DOC_MAX_FILES = 15;

const MARKET_FLAGS: Record<string, string> = {
  INDIA: "🇮🇳",
};

/** Map claim status to a colour + icon for the duplicate dialog */
function StatusBadge({ status }: { status: string }) {
  const s = status?.toUpperCase();
  const cfg: Record<string, { cls: string; icon: React.ReactNode; label: string }> = {
    SETTLED:      { cls: "text-[var(--status-success)] bg-[var(--status-success)]/10 border-[var(--status-success)]/25", icon: <CheckCircle2 className="h-3.5 w-3.5" />, label: "Settled" },
    HITL_PENDING: { cls: "text-[var(--status-warning)] bg-[var(--status-warning)]/10 border-[var(--status-warning)]/25", icon: <Clock className="h-3.5 w-3.5" />, label: "Manual Review" },
    ERROR:        { cls: "text-[var(--status-danger)] bg-[var(--status-danger)]/10 border-[var(--status-danger)]/25", icon: <XCircle className="h-3.5 w-3.5" />, label: "Error / Rejected" },
    REJECTED:     { cls: "text-[var(--status-danger)] bg-[var(--status-danger)]/10 border-[var(--status-danger)]/25", icon: <XCircle className="h-3.5 w-3.5" />, label: "Rejected" },
  };
  const { cls, icon, label } = cfg[s] ?? { cls: "text-brand-primary bg-brand-primary/10 border-brand-primary/25", icon: null, label: status };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${cls}`}>
      {icon}{label}
    </span>
  );
}

interface Step1Props {
  mode: "pdf" | "manual" | "advance";
  onModeChange: (mode: "pdf" | "manual" | "advance") => void;
  onComplete: (market: string, result: OCRUploadResult) => void;
  onAdvanceRegistration: () => void;
}

type SubmissionModule = "online" | "upload" | "reimbursement" | "advance";
type BatchStatus = "queued" | "uploading" | "uploaded" | "error";
type BatchFileProgress = {
  name: string;
  size: number;
  status: BatchStatus;
  progress: number;
  message: string;
};
type BatchDecision = {
  total: number;
  success: number;
  failed: number;
  result: OCRUploadResult | null;
};

export function Step1ClaimSubmit({ mode, onModeChange, onComplete, onAdvanceRegistration }: Step1Props) {
  const [selectedMarket, setSelectedMarket] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [batchFiles, setBatchFiles] = useState<File[]>([]);
  const [batchProgress, setBatchProgress] = useState<BatchFileProgress[]>([]);
  const [batchDecision, setBatchDecision] = useState<BatchDecision | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedModule, setSelectedModule] = useState<SubmissionModule>(
    mode === "manual" ? "online" : mode === "advance" ? "advance" : "upload"
  );

  // ── Duplicate detection state ──────────────────────────────────────────────
  const [dupInfo, setDupInfo] = useState<DuplicateClaimInfo | null>(null);
  const [dupMessage, setDupMessage] = useState<string>("");
  const [dupProceeding, setDupProceeding] = useState(false);

  // ── Processing animation state ─────────────────────────────────────────────
  type StepId = "ocr" | "eligibility" | "ai" | "settlement";
  const [showOverlay, setShowOverlay] = useState(false);
  const [animStep, setAnimStep] = useState<StepId>("ocr");
  const [animProgress, setAnimProgress] = useState(0);
  const apiDone = useRef(false);

  async function handleSubmit(confirmDuplicate = false) {
    if (!selectedMarket) return;

    const isMultiDocument = selectedModule === "reimbursement";
    const filesToProcess = isMultiDocument ? batchFiles : file ? [file] : [];
    if (filesToProcess.length === 0) return;

    if (!isMultiDocument && filesToProcess[0].size > AI_INTAKE_MAX_BYTES) {
      toast.error("File is too large. Maximum allowed size is 20 MB.");
      return;
    }

    if (isMultiDocument) {
      const totalBytes = filesToProcess.reduce((sum, item) => sum + item.size, 0);
      if (filesToProcess.length > MULTI_DOC_MAX_FILES) {
        toast.error(`Too many files. Maximum allowed count is ${MULTI_DOC_MAX_FILES}.`);
        return;
      }
      if (totalBytes > MULTI_DOC_MAX_BYTES) {
        toast.error("Batch is too large. Maximum allowed size is 50 MB.");
        return;
      }
    }

    setLoading(true);
    if (!confirmDuplicate) {
      setDupInfo(null);
      setDupMessage("");
    }
    setBatchDecision(null);
    if (isMultiDocument) {
      setBatchProgress(filesToProcess.map((item) => ({
        name: item.name,
        size: item.size,
        status: "queued",
        progress: 0,
        message: "Waiting",
      })));
    }

    // Initialize the processing overlay
    setShowOverlay(!isMultiDocument);
    setAnimStep("ocr");
    setAnimProgress(5);
    apiDone.current = false;

    // Helper to map backend steps to frontend animation stages
    const stepMapping: Record<string, StepId> = {
      "INIT": "ocr",
      "UPLOAD": "ocr",
      "VALIDATION": "ocr",
      "OCR": "ocr",
      "document_ingestion": "ocr",
      "intake_enrichment": "ocr",
      "rules_engine": "eligibility",
      "ai_reasoning": "ai",
      "settlement": "settlement",
      "validation": "settlement",
      "hitl_routing": "settlement",
      "COMPLETED": "settlement"
    };

    try {
      let finalResult: OCRUploadResult | null = null;
      let successCount = 0;
      let failedCount = 0;
      for (const [index, currentFile] of filesToProcess.entries()) {
        if (isMultiDocument) {
          setBatchProgress((current) => current.map((item, itemIndex) => (
            itemIndex === index
              ? { ...item, status: "uploading", progress: 5, message: "Uploading" }
              : item
          )));
        }
        try {
          const result = await uploadClaimPDF(
            currentFile,
            {
              market_region: selectedMarket,
              confirm_duplicate: confirmDuplicate || undefined,
            },
            (progress) => {
              // Update the UI in real-time as we get events from the stream
              if (progress.step && stepMapping[progress.step]) {
                setAnimStep(stepMapping[progress.step]);
              }
              if (progress.progress > 0) {
                const perFileProgress = isMultiDocument
                  ? ((index / filesToProcess.length) * 100) + (progress.progress / filesToProcess.length)
                  : progress.progress;
                setAnimProgress(Math.min(98, perFileProgress));
                if (isMultiDocument) {
                  setBatchProgress((current) => current.map((item, itemIndex) => (
                    itemIndex === index
                      ? {
                          ...item,
                          status: "uploading",
                          progress: Math.min(98, progress.progress),
                          message: progress.message || progress.step || "Processing",
                        }
                      : item
                  )));
                }
              }
              if (progress.step === "DUPLICATE_DETECTED") {
                 // Handle duplicate detected during stream
                 // This will be caught by the catch block below if we throw or return
              }
            }
          );
          finalResult = result;
          successCount += 1;
          if (isMultiDocument) {
            setBatchProgress((current) => current.map((item, itemIndex) => (
              itemIndex === index
                ? { ...item, status: "uploaded", progress: 100, message: "Uploaded" }
                : item
            )));
          }
        } catch (fileErr) {
          failedCount += 1;
          if (fileErr instanceof DuplicateClaimError && !isMultiDocument) {
            throw fileErr;
          }
          const message = fileErr instanceof ApiError
            ? fileErr.detail
            : fileErr instanceof Error
              ? fileErr.message
              : "Upload failed";
          if (isMultiDocument) {
            setBatchProgress((current) => current.map((item, itemIndex) => (
              itemIndex === index
                ? { ...item, status: "error", progress: 100, message }
                : item
            )));
            continue;
          }
          throw fileErr;
        }
      }

      // API done — finalize
      apiDone.current = true;
      setAnimProgress(100);
      if (isMultiDocument) {
        setShowOverlay(false);
        setLoading(false);
        setBatchDecision({
          total: filesToProcess.length,
          success: successCount,
          failed: failedCount,
          result: finalResult,
        });
        return;
      }
      
      setTimeout(() => {
        setShowOverlay(false);
        setLoading(false);
        onComplete(selectedMarket, finalResult as OCRUploadResult);
      }, 600);

    } catch (err) {
      setShowOverlay(false);
      setAnimStep("ocr");
      setAnimProgress(0);
      
      if (err instanceof DuplicateClaimError) {
        setDupInfo(err.originalClaim);
        setDupMessage(err.message);
        setDupProceeding(false);
      } else if (err instanceof ApiError && err.detail === "DOCUMENT_NOT_CLAIM") {
        toast.error("Invalid document", {
          description: "This doesn't appear to be a medical claim document."
        });
      } else {
        toast.error(err instanceof ApiError ? err.detail : "Upload failed. Please try again.");
      }
    } finally {
      if (!apiDone.current) setLoading(false);
      setDupProceeding(false);
    }
  }

  async function handleDuplicateProceed() {
    setDupProceeding(true);
    await handleSubmit(true);
  }

  function handleDuplicateCancel() {
    setDupInfo(null);
    setDupMessage("");
    setFile(null);
    setBatchFiles([]);
  }

  function continueBatchUpload() {
    if (!batchDecision?.result) return;
    toast.success(`${batchDecision.success} out of ${batchDecision.total} files got uploaded.`);
    setBatchDecision(null);
    setBatchProgress([]);
    setBatchFiles([]);
    onComplete(selectedMarket, batchDecision.result);
  }

  function cancelBatchUpload() {
    setBatchDecision(null);
    setBatchProgress([]);
    setBatchFiles([]);
    setLoading(false);
    toast.info("Multiple document processing cancelled.");
  }

  const canSubmit = mode === "pdf"
    ? !!selectedMarket && (selectedModule === "reimbursement" ? batchFiles.length > 0 : !!file) && !loading && !dupInfo
    : mode === "manual"
      ? !!selectedMarket && !loading
      : !loading;

  useEffect(() => {
    if (mode === "manual") {
      setSelectedModule("online");
      return;
    }
    if (mode === "advance") {
      setSelectedModule("advance");
      return;
    }
    setSelectedModule((current) => (current === "reimbursement" ? "reimbursement" : "upload"));
  }, [mode]);

  const submissionModules: Array<{
    id: SubmissionModule;
    title: string;
    eyebrow: string;
    description: string;
    icon: React.ElementType;
    tech?: string;
  }> = [
    {
      id: "online",
      title: "Online Claim Registration",
      eyebrow: "Structured Entry",
      description: "Direct data entry for quick registration without document extraction.",
      icon: MousePointer2,
    },
    {
      id: "upload",
      title: "Document Intake",
      eyebrow: "Intelligence AI Agent",
      description: "Single PDF or image intake with assisted document extraction. One document at a time, max 20 MB.",
      icon: Cpu,
      tech: "Intelligence AI Agent",
    },
    {
      id: "reimbursement",
      title: "Multiple Document Processing",
      eyebrow: "Multi-Doc Processing",
      description: "Batch upload for internally reviewed claim packs. Up to 15 files, 50 MB total.",
      icon: FileText,
    },
    {
      id: "advance",
      title: "Pre Auth Claim",
      eyebrow: "Planned Treatment",
      description: "Pre auth registration for planned treatment review.",
      icon: PlusCircle,
    },
  ];

  function handleModuleSelect(module: SubmissionModule) {
    setSelectedModule(module);
    if (module === "online") {
      onModeChange("manual");
      return;
    }
    if (module === "advance") {
      onModeChange("advance");
      setSelectedMarket("INDIA");
      return;
    }
    setFile(null);
    setBatchFiles([]);
    setBatchProgress([]);
    setBatchDecision(null);
    setDupInfo(null);
    setDupMessage("");
    onModeChange("pdf");
  }

  return (
    <div className="space-y-10">
      {/* ── Section: Module Selection ── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <LayoutGrid className="w-4 h-4 text-text-muted" />
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-text-muted">Submission Module</h3>
          </div>
          <span className="text-[10px] font-medium text-text-muted uppercase tracking-widest">Select Workspace</span>
        </div>
        
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {submissionModules.map((module) => {
            const active = selectedModule === module.id;
            const Icon = module.icon;
            return (
              <button
                key={module.id}
                type="button"
                onClick={() => handleModuleSelect(module.id)}
                className={cn(
                  "group relative flex flex-col p-5 text-left transition-all duration-300 rounded-2xl border overflow-hidden h-full",
                  active
                    ? "border-brand-primary/40 bg-brand-primary/[0.06] shadow-[var(--shadow)] ring-1 ring-brand-primary/25"
                    : "border-[var(--border-subtle)] bg-[var(--acos-surface)] hover:border-[var(--border-strong)] hover:bg-[var(--acos-surface-strong)]"
                )}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className={cn(
                    "p-2 rounded-xl border transition-colors duration-300",
                    active ? "bg-brand-primary/15 border-brand-primary/35 text-brand-primary" : "bg-[var(--bg-card-muted)] border-[var(--border-subtle)] text-text-muted"
                  )}>
                    <Icon className="w-5 h-5" />
                  </div>
                  {module.tech && (
                    <span className="text-[8px] font-black text-text-muted uppercase tracking-tighter">
                      {module.tech}
                    </span>
                  )}
                </div>

                <p className={cn(
                  "text-[9px] font-black uppercase tracking-[0.18em] mb-1.5 transition-colors",
                  active ? "text-brand-primary" : "text-text-muted"
                )}>
                  {module.eyebrow}
                </p>
                <h3 className={cn(
                  "text-sm font-bold leading-tight mb-2 transition-colors",
                  active ? "text-text-primary" : "text-text-secondary"
                )}>
                  {module.title}
                </h3>
                <p className={cn(
                  "text-xs leading-relaxed transition-colors",
                  active ? "text-text-secondary" : "text-text-muted"
                )}>
                  {module.description}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 items-start">
        {/* ── Section: Market Selection ── */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-text-muted" />
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-text-muted">Market Region</h3>
          </div>
          
          <div className="grid grid-cols-2 gap-3">
            {MARKETS.map((m) => {
              const active = selectedMarket === m;
              const disabled = mode === "advance" && m !== "INDIA";
              return (
                <button
                  key={m}
                  disabled={disabled}
                  onClick={() => setSelectedMarket(m)}
                  className={cn(
                    "flex items-center gap-3 p-4 rounded-xl border text-sm font-bold transition-all duration-300",
                    active
                      ? "border-brand-primary/40 bg-brand-primary/10 text-text-primary shadow-[var(--shadow-sm)]"
                      : disabled
                      ? "opacity-40 cursor-not-allowed border-[var(--border-subtle)] bg-transparent text-text-muted"
                      : "border-[var(--border-subtle)] bg-[var(--acos-surface)] text-text-secondary hover:border-[var(--border-strong)] hover:bg-[var(--acos-surface-strong)]"
                  )}
                >
                  <span className="text-2xl grayscale-[0.2]">{MARKET_FLAGS[m]}</span>
                  <div className="flex flex-col items-start">
                    <span>{MARKET_LABELS[m] ?? m}</span>
                    <span className="text-[9px] font-medium opacity-50">Local Protocol</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Section: Action Area ── */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-text-muted" />
            <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-text-muted">Action Center</h3>
          </div>

          <div className="glass-card rounded-2xl border border-[var(--border-subtle)] bg-[var(--acos-surface)] p-6 space-y-6">
            {mode === "pdf" ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-text-secondary">
                    {selectedModule === "reimbursement" ? "Reviewed Claim Pack (PDF/IMG)" : "Claim Document (PDF/IMG)"}
                  </span>
                  {(file || batchFiles.length > 0) && (
                    <button onClick={() => { setFile(null); setBatchFiles([]); setDupInfo(null); }} className="text-[10px] font-bold text-[var(--status-danger)] uppercase tracking-widest hover:brightness-110 transition-colors">
                      Clear
                    </button>
                  )}
                </div>

                {selectedModule === "reimbursement" && (
                  <div className="rounded-xl border border-[var(--status-warning)]/20 bg-[var(--status-warning)]/[0.08] p-3 text-xs leading-5 text-[var(--status-warning)]">
                    Multiple Document Processing is for internal claim officers submitting already reviewed claim data and supporting documents as one controlled batch.
                  </div>
                )}

                {(!file && batchFiles.length === 0) ? (
                  <label className={cn(
                    "flex flex-col items-center justify-center h-32 w-full rounded-xl border-2 border-dashed transition-all duration-300 cursor-pointer group",
                    selectedMarket
                      ? "border-[var(--border-strong)] bg-[var(--acos-surface)] hover:border-brand-primary/50 hover:bg-brand-primary/5"
                      : "opacity-40 border-[var(--border-subtle)] bg-transparent cursor-not-allowed"
                  )}>
                    <Upload className={cn(
                      "w-6 h-6 mb-2 transition-transform duration-300 group-hover:-translate-y-1",
                      selectedMarket ? "text-brand-primary" : "text-text-muted"
                    )} />
                    <span className="text-xs font-bold text-text-secondary">Drop file or click to upload</span>
                    <span className="text-[10px] text-text-muted mt-1">
                      {selectedModule === "reimbursement"
                        ? `MAX ${MULTI_DOC_MAX_FILES} FILES / 50MB BATCH`
                        : "ONE FILE / MAX 20MB"}
                    </span>
                    <input
                      type="file"
                      accept=".pdf,image/*"
                      multiple={selectedModule === "reimbursement"}
                      className="hidden"
                      disabled={!selectedMarket}
                      onChange={(e) => {
                        const selected = Array.from(e.target.files ?? []);
                        if (selectedModule === "reimbursement") {
                          const totalBytes = selected.reduce((sum, item) => sum + item.size, 0);
                          if (selected.length > MULTI_DOC_MAX_FILES) {
                            toast.error(`Select ${MULTI_DOC_MAX_FILES} files or fewer.`);
                          } else if (totalBytes > MULTI_DOC_MAX_BYTES) {
                            toast.error("Selected batch exceeds 50 MB.");
                          } else {
                            setBatchFiles(selected);
                            setBatchProgress([]);
                            setBatchDecision(null);
                            setFile(null);
                            setDupInfo(null);
                          }
                        } else {
                          const f = selected[0];
                          if (f && f.size > AI_INTAKE_MAX_BYTES) {
                            toast.error("File is too large. Maximum allowed size is 20 MB.");
                          } else if (f) {
                            setFile(f);
                            setBatchFiles([]);
                            setBatchProgress([]);
                            setBatchDecision(null);
                            setDupInfo(null);
                          }
                        }
                        e.target.value = "";
                      }}
                    />
                  </label>
                ) : (
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-brand-primary/10 border border-brand-primary/25">
                    <div className="p-2 bg-brand-primary/15 rounded-lg">
                      <FileText className="w-5 h-5 text-brand-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      {selectedModule === "reimbursement" ? (
                        <>
                          <p className="text-xs font-bold text-text-primary truncate">
                            {batchFiles.length} document{batchFiles.length === 1 ? "" : "s"} selected
                          </p>
                          <p className="text-[10px] text-brand-primary/80 font-medium">
                            {(batchFiles.reduce((sum, item) => sum + item.size, 0) / (1024 * 1024)).toFixed(1)} MB batch ready for sequential processing
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="text-xs font-bold text-text-primary truncate">{file?.name}</p>
                          <p className="text-[10px] text-brand-primary/80 font-medium">Ready for Intelligence Extraction</p>
                        </>
                      )}
                    </div>
                    <CheckCircle2 className="w-5 h-5 text-brand-primary" />
                  </div>
                )}
              </div>
            ) : mode === "advance" ? (
              <div className="p-4 rounded-xl bg-[var(--acos-surface)] border border-[var(--border-subtle)] text-xs text-text-secondary leading-relaxed">
                <PlusCircle className="w-4 h-4 mb-2 text-text-muted" />
                Register a Pre Auth Claim. This initializes a multi-agent review workflow for medical necessity and limit estimation.
              </div>
            ) : (
              <div className="p-4 rounded-xl bg-[var(--acos-surface)] border border-[var(--border-subtle)] text-xs text-text-secondary leading-relaxed">
                <MousePointer2 className="w-4 h-4 mb-2 text-text-muted" />
                Proceed to structured data entry. Best for claims where data is already available in digital systems or needs manual oversight.
              </div>
            )}

            <Button
              disabled={!canSubmit}
              onClick={
                mode === "pdf"
                  ? () => handleSubmit(false)
                  : mode === "advance"
                    ? onAdvanceRegistration
                    : () => onComplete(selectedMarket, {} as OCRUploadResult)
              }
              className="w-full h-11 text-xs font-black uppercase tracking-[0.2em]"
            >
              {loading ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Initializing Agents…</>
              ) : mode === "pdf" ? (
                selectedModule === "reimbursement" ? "Launch Batch Processing →" : "Launch AI Processing →"
              ) : (
                "Continue to Registration →"
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* ── Duplicate Document Warning (PDF mode only) ── */}
      <AnimatePresence>
        {mode === "pdf" && dupInfo && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="rounded-2xl border border-[var(--status-warning)]/25 bg-[var(--status-warning)]/[0.05] p-6 space-y-6 relative overflow-hidden"
          >
            <div className="flex items-start gap-4">
              <div className="p-2 bg-[var(--status-warning)]/15 rounded-lg border border-[var(--status-warning)]/30">
                <ShieldAlert className="h-5 w-5 text-[var(--status-warning)]" />
              </div>
              <div className="flex-1">
                <h4 className="text-sm font-bold text-[var(--status-warning)] uppercase tracking-widest">Duplicate Detected</h4>
                <p className="text-xs text-text-secondary mt-1 leading-relaxed max-w-2xl">{dupMessage}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="glass-card rounded-xl border border-[var(--border-subtle)] bg-[var(--acos-surface)] p-4 space-y-3">
                <div className="flex justify-between items-center pb-2 border-b border-[var(--border-subtle)]">
                  <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider">Original Record</span>
                  <StatusBadge status={dupInfo.status} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-[9px] font-bold text-text-muted uppercase tracking-widest mb-1">Reference</p>
                    <p className="text-xs font-mono text-text-primary">{dupInfo.claim_reference}</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-bold text-text-muted uppercase tracking-widest mb-1">Patient</p>
                    <p className="text-xs font-bold text-text-primary truncate">{dupInfo.patient_name ?? "—"}</p>
                  </div>
                </div>
              </div>

              <div className="flex flex-col justify-center gap-3">
                <Button
                  onClick={handleDuplicateProceed}
                  disabled={dupProceeding}
                  className="h-10 text-[10px] tracking-wider"
                >
                  {dupProceeding ? <Loader2 className="w-4 h-4 animate-spin" /> : "Proceed Anyway (Tag as Duplicate)"}
                </Button>
                <button onClick={handleDuplicateCancel} className="text-[10px] font-bold text-text-muted uppercase tracking-widest hover:text-text-primary transition-colors">
                  Cancel Submission
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showOverlay && (
          <ClaimProcessingOverlay currentStep={animStep} progress={animProgress} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {(batchProgress.length > 0 || batchDecision) && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            className="ui-overlay-backdrop fixed inset-0 z-50 flex items-center justify-center px-4"
          >
            <div className="ui-modal-surface w-full max-w-3xl overflow-hidden">
              <div className="border-b border-[var(--border-subtle)] px-5 py-4">
                <p className="text-[10px] font-black uppercase tracking-[0.22em] text-brand-primary">
                  Multiple Document Processing
                </p>
                <h3 className="mt-1 text-base font-bold text-text-primary">
                  {batchDecision
                    ? `${batchDecision.success} out of ${batchDecision.total} files got uploaded`
                    : "Uploading reviewed claim pack"}
                </h3>
                <p className="mt-1 text-xs leading-5 text-text-muted">
                  Internal claim officer reviewed documents are processed one file at a time and tracked below.
                </p>
              </div>

              <div className="max-h-[52vh] space-y-3 overflow-y-auto px-5 py-4">
                {batchProgress.map((item) => {
                  const statusClass = item.status === "uploaded"
                    ? "border-[var(--status-success)]/20 bg-[var(--status-success)]/[0.08] text-[var(--status-success)]"
                    : item.status === "error"
                      ? "border-[var(--status-danger)]/20 bg-[var(--status-danger)]/[0.08] text-[var(--status-danger)]"
                      : item.status === "uploading"
                        ? "border-brand-primary/20 bg-brand-primary/[0.08] text-brand-primary"
                        : "border-[var(--border-subtle)] bg-[var(--acos-surface)] text-text-muted";
                  return (
                    <div key={item.name} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--acos-surface)] p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-bold text-text-primary">{item.name}</p>
                          <p className="mt-1 text-[10px] text-text-muted">
                            {(item.size / (1024 * 1024)).toFixed(1)} MB
                          </p>
                        </div>
                        <span className={cn("shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em]", statusClass)}>
                          {item.status}
                        </span>
                      </div>
                      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--bg-card-muted)]">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all duration-300",
                            item.status === "error" ? "bg-[var(--status-danger)]" : item.status === "uploaded" ? "bg-[var(--status-success)]" : "bg-brand-primary",
                          )}
                          style={{ width: `${item.progress}%` }}
                        />
                      </div>
                      <p className="mt-2 line-clamp-2 text-[10px] text-text-muted">{item.message}</p>
                    </div>
                  );
                })}
              </div>

              {batchDecision && (
                <div className="border-t border-[var(--border-subtle)] px-5 py-4">
                  <p className="text-sm font-semibold text-text-primary">
                    {batchDecision.failed === 0
                      ? `${batchDecision.success} out of ${batchDecision.total} files got uploaded. Do you want to continue?`
                      : `${batchDecision.success} out of ${batchDecision.total} documents got uploaded. Continue with uploaded documents or cancel?`}
                  </p>
                  <div className="mt-4 flex flex-wrap justify-end gap-3">
                    <Button variant="outline" onClick={cancelBatchUpload}>
                      Cancel
                    </Button>
                    <Button disabled={!batchDecision.result} onClick={continueBatchUpload}>
                      Continue
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
