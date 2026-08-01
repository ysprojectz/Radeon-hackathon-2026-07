"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, AlertTriangle, X } from "lucide-react";
import { submitClaimJSON, ApiError, formatApiError } from "@/lib/api";
import type { ClaimResponse } from "@/lib/types";

const MARKET_CURRENCY: Record<string, string> = {
  UAE: "AED", KSA: "SAR", BAHRAIN: "BHD", INDIA: "INR",
};

const CLAIM_TYPES = ["OUTPATIENT", "INPATIENT", "DENTAL", "OPTICAL", "PHARMACY"];

interface Step2ManualEntryProps {
  market: string;
  onComplete: (claim: ClaimResponse) => void;
  onBack: () => void;
}

function todayString(): string {
  return new Date().toISOString().split("T")[0];
}

function isOlderThan365Days(dateStr: string): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return false;
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - 1);
  return d < cutoff;
}

export function Step2ManualEntry({ market, onComplete, onBack }: Step2ManualEntryProps) {
  const today = todayString();
  const defaultCurrency = MARKET_CURRENCY[market] ?? "AED";

  // ── Form field state ────────────────────────────────────────────────────────
  const [claimType, setClaimType]         = useState("OUTPATIENT");
  const [memberNumber, setMemberNumber]   = useState("");
  const [patientName, setPatientName]     = useState("");
  const [patientDob, setPatientDob]       = useState("");
  const [serviceDate, setServiceDate]     = useState("");
  const [providerCode, setProviderCode]   = useState("");
  const [providerName, setProviderName]   = useState("");
  const [diagnosisCode, setDiagnosisCode] = useState("");
  const [diagnosisDesc, setDiagnosisDesc] = useState("");
  const [currency, setCurrency]           = useState(defaultCurrency);
  const [procedureCode, setProcedureCode] = useState("");
  const [procedureDesc, setProcedureDesc] = useState("");
  const [billedAmount, setBilledAmount]   = useState("");
  const [accountHolder, setAccountHolder] = useState("");
  const [bankName, setBankName]           = useState("");
  const [iban, setIban]                   = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [ifscCode, setIfscCode]           = useState("");
  const [upiVpa, setUpiVpa]               = useState("");

  // ── Error / loading state ───────────────────────────────────────────────────
  const [formError, setFormError]         = useState<string | null>(null);
  const [fieldErrors, setFieldErrors]     = useState<Record<string, string>>({});
  const [submitting, setSubmitting]       = useState(false);

  // ── Client-side validation ──────────────────────────────────────────────────
  function validate(): Record<string, string> {
    const errs: Record<string, string> = {};
    if (!memberNumber.trim()) errs.memberNumber = "Member Number is required";
    if (!serviceDate)         errs.serviceDate  = "Service Date is required";
    if (!diagnosisCode.trim()) errs.diagnosisCode = "Diagnosis Code is required";
    if (!billedAmount || isNaN(parseFloat(billedAmount)) || parseFloat(billedAmount) <= 0)
      errs.billedAmount = "Billed Amount must be a positive number";
    return errs;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      return;
    }
    setFieldErrors({});
    setSubmitting(true);

    try {
      const claim = await submitClaimJSON({
        claim_type:             claimType,
        market_region:          market,
        currency,
        member_number:          memberNumber.trim(),
        patient_name:           patientName.trim(),
        patient_dob:            patientDob,
        provider_code:          providerCode.trim(),
        provider_name:          providerName.trim(),
        service_date:           serviceDate,
        primary_diagnosis_code: diagnosisCode.trim(),
        primary_diagnosis_desc: diagnosisDesc.trim() || undefined,
        source_channel:         "MANUAL_ENTRY",
        bank_account_holder:    accountHolder.trim() || patientName.trim() || undefined,
        account_holder_name:    accountHolder.trim() || patientName.trim() || undefined,
        bank_name:              bankName.trim() || undefined,
        iban:                   market === "INDIA" ? undefined : iban.trim().toUpperCase() || undefined,
        account_number:         market === "INDIA" ? accountNumber.trim() || undefined : undefined,
        ifsc_code:              market === "INDIA" ? ifscCode.trim().toUpperCase() || undefined : undefined,
        upi_vpa:                market === "INDIA" ? upiVpa.trim() || undefined : undefined,
        line_items: [
          {
            line_number:      1,
            procedure_code:   procedureCode.trim() || "GEN001",
            procedure_desc:   procedureDesc.trim() || undefined,
            service_category: claimType,
            billed_amount:    parseFloat(billedAmount),
          },
        ],
      });
      onComplete(claim);
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        // Try to surface field-level errors inline
        const msg = formatApiError(err);
        setFormError(msg);
      } else {
        setFormError(formatApiError(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  const serviceDateOld = isOlderThan365Days(serviceDate);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Manual Claim Entry</h2>
      </div>

      {/* Top-level dismissible error banner */}
      {formError && (
        <Alert variant="destructive" role="alert">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <AlertDescription className="flex-1">{formError}</AlertDescription>
          <button
            type="button"
            aria-label="Dismiss error"
            className="ml-auto shrink-0 opacity-70 hover:opacity-100 transition-opacity"
            onClick={() => setFormError(null)}
          >
            <X className="h-4 w-4" />
          </button>
        </Alert>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {/* Claim Type */}
        <div className="space-y-1.5">
          <Label htmlFor="claimType" className="text-xs font-medium">Claim Type</Label>
          <select
            id="claimType"
            value={claimType}
            onChange={(e) => setClaimType(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {CLAIM_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        {/* Member Number */}
        <div className="space-y-1.5">
          <Label htmlFor="memberNumber" className="text-xs font-medium">
            Member Number <span className="text-[var(--status-danger)]">*</span>
          </Label>
          <Input
            id="memberNumber"
            value={memberNumber}
            onChange={(e) => setMemberNumber(e.target.value)}
            placeholder="e.g. MBR-12345"
            aria-invalid={!!fieldErrors.memberNumber}
            className={fieldErrors.memberNumber ? "border-[var(--status-danger)]" : ""}
          />
          {fieldErrors.memberNumber && (
            <p className="flex items-center gap-1 text-xs text-[var(--status-danger)]">
              <AlertCircle className="h-3 w-3" aria-hidden="true" />
              {fieldErrors.memberNumber}
            </p>
          )}
        </div>

        {/* Patient Name */}
        <div className="space-y-1.5">
          <Label htmlFor="patientName" className="text-xs font-medium">Patient Name</Label>
          <Input
            id="patientName"
            value={patientName}
            onChange={(e) => setPatientName(e.target.value)}
            placeholder="Full name as on insurance card"
          />
        </div>

        {/* Patient DOB */}
        <div className="space-y-1.5">
          <Label htmlFor="patientDob" className="text-xs font-medium">Date of Birth</Label>
          <Input
            id="patientDob"
            type="date"
            value={patientDob}
            max={today}
            onChange={(e) => setPatientDob(e.target.value)}
          />
        </div>

        {/* Service Date */}
        <div className="space-y-1.5">
          <Label htmlFor="serviceDate" className="text-xs font-medium">
            Service Date <span className="text-[var(--status-danger)]">*</span>
          </Label>
          <Input
            id="serviceDate"
            type="date"
            value={serviceDate}
            max={today}
            onChange={(e) => setServiceDate(e.target.value)}
            aria-invalid={!!fieldErrors.serviceDate}
            className={fieldErrors.serviceDate ? "border-[var(--status-danger)]" : ""}
          />
          {fieldErrors.serviceDate && (
            <p className="flex items-center gap-1 text-xs text-[var(--status-danger)]">
              <AlertCircle className="h-3 w-3" aria-hidden="true" />
              {fieldErrors.serviceDate}
            </p>
          )}
          {!fieldErrors.serviceDate && serviceDateOld && (
            <p className="flex items-center gap-1 text-xs text-[var(--status-warning)] dark:text-[var(--status-warning)]" role="alert">
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              This claim is over 1 year old — verify before submitting
            </p>
          )}
        </div>

        {/* Provider */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="providerCode" className="text-xs font-medium">Provider Code</Label>
            <Input
              id="providerCode"
              value={providerCode}
              onChange={(e) => setProviderCode(e.target.value)}
              placeholder="e.g. PRV-001"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="providerName" className="text-xs font-medium">Provider Name</Label>
            <Input
              id="providerName"
              value={providerName}
              onChange={(e) => setProviderName(e.target.value)}
              placeholder="Hospital or clinic name"
            />
          </div>
        </div>

        <div className="space-y-3 rounded-lg border border-border/70 p-3">
          <h3 className="text-sm font-semibold">Payout Account</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="accountHolder" className="text-xs font-medium">Account Holder</Label>
              <Input id="accountHolder" value={accountHolder} onChange={(e) => setAccountHolder(e.target.value)} placeholder="Name on account" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bankName" className="text-xs font-medium">Bank Name</Label>
              <Input id="bankName" value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="Bank or wallet provider" />
            </div>
            {market === "INDIA" ? (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="accountNumber" className="text-xs font-medium">Account Number</Label>
                  <Input id="accountNumber" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} placeholder="Stored masked/encrypted" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ifscCode" className="text-xs font-medium">IFSC Code</Label>
                  <Input id="ifscCode" value={ifscCode} onChange={(e) => setIfscCode(e.target.value.toUpperCase())} placeholder="HDFC0001234" />
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label htmlFor="upiVpa" className="text-xs font-medium">UPI/VPA Alternative</Label>
                  <Input id="upiVpa" value={upiVpa} onChange={(e) => setUpiVpa(e.target.value)} placeholder="name@paytm" />
                </div>
              </>
            ) : (
              <div className="col-span-2 space-y-1.5">
                <Label htmlFor="iban" className="text-xs font-medium">IBAN</Label>
                <Input id="iban" value={iban} onChange={(e) => setIban(e.target.value.toUpperCase().replace(/\s+/g, ""))} placeholder="AE070331234567890123456" />
              </div>
            )}
          </div>
        </div>

        {/* Diagnosis */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="diagnosisCode" className="text-xs font-medium">
              Diagnosis Code <span className="text-[var(--status-danger)]">*</span>
            </Label>
            <Input
              id="diagnosisCode"
              value={diagnosisCode}
              onChange={(e) => setDiagnosisCode(e.target.value)}
              placeholder="ICD-10 code"
              aria-invalid={!!fieldErrors.diagnosisCode}
              className={fieldErrors.diagnosisCode ? "border-[var(--status-danger)]" : ""}
            />
            {fieldErrors.diagnosisCode && (
              <p className="flex items-center gap-1 text-xs text-[var(--status-danger)]">
                <AlertCircle className="h-3 w-3" aria-hidden="true" />
                {fieldErrors.diagnosisCode}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="diagnosisDesc" className="text-xs font-medium">Diagnosis Description</Label>
            <Input
              id="diagnosisDesc"
              value={diagnosisDesc}
              onChange={(e) => setDiagnosisDesc(e.target.value)}
              placeholder="Optional description"
            />
          </div>
        </div>

        {/* Procedure / Line Item */}
        <div className="rounded-lg border p-3 space-y-3 bg-muted/20">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Line Item</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="procedureCode" className="text-xs font-medium">Procedure Code</Label>
              <Input
                id="procedureCode"
                value={procedureCode}
                onChange={(e) => setProcedureCode(e.target.value)}
                placeholder="CPT / procedure code"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="procedureDesc" className="text-xs font-medium">Description</Label>
              <Input
                id="procedureDesc"
                value={procedureDesc}
                onChange={(e) => setProcedureDesc(e.target.value)}
                placeholder="Procedure description"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="currency" className="text-xs font-medium">Currency</Label>
              <Input
                id="currency"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                placeholder="AED"
                maxLength={3}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="billedAmount" className="text-xs font-medium">
                Billed Amount <span className="text-[var(--status-danger)]">*</span>
              </Label>
              <Input
                id="billedAmount"
                type="number"
                min="0"
                step="0.01"
                value={billedAmount}
                onChange={(e) => setBilledAmount(e.target.value)}
                placeholder="0.00"
                aria-invalid={!!fieldErrors.billedAmount}
                className={fieldErrors.billedAmount ? "border-[var(--status-danger)]" : ""}
              />
              {fieldErrors.billedAmount && (
                <p className="flex items-center gap-1 text-xs text-[var(--status-danger)]">
                  <AlertCircle className="h-3 w-3" aria-hidden="true" />
                  {fieldErrors.billedAmount}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="flex justify-between pt-2">
          <Button type="button" variant="outline" onClick={onBack} disabled={submitting}>
            ← Back
          </Button>
          <Button type="submit" disabled={submitting} className="gap-1.5">
            {submitting ? "Submitting…" : "Submit Claim →"}
          </Button>
        </div>
      </form>
    </div>
  );
}
