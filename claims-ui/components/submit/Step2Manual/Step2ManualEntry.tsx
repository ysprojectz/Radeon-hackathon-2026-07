"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MemberInfoSection } from "./MemberInfoSection";
import { ProviderInfoSection } from "./ProviderInfoSection";
import { ClinicalInfoSection } from "./ClinicalInfoSection";
import { LineItemsSection } from "./LineItemsSection";
import {
  validateClaimForm,
  type ManualFormState,
  type ValidationError,
} from "@/lib/validation/claimValidation";
import type { OCRUploadResult } from "@/lib/types";

interface Step2ManualEntryProps {
  market: string;
  onNext: (result: OCRUploadResult) => void;
  onBack: () => void;
}

const MARKET_CURRENCY: Record<string, string> = {
  INDIA: "INR",
};

const CLAIM_TYPES = [
  { value: "OUTPATIENT", label: "Outpatient" },
  { value: "INPATIENT", label: "Inpatient" },
  { value: "EMERGENCY", label: "Emergency" },
  { value: "DENTAL", label: "Dental" },
  { value: "OPTICAL", label: "Optical" },
];

export function Step2ManualEntry({ market, onNext, onBack }: Step2ManualEntryProps) {
  const [formData, setFormData] = useState<ManualFormState>({
    claim_type: "OUTPATIENT",
    market_region: market,
    currency: MARKET_CURRENCY[market] || "INR",
    member_number: "",
    patient_name: "",
    patient_dob: "",
    provider_code: "",
    provider_name: "",
    network_tier: "",
    service_date: "",
    admission_date: "",
    discharge_date: "",
    primary_diagnosis_code: "",
    primary_diagnosis_desc: "",
    bank_account_holder: "",
    account_type: "SAVINGS",
    bank_name: "",
    iban: "",
    swift_bic: "",
    account_number: "",
    ifsc_code: "",
    upi_vpa: "",
    upi_provider: "",
    line_items: [
      {
        line_number: 1,
        procedure_code: "",
        service_category: "",
        billed_amount: "",
        units: "1",
      },
    ],
  });

  const [errors, setErrors] = useState<ValidationError[]>([]);

  function handleFieldChange(field: string, value: string) {
    setFormData((prev) => ({ ...prev, [field]: value }));
    // Clear errors for this field
    setErrors((prev) => prev.filter((e) => e.field !== field));
  }

  function handleLineItemsChange(lineItems: ManualFormState["line_items"]) {
    setFormData((prev) => ({ ...prev, line_items: lineItems }));
    // Clear line item errors
    setErrors((prev) => prev.filter((e) => !e.field.startsWith("line_items")));
  }

  function handleSubmit() {
    // Validate form
    const validationErrors = validateClaimForm(formData);
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }

    // Calculate total billed amount
    const totalBilled = formData.line_items
      .reduce((sum, item) => sum + (parseFloat(item.billed_amount) || 0), 0)
      .toFixed(2);

    // Format data to match OCRUploadResult structure
    const manualResult: OCRUploadResult = {
      extracted_fields: {
        claim_type: formData.claim_type,
        market_region: formData.market_region,
        currency: formData.currency,
        member_number: formData.member_number,
        patient_name: formData.patient_name,
        patient_dob: formData.patient_dob,
        provider_code: formData.provider_code,
        provider_name: formData.provider_name,
        network_tier: formData.network_tier,
        service_date: formData.service_date,
        admission_date: formData.admission_date,
        discharge_date: formData.discharge_date,
        primary_diagnosis_code: formData.primary_diagnosis_code,
        primary_diagnosis_desc: formData.primary_diagnosis_desc,
        bank_account_holder: formData.bank_account_holder,
        account_type: formData.account_type,
        bank_name: formData.bank_name,
        iban: formData.iban,
        swift_bic: formData.swift_bic,
        account_number: formData.account_number,
        ifsc_code: formData.ifsc_code,
        upi_vpa: formData.upi_vpa,
        upi_provider: formData.upi_provider,
        total_billed: totalBilled,
        line_items: formData.line_items.map((item) => ({
          procedure_code: item.procedure_code,
          service_category: item.service_category,
          billed_amount: item.billed_amount,
          units: item.units,
        })),
      },
      field_confidences: {}, // No confidence scores for manual entry
      overall_confidence: 1.0, // Manual entry = 100% confidence
    };

    onNext(manualResult);
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">Manual Claim Entry</h2>
        <p className="text-sm text-muted-foreground">
          Enter all claim details manually. All fields marked with{" "}
          <span className="text-[var(--status-danger)]">*</span> are required.
        </p>
      </div>

      {/* Claim Basics */}
      <div className="glass-card space-y-4">
        <h3 className="text-lg font-semibold text-text-primary">Claim Basics</h3>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Claim Type */}
          <div className="space-y-1.5">
            <Label htmlFor="claim_type" className="text-xs font-medium text-text-primary">
              Claim Type <span className="text-[var(--status-danger)]">*</span>
            </Label>
            <select
              id="claim_type"
              value={formData.claim_type}
              onChange={(e) => handleFieldChange("claim_type", e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {CLAIM_TYPES.map((type) => (
                <option key={type.value} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>

          {/* Market Region (Read-only) */}
          <div className="space-y-1.5">
            <Label htmlFor="market_region" className="text-xs font-medium text-text-primary">
              Market Region
            </Label>
            <input
              id="market_region"
              value={formData.market_region}
              disabled
              readOnly
              className="flex h-9 w-full rounded-md border border-input bg-muted/30 px-3 py-1 text-sm shadow-sm opacity-70 cursor-not-allowed"
            />
          </div>

          {/* Currency (Read-only) */}
          <div className="space-y-1.5">
            <Label htmlFor="currency" className="text-xs font-medium text-text-primary">
              Currency
            </Label>
            <input
              id="currency"
              value={formData.currency}
              disabled
              readOnly
              className="flex h-9 w-full rounded-md border border-input bg-muted/30 px-3 py-1 text-sm shadow-sm opacity-70 cursor-not-allowed"
            />
          </div>
        </div>
      </div>

      {/* Member & Patient Info */}
      <MemberInfoSection
        memberNumber={formData.member_number}
        patientName={formData.patient_name}
        patientDob={formData.patient_dob}
        onChange={handleFieldChange}
        errors={errors}
      />

      {/* Provider Info */}
      <ProviderInfoSection
        providerCode={formData.provider_code}
        providerName={formData.provider_name}
        networkTier={formData.network_tier}
        onChange={handleFieldChange}
        errors={errors}
      />

      {/* Clinical Details */}
      <ClinicalInfoSection
        claimType={formData.claim_type}
        serviceDate={formData.service_date}
        admissionDate={formData.admission_date}
        dischargeDate={formData.discharge_date}
        primaryDiagnosisCode={formData.primary_diagnosis_code}
        primaryDiagnosisDesc={formData.primary_diagnosis_desc}
        onChange={handleFieldChange}
        errors={errors}
      />

      {/* Line Items */}
      <LineItemsSection
        lineItems={formData.line_items}
        onChange={handleLineItemsChange}
        errors={errors}
      />

      <div className="glass-card space-y-4">
        <h3 className="text-lg font-semibold text-text-primary">Payout Account</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="bank_account_holder" className="text-xs font-medium text-text-primary">Account Holder</Label>
            <input id="bank_account_holder" value={formData.bank_account_holder ?? ""} onChange={(e) => handleFieldChange("bank_account_holder", e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" placeholder="Name on account" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="bank_name" className="text-xs font-medium text-text-primary">Bank Name</Label>
            <input id="bank_name" value={formData.bank_name ?? ""} onChange={(e) => handleFieldChange("bank_name", e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" placeholder="Bank or wallet provider" />
          </div>
          {market === "INDIA" ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="account_number" className="text-xs font-medium text-text-primary">Account Number</Label>
                <input id="account_number" value={formData.account_number ?? ""} onChange={(e) => handleFieldChange("account_number", e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" placeholder="Stored masked/encrypted" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ifsc_code" className="text-xs font-medium text-text-primary">IFSC Code</Label>
                <input id="ifsc_code" value={formData.ifsc_code ?? ""} onChange={(e) => handleFieldChange("ifsc_code", e.target.value.toUpperCase())} className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" placeholder="HDFC0001234" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="upi_vpa" className="text-xs font-medium text-text-primary">UPI/VPA Alternative</Label>
                <input id="upi_vpa" value={formData.upi_vpa ?? ""} onChange={(e) => handleFieldChange("upi_vpa", e.target.value)} className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" placeholder="name@paytm" />
              </div>
            </>
          ) : (
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="iban" className="text-xs font-medium text-text-primary">IBAN</Label>
              <input id="iban" value={formData.iban ?? ""} onChange={(e) => handleFieldChange("iban", e.target.value.toUpperCase().replace(/\s+/g, ""))} className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" placeholder="AE070331234567890123456" />
            </div>
          )}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex justify-between pt-2">
        <Button variant="outline" onClick={onBack}>
          ← Back
        </Button>
        <Button onClick={handleSubmit} className="gap-1.5">
          Continue to Review →
        </Button>
      </div>
    </div>
  );
}
