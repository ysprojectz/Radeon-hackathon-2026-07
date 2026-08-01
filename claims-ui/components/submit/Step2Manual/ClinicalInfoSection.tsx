"use client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AlertCircle } from "lucide-react";
import type { ValidationError } from "@/lib/validation/claimValidation";
import { getFieldError } from "@/lib/validation/claimValidation";

interface ClinicalInfoSectionProps {
  claimType: string;
  serviceDate: string;
  admissionDate?: string;
  dischargeDate?: string;
  primaryDiagnosisCode: string;
  primaryDiagnosisDesc?: string;
  onChange: (field: string, value: string) => void;
  errors: ValidationError[];
}

export function ClinicalInfoSection({
  claimType,
  serviceDate,
  admissionDate,
  dischargeDate,
  primaryDiagnosisCode,
  primaryDiagnosisDesc,
  onChange,
  errors,
}: ClinicalInfoSectionProps) {
  const serviceDateError = getFieldError(errors, "service_date");
  const admissionDateError = getFieldError(errors, "admission_date");
  const dischargeDateError = getFieldError(errors, "discharge_date");
  const diagnosisCodeError = getFieldError(errors, "primary_diagnosis_code");

  const isInpatient = claimType === "INPATIENT";

  return (
    <div className="glass-card space-y-4">
      <h3 className="text-lg font-semibold text-text-primary">Clinical Details</h3>

      {/* Service Date */}
      <div className="space-y-1.5">
        <Label htmlFor="service_date" className="text-xs font-medium text-text-primary">
          Service Date <span className="text-[var(--status-danger)]">*</span>
        </Label>
        <Input
          id="service_date"
          type="date"
          value={serviceDate}
          onChange={(e) => onChange("service_date", e.target.value)}
          max={new Date().toISOString().split("T")[0]}
          className={serviceDateError ? "border-[var(--status-danger)]" : ""}
        />
        {serviceDateError && (
          <p className="text-xs text-[var(--status-danger)] flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            {serviceDateError}
          </p>
        )}
      </div>

      {/* Admission Date (INPATIENT only) */}
      {isInpatient && (
        <div className="space-y-1.5">
          <Label htmlFor="admission_date" className="text-xs font-medium text-text-primary">
            Admission Date
          </Label>
          <Input
            id="admission_date"
            type="date"
            value={admissionDate ?? ""}
            onChange={(e) => onChange("admission_date", e.target.value)}
            max={new Date().toISOString().split("T")[0]}
            className={admissionDateError ? "border-[var(--status-danger)]" : ""}
          />
          {admissionDateError && (
            <p className="text-xs text-[var(--status-danger)] flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              {admissionDateError}
            </p>
          )}
        </div>
      )}

      {/* Discharge Date (INPATIENT only) */}
      {isInpatient && (
        <div className="space-y-1.5">
          <Label htmlFor="discharge_date" className="text-xs font-medium text-text-primary">
            Discharge Date
          </Label>
          <Input
            id="discharge_date"
            type="date"
            value={dischargeDate ?? ""}
            onChange={(e) => onChange("discharge_date", e.target.value)}
            max={new Date().toISOString().split("T")[0]}
            className={dischargeDateError ? "border-[var(--status-danger)]" : ""}
          />
          {dischargeDateError && (
            <p className="text-xs text-[var(--status-danger)] flex items-center gap-1">
              <AlertCircle className="h-3 w-3" />
              {dischargeDateError}
            </p>
          )}
        </div>
      )}

      {/* Primary Diagnosis Code */}
      <div className="space-y-1.5">
        <Label htmlFor="primary_diagnosis_code" className="text-xs font-medium text-text-primary">
          Primary Diagnosis Code <span className="text-[var(--status-danger)]">*</span>
        </Label>
        <Input
          id="primary_diagnosis_code"
          value={primaryDiagnosisCode}
          onChange={(e) => onChange("primary_diagnosis_code", e.target.value)}
          placeholder="e.g., A09, J06.9"
          className={diagnosisCodeError ? "border-[var(--status-danger)]" : ""}
        />
        {diagnosisCodeError && (
          <p className="text-xs text-[var(--status-danger)] flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            {diagnosisCodeError}
          </p>
        )}
      </div>

      {/* Primary Diagnosis Description (Optional) */}
      <div className="space-y-1.5">
        <Label htmlFor="primary_diagnosis_desc" className="text-xs font-medium text-text-primary">
          Primary Diagnosis Description (Optional)
        </Label>
        <Textarea
          id="primary_diagnosis_desc"
          value={primaryDiagnosisDesc ?? ""}
          onChange={(e) => onChange("primary_diagnosis_desc", e.target.value)}
          placeholder="e.g., Gastroenteritis and colitis"
          rows={2}
        />
      </div>
    </div>
  );
}
