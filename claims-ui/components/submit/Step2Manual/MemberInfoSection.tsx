"use client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle } from "lucide-react";
import type { ValidationError } from "@/lib/validation/claimValidation";
import { getFieldError } from "@/lib/validation/claimValidation";

interface MemberInfoSectionProps {
  memberNumber: string;
  patientName: string;
  patientDob: string;
  onChange: (field: string, value: string) => void;
  errors: ValidationError[];
}

export function MemberInfoSection({
  memberNumber,
  patientName,
  patientDob,
  onChange,
  errors,
}: MemberInfoSectionProps) {
  const memberError = getFieldError(errors, "member_number");
  const nameError = getFieldError(errors, "patient_name");
  const dobError = getFieldError(errors, "patient_dob");

  return (
    <div className="glass-card space-y-4">
      <h3 className="text-lg font-semibold text-text-primary">Member & Patient Information</h3>

      {/* Member Number */}
      <div className="space-y-1.5">
        <Label htmlFor="member_number" className="text-xs font-medium text-text-primary">
          Member Number <span className="text-[var(--status-danger)]">*</span>
        </Label>
        <Input
          id="member_number"
          value={memberNumber}
          onChange={(e) => onChange("member_number", e.target.value)}
          placeholder="Enter member number"
          className={memberError ? "border-[var(--status-danger)]" : ""}
        />
        {memberError && (
          <p className="text-xs text-[var(--status-danger)] flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            {memberError}
          </p>
        )}
      </div>

      {/* Patient Name */}
      <div className="space-y-1.5">
        <Label htmlFor="patient_name" className="text-xs font-medium text-text-primary">
          Patient Name <span className="text-[var(--status-danger)]">*</span>
        </Label>
        <Input
          id="patient_name"
          value={patientName}
          onChange={(e) => onChange("patient_name", e.target.value)}
          placeholder="Enter patient full name"
          className={nameError ? "border-[var(--status-danger)]" : ""}
        />
        {nameError && (
          <p className="text-xs text-[var(--status-danger)] flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            {nameError}
          </p>
        )}
      </div>

      {/* Date of Birth */}
      <div className="space-y-1.5">
        <Label htmlFor="patient_dob" className="text-xs font-medium text-text-primary">
          Date of Birth <span className="text-[var(--status-danger)]">*</span>
        </Label>
        <Input
          id="patient_dob"
          type="date"
          value={patientDob}
          onChange={(e) => onChange("patient_dob", e.target.value)}
          max={new Date().toISOString().split("T")[0]}
          className={dobError ? "border-[var(--status-danger)]" : ""}
        />
        {dobError && (
          <p className="text-xs text-[var(--status-danger)] flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            {dobError}
          </p>
        )}
      </div>
    </div>
  );
}
