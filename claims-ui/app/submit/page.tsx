"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { WizardShell } from "@/components/submit/WizardShell";
import { Step1ClaimSubmit } from "@/components/submit/Step1ClaimSubmit";
import { Step2ManualEntry } from "@/components/submit/Step2Manual/Step2ManualEntry";
import { Step3ReviewOCR } from "@/components/submit/Step3ReviewOCR";
import { Step4Processing } from "@/components/submit/Step4Processing";
import { Step5Results } from "@/components/submit/Step5Results";
import { PageHeader } from "@/components/shared/PageHeader";
import type { OCRUploadResult } from "@/lib/types";

type Step = 1 | 2 | 3 | 4;

export default function SubmitPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [mode, setMode] = useState<"pdf" | "manual" | "advance">("pdf");
  const [market, setMarket] = useState<string>("");
  const [ocrResult, setOcrResult] = useState<OCRUploadResult | null>(null);
  const [reviewedFields, setReviewedFields] = useState<Record<string, string>>({});
  const [claimReference, setClaimReference] = useState<string | null>(null);

  function reset() {
    setStep(1);
    setMode("pdf");
    setMarket("");
    setOcrResult(null);
    setReviewedFields({});
    setClaimReference(null);
  }

  return (
    <div className="acos-page">
      <PageHeader
        title="Claim Submission"
      />

      <WizardShell step={step}>
        {/* Step 1: Country + Mode Selection + Upload/Manual */}
        {step === 1 && (
          <Step1ClaimSubmit
            mode={mode}
            onModeChange={setMode}
            onAdvanceRegistration={() => router.push("/claims-advance")}
            onComplete={(mkt, result) => {
              setMarket(mkt);
              // For manual mode, result is empty — go to manual entry form
              if (mode === "manual") {
                setStep(2);
              } else {
                setOcrResult(result);
                // If OCR gave us a pre-adjudicated claim, skip to results
                if (result.claim?.claim_reference) {
                  setClaimReference(result.claim.claim_reference);
                  setStep(4);
                } else {
                  setStep(2);
                }
              }
            }}
          />
        )}

        {/* Step 2a: Manual Entry Form (manual mode) */}
        {step === 2 && mode === "manual" && !ocrResult && (
          <Step2ManualEntry
            market={market}
            onNext={(result) => {
              setOcrResult(result);
              // Setting ocrResult will automatically show Step3ReviewOCR
            }}
            onBack={() => setStep(1)}
          />
        )}

        {/* Step 2b: Review OCR/Manual (both modes) */}
        {step === 2 && ocrResult && (
          <Step3ReviewOCR
            ocrResult={ocrResult}
            policyMarket={null}
            onNext={(fields) => {
              setReviewedFields(fields);
              setStep(3);
            }}
            onBack={() => setStep(1)}
          />
        )}

        {/* Step 3: Processing (was step 4) */}
        {step === 3 && ocrResult && (
          <Step4Processing
            market={market}
            ocrResult={ocrResult}
            reviewedFields={reviewedFields}
            onComplete={(ref) => {
              if (!ref) {
                toast.error("Claim submission failed", {
                  description: "No claim reference was returned. Please try again.",
                });
                return;
              }
              setClaimReference(ref);
              setStep(4);
            }}
            onBack={() => setStep(2)}
            onRestartUpload={() => {
              setOcrResult(null);
              setReviewedFields({});
              setStep(1);
            }}
          />
        )}

        {/* Step 4: Result (was step 5) */}
        {step === 4 && claimReference && (
          <Step5Results claimReference={claimReference} onReset={reset} />
        )}
      </WizardShell>
    </div>
  );
}
