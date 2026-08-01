"use client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
import { ClaimProcessingOverlay } from "./ClaimProcessingOverlay";
import type { ClaimCreate, OCRUploadResult, ClaimResponse } from "@/lib/types";
import { submitClaimJSON, ApiError, formatApiError } from "@/lib/api";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle, Cpu, FileText, Shield, Calculator } from "lucide-react";
import { toast } from "sonner";

const MARKET_CURRENCY: Record<string, string> = {
  INDIA: "INR",
};

interface Step4Props {
  market: string;
  ocrResult: OCRUploadResult;
  reviewedFields: Record<string, string>;
  onComplete: (claimReference: string) => void;
  onBack: () => void;
  onRestartUpload?: () => void;
}

type ProcessingStepId = "ocr" | "eligibility" | "ai" | "settlement";

const STEP_LABELS: Record<ProcessingStepId, string> = {
  ocr: "OCR extraction & enrichment",
  eligibility: "Rules engine evaluation",
  ai: "AI intelligence analysis",
  settlement: "Settlement calculation",
};

const STEP_ICONS: Record<ProcessingStepId, React.ReactNode> = {
  ocr: <FileText className="h-4 w-4" />,
  eligibility: <Shield className="h-4 w-4" />,
  ai: <Cpu className="h-4 w-4" />,
  settlement: <Calculator className="h-4 w-4" />,
};

const PIPELINE_STAGES: ProcessingStepId[] = ["ocr", "eligibility", "ai", "settlement"];

export function Step4Processing({
  market,
  ocrResult,
  reviewedFields,
  onComplete,
  onBack,
  onRestartUpload,
}: Step4Props) {
  const [currentStep, setCurrentStep] = useState<ProcessingStepId>("ocr");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [failedStep, setFailedStep] = useState<ProcessingStepId | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [recoveredRef, setRecoveredRef] = useState<string | null>(null);

  // Guard against React 19 StrictMode double-mount triggering duplicate API calls
  const submittedRef = useRef(false);

  // On mount, check for a saved claim reference from a previous session
  useEffect(() => {
    const saved = sessionStorage.getItem('last_submitted_claim');
    if (saved) {
      setRecoveredRef(saved);
      sessionStorage.removeItem('last_submitted_claim');
    }
  }, []);

  function handleRetry() {
    setError(null);
    setFailedStep(null);
    submittedRef.current = false;
    setCurrentStep("ocr");
    setProgress(0);
    setRetryCount((c) => c + 1);
  }

  useEffect(() => {
    if (submittedRef.current) return;
    submittedRef.current = true;
    const controller = new AbortController();
    
    // Set a 60-second timeout for the entire submission process
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, 60000);

    let cancelled = false;

    async function animateDelay(ms: number) {
      return new Promise((r) => setTimeout(r, ms));
    }

    async function animateProgressTo(target: number) {
      const steps = 10;
      const current = progress;
      const diff = target - current;
      if (diff <= 0) return;
      
      for (let i = 1; i <= steps; i++) {
        if (cancelled) return;
        setProgress(current + (diff * (i / steps)));
        await animateDelay(50);
      }
    }

    async function processStandardPipeline(payload: ClaimCreate, signal: AbortSignal) {
      try {
        // Step 1: Ingest (OCR was already done, but we simulate stage progression)
        setCurrentStep("ocr");
        await animateProgressTo(25);
        if (cancelled) return;

        // Step 2 & 3: Submit to backend (Rules + AI + Settlement)
        setCurrentStep("eligibility");
        await animateProgressTo(50);
        
        const response: ClaimResponse = await submitClaimJSON(payload, { signal });
        
        setCurrentStep("ai");
        await animateProgressTo(75);
        if (cancelled) return;

        setCurrentStep("settlement");
        await animateProgressTo(100);
        
        if (cancelled) return;
        
        const claimReference = response.claim_reference;
        toast.success("Claim processed successfully!", {
          description: `Reference: ${claimReference}`,
        });
        
        sessionStorage.setItem('last_submitted_claim', claimReference);
        onComplete(claimReference);
        
      } catch (err) {
        if (cancelled) return;
        throw err;
      }
    }

    async function run() {
      // Hard-validate required fields before doing anything
      const missing: string[] = [];
      if (!reviewedFields.service_date) missing.push("Service Date");
      if (!reviewedFields.member_number) missing.push("Member Number");
      if (!reviewedFields.total_billed) missing.push("Total Billed");
      if (!reviewedFields.primary_diagnosis_code) missing.push("Diagnosis Code");
      if (!reviewedFields.patient_dob) missing.push("Patient DOB");
      if (missing.length > 0) {
        setError(`Missing required fields: ${missing.join(", ")}. Please go back and fill them in.`);
        clearTimeout(timeoutId);
        return;
      }

      // Validate that OCR extracted at least one line item
      const lineItemsForValidation = (ocrResult.extracted_fields?.line_items as Array<unknown> | undefined) ?? [];
      if (lineItemsForValidation.length === 0) {
        setError("no_line_items");
        clearTimeout(timeoutId);
        return;
      }

      // If the OCR already provided a pre-adjudicated claim, skip to results
      if (ocrResult.claim?.claim_reference) {
        await animateProgressTo(100);
        if (cancelled) return;
        toast.success("Claim submitted successfully!", {
          description: `Reference: ${ocrResult.claim.claim_reference}`,
        });
        sessionStorage.setItem('last_submitted_claim', ocrResult.claim.claim_reference);
        onComplete(ocrResult.claim.claim_reference);
        clearTimeout(timeoutId);
        return;
      }

      try {
        const fields = reviewedFields;
        const lineItems = (ocrResult.extracted_fields?.line_items as Array<{
          procedure_code?: string;
          procedure_desc?: string;
          service_category?: string;
          billed_amount?: string;
        }> | undefined) ?? [];

        // Build standard claim payload
        const claimPayload: ClaimCreate = {
          member_number: fields.member_number ?? "",
          patient_name: fields.patient_name ?? "",
          patient_dob: fields.patient_dob ?? "",
          provider_name: fields.provider_name ?? "",
          provider_code: fields.provider_code ?? "",
          service_date: fields.service_date ?? "",
          claim_type: fields.claim_type ?? "OUTPATIENT",
          market_region: fields.market_region ?? market,
          network_tier: fields.network_tier,
          currency: fields.currency ?? MARKET_CURRENCY[market] ?? "INR",
          primary_diagnosis_code: fields.primary_diagnosis_code ?? "",
          bank_account_holder: fields.bank_account_holder || fields.account_holder_name || undefined,
          account_holder_name: fields.account_holder_name || fields.bank_account_holder || undefined,
          account_type: (fields.account_type as ClaimCreate["account_type"]) || undefined,
          bank_name: fields.bank_name || undefined,
          iban: fields.iban || undefined,
          swift_bic: fields.swift_bic || undefined,
          account_number: fields.account_number || undefined,
          ifsc_code: fields.ifsc_code || undefined,
          upi_vpa: fields.upi_vpa || undefined,
          upi_provider: fields.upi_provider || undefined,
          line_items: lineItems.map((li, i) => ({
            line_number: i + 1,
            procedure_code: li.procedure_code ?? "",
            procedure_desc: li.procedure_desc ?? "",
            service_category: li.service_category ?? "CONSULTATION",
            billed_amount: parseFloat(li.billed_amount ?? "0"),
          })),
        };

        // Standard adjudication pipeline
        await processStandardPipeline(claimPayload, controller.signal);
        clearTimeout(timeoutId);
        
      } catch (err: unknown) {
        if (cancelled) return;
        clearTimeout(timeoutId);
        
        let errorMessage = "Failed to process claim";
        if (err instanceof ApiError) {
          errorMessage = formatApiError(err);
        } else if (err instanceof Error) {
          if (err.name === 'AbortError') {
            errorMessage = "Request timed out (60s). The server may still be processing, please check the dashboard later.";
          } else {
            errorMessage = err.message;
          }
        }
        
        setError(errorMessage);
        setFailedStep(currentStep);
      }
    }

    run();
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [retryCount]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    if (error === "no_line_items") {
      return (
        <div className="space-y-6">
          <div>
            <h2 className="text-lg font-semibold">Adjudication Error</h2>
          </div>
          <Alert variant="destructive" role="alert">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <p className="font-medium">No line items were extracted. Please upload a different document.</p>
            </AlertDescription>
          </Alert>
          <div className="flex gap-3">
            <Button variant="outline" onClick={onRestartUpload ?? onBack}>
              &larr; Upload a different document
            </Button>
          </div>
        </div>
      );
    }

    const maxRetriesReached = retryCount >= 3;
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold">Adjudication Error</h2>
        </div>

        <Alert variant="destructive" role="alert">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            <p className="font-medium">{error}</p>
            {failedStep && (
              <p className="mt-1 text-sm opacity-80">
                Failed during: <span className="font-semibold">{STEP_LABELS[failedStep]}</span>
              </p>
            )}
          </AlertDescription>
        </Alert>

        {maxRetriesReached ? (
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            <p className="font-semibold">Maximum retry attempts reached.</p>
            <p className="mt-1 text-muted-foreground">
              Please contact support and reference the error above.
            </p>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Retry attempt {retryCount} of 3
          </p>
        )}

        <div className="flex gap-3">
          <Button variant="outline" onClick={onBack}>
            &larr; Back
          </Button>
          {!maxRetriesReached && (
            <Button variant="destructive" onClick={handleRetry}>
              Retry
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      {recoveredRef && (
        <div className="mb-4 rounded-lg border border-brand-primary bg-brand-primary px-4 py-3 text-sm text-brand-primary dark:border-brand-primary dark:bg-brand-primary/40 dark:text-brand-primary">
          Your claim{" "}
          <span className="font-mono font-semibold">{recoveredRef}</span> was
          submitted.{" "}
          <a
            href={`/claims/${recoveredRef}`}
            className="underline font-medium"
          >
            View it here.
          </a>
        </div>
      )}
      
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              {STEP_ICONS[currentStep]}
              <span className="font-medium">{STEP_LABELS[currentStep]}</span>
            </div>
            <div className="w-full bg-secondary rounded-full h-2">
              <div
                className="bg-primary h-2 rounded-full transition-all duration-300 ease-out"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-muted-foreground mt-1">
              <span>{Math.round(progress)}%</span>
            </div>
          </div>
        </div>
        
        <div className="grid grid-cols-4 gap-2 text-xs">
          {PIPELINE_STAGES.map((stage, index) => {
            const isCompleted = PIPELINE_STAGES.indexOf(stage) < PIPELINE_STAGES.indexOf(currentStep) || 
                              (stage === currentStep && progress >= 100);
            const isCurrent = stage === currentStep;
            return (
              <div key={stage} className="flex flex-col items-center gap-1">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                  isCompleted ? "bg-primary text-primary-foreground" : 
                  isCurrent ? "bg-accent text-accent-foreground border-2 border-primary" :
                  "bg-secondary text-secondary-foreground"
                }`}>
                  {isCompleted ? <CheckCircle className="h-4 w-4" /> : STEP_ICONS[stage]}
                </div>
                <span className={`text-center ${isCompleted ? "text-primary" : "text-muted-foreground"}`}>
                  {index + 1}. {STEP_LABELS[stage].split(' ')[0]}
                </span>
              </div>
            );
          })}
        </div>
      </div>
      
      <AnimatePresence>
        <ClaimProcessingOverlay currentStep={currentStep} progress={progress} />
      </AnimatePresence>
    </>
  );
}
