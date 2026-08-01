"use client";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { UploadZone } from "@/components/shared/UploadZone";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { uploadPolicyDocument, ApiError } from "@/lib/api";
import type { PolicyResponse, PolicyDocumentUploadResponse } from "@/lib/types";
import { toast } from "sonner";

interface PolicyUploadModalProps {
  policy: PolicyResponse | null;
  /** All available policies — used for the selector when no policy is pre-selected */
  policies?: PolicyResponse[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}

type Phase = "idle" | "uploading" | "done" | "error";

export function PolicyUploadModal({
  policy: preselectedPolicy,
  policies = [],
  open,
  onOpenChange,
  onSuccess,
}: PolicyUploadModalProps) {
  const [selectedPolicyId, setSelectedPolicyId] = useState<string>("");
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<PolicyDocumentUploadResponse | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Resolve the active policy: pre-selected from card click, or chosen via dropdown
  const policy =
    preselectedPolicy ??
    policies.find((p) => p.id === selectedPolicyId) ??
    null;

  function reset() {
    setFile(null);
    setPhase("idle");
    setProgress(0);
    setResult(null);
    setErrorMsg(null);
    setSelectedPolicyId("");
  }

  async function handleUpload() {
    if (!file || !policy) return;
    setPhase("uploading");
    setProgress(15);

    // Simulate progress ticks while uploading
    const ticker = setInterval(() => {
      setProgress((p) => Math.min(p + 8, 85));
    }, 600);

    try {
      const res = await uploadPolicyDocument(policy.id, file);
      clearInterval(ticker);
      setProgress(100);
      setResult(res);
      setPhase("done");
      toast.success(
        `${res.clauses_extracted} clauses extracted`,
        { description: policy.policy_name }
      );
      onSuccess();
    } catch (err) {
      clearInterval(ticker);
      setErrorMsg(
        err instanceof ApiError ? err.detail : "Upload failed. Please try again."
      );
      setPhase("error");
    }
  }

  function handleClose(open: boolean) {
    if (!open) reset();
    onOpenChange(open);
  }

  const phaseLabel =
    progress < 40
      ? "Uploading PDF…"
      : progress < 70
      ? "OCR extraction…"
      : "Intelligence AI Agent clause extraction…";

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Upload Policy Document</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Pre-selected policy (from card click) */}
          {preselectedPolicy && (
            <div className="rounded-md bg-muted/40 px-4 py-2.5 text-sm">
              <p className="text-muted-foreground text-xs">Policy</p>
              <p className="font-semibold">{preselectedPolicy.policy_name}</p>
              <p className="text-xs text-muted-foreground font-mono">
                {preselectedPolicy.policy_number}
              </p>
            </div>
          )}

          {/* Policy selector (when opened from top-right button without a pre-selected policy) */}
          {!preselectedPolicy && phase === "idle" && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Select policy <span className="text-destructive">*</span>
              </label>
              <Select value={selectedPolicyId} onValueChange={setSelectedPolicyId}>
                <SelectTrigger className={!selectedPolicyId ? "border-amber-500/60 focus:border-amber-500" : ""}>
                  <SelectValue placeholder="Choose a policy…" />
                </SelectTrigger>
                <SelectContent>
                  {policies.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.policy_name} ({p.policy_number})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!selectedPolicyId && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400">
                  Select a policy to enable upload
                </p>
              )}
            </div>
          )}

          {phase === "idle" && (
            <>
              <UploadZone
                onFile={setFile}
                file={file}
                onClear={() => setFile(null)}
                maxSizeMB={30}
                label="Drop policy PDF here (max 30 MB)"
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => handleClose(false)}>
                  Cancel
                </Button>
                <Button
                  disabled={!file || !policy}
                  onClick={handleUpload}
                  title={!policy ? "Select a policy first" : !file ? "Attach a PDF file first" : ""}
                >
                  Upload & Extract
                </Button>
              </div>
              {!preselectedPolicy && file && !policy && (
                <p className="text-xs text-center text-amber-600 dark:text-amber-400">
                  Please select a policy above to enable upload
                </p>
              )}
            </>
          )}

          {phase === "uploading" && (
            <div className="space-y-3 py-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {phaseLabel}
              </div>
              <Progress value={progress} className="h-2" />
              <p className="text-xs text-muted-foreground text-right">
                {progress}%
              </p>
            </div>
          )}

          {phase === "done" && result && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 dark:text-emerald-400 text-green-700">
                <CheckCircle2 className="h-5 w-5" />
                <span className="font-semibold text-sm">
                  {result.clauses_extracted} clauses extracted
                </span>
              </div>
              <div className="rounded-md dark:bg-emerald-500/10 bg-green-50 border dark:border-emerald-500/20 border-green-200 p-3 text-xs space-y-1">
                <p>Pages: {result.page_count}</p>
                <p>Document reader: {result.ocr_engine_used}</p>
                <p>Assistant: {result.llm_model_used}</p>
                <p>Time: {result.processing_time_ms.toLocaleString()} ms</p>
                {result.warnings.length > 0 && (
                  <p className="dark:text-amber-400 text-yellow-700">
                    Warnings: {result.warnings.join(", ")}
                  </p>
                )}
              </div>
              <Button className="w-full" onClick={() => handleClose(false)}>
                Done
              </Button>
            </div>
          )}

          {phase === "error" && (
            <div className="space-y-3">
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{errorMsg}</AlertDescription>
              </Alert>
              <div className="flex gap-2">
                <Button variant="outline" onClick={reset} className="flex-1">
                  Try Again
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => handleClose(false)}
                  className="flex-1"
                >
                  Close
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
