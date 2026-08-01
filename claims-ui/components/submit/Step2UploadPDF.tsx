"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UploadZone } from "@/components/shared/UploadZone";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, AlertCircle } from "lucide-react";
import { uploadClaimPDF, ApiError } from "@/lib/api";
import { MARKET_LABELS } from "@/lib/constants";
import type { PolicyResponse, OCRUploadResult } from "@/lib/types";

interface Step2Props {
  policy: PolicyResponse;
  onNext: (result: OCRUploadResult) => void;
  onBack: () => void;
}

export function Step2UploadPDF({ policy, onNext, onBack }: Step2Props) {
  const [file, setFile] = useState<File | null>(null);
  const [memberNumber, setMemberNumber] = useState("");
  const [providerCode, setProviderCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [docValidationError, setDocValidationError] = useState<string | null>(null);

  async function handleUpload() {
    if (!file) return;
    setLoading(true);
    setError(null);
    setDocValidationError(null);
    try {
      const result = await uploadClaimPDF(file, {
        member_number: memberNumber || undefined,
        provider_code: providerCode || undefined,
        market_region: policy.market_region,
        policy_number: policy.policy_number,
      });
      onNext(result);
    } catch (err) {
      if (err instanceof ApiError && err.detail === "DOCUMENT_NOT_CLAIM") {
        setDocValidationError(
          "This doesn’t appear to be a medical claim document. " +
          "Please upload a valid claim invoice, hospital bill, or treatment record."
        );
        setError(null);
      } else {
        setError(
          err instanceof ApiError
            ? err.detail
            : "Upload failed. Please try again."
        );
        setDocValidationError(null);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Upload Claim PDF</h2>
      </div>

      {/* Selected policy info */}
      <div className="rounded-md bg-muted/40 px-4 py-2.5 text-sm">
        <span className="text-muted-foreground mr-2">Policy:</span>
        <span className="font-semibold">{policy.policy_name}</span>
        <span className="text-muted-foreground ml-2">({policy.policy_number})</span>
      </div>

      <UploadZone
        onFile={setFile}
        file={file}
        onClear={() => setFile(null)}
        maxSizeMB={20}
        label="Drag & drop claim PDF here, or click to browse"
      />

      {/* Override fields */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Member Number (override)</Label>
          <Input
            value={memberNumber}
            onChange={(e) => setMemberNumber(e.target.value)}
            placeholder="e.g. DAM-2024-100002"
            className="h-9 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Provider Code (override)</Label>
          <Input
            value={providerCode}
            onChange={(e) => setProviderCode(e.target.value)}
            placeholder="e.g. IND-003"
            className="h-9 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Market Region</Label>
          {/* Read-only — locked to the selected policy's region */}
          <div className="h-9 rounded-md border bg-muted/40 px-3 flex items-center text-sm text-muted-foreground select-none">
            {MARKET_LABELS[policy.market_region] ?? policy.market_region}
          </div>
        </div>
      </div>

      {docValidationError && (
        <Alert className="border-[var(--status-warning)]/60 bg-[var(--status-warning)]/10">
          <AlertCircle className="h-4 w-4 text-[var(--status-warning)]" />
          <AlertDescription className="text-[var(--status-warning)] dark:text-[var(--status-warning)]">
            <span className="font-semibold">Wrong document type.</span>{" "}
            {docValidationError}
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex justify-between pt-2">
        <Button variant="outline" onClick={onBack}>
          ← Back
        </Button>
        <Button
          disabled={!file || loading}
          onClick={handleUpload}
          className="gap-1.5"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Extracting…
            </>
          ) : (
            "Upload & Extract →"
          )}
        </Button>
      </div>
    </div>
  );
}
