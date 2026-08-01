"use client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle } from "lucide-react";
import type { ValidationError } from "@/lib/validation/claimValidation";
import { getFieldError } from "@/lib/validation/claimValidation";

interface ProviderInfoSectionProps {
  providerCode: string;
  providerName: string;
  networkTier?: string;
  onChange: (field: string, value: string) => void;
  errors: ValidationError[];
}

export function ProviderInfoSection({
  providerCode,
  providerName,
  networkTier,
  onChange,
  errors,
}: ProviderInfoSectionProps) {
  const codeError = getFieldError(errors, "provider_code");
  const nameError = getFieldError(errors, "provider_name");

  return (
    <div className="glass-card space-y-4">
      <h3 className="text-lg font-semibold text-text-primary">Provider Information</h3>

      {/* Provider Code */}
      <div className="space-y-1.5">
        <Label htmlFor="provider_code" className="text-xs font-medium text-text-primary">
          Provider Code <span className="text-[var(--status-danger)]">*</span>
        </Label>
        <Input
          id="provider_code"
          value={providerCode}
          onChange={(e) => onChange("provider_code", e.target.value)}
          placeholder="Enter provider code"
          className={codeError ? "border-[var(--status-danger)]" : ""}
        />
        {codeError && (
          <p className="text-xs text-[var(--status-danger)] flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            {codeError}
          </p>
        )}
      </div>

      {/* Provider Name */}
      <div className="space-y-1.5">
        <Label htmlFor="provider_name" className="text-xs font-medium text-text-primary">
          Provider Name <span className="text-[var(--status-danger)]">*</span>
        </Label>
        <Input
          id="provider_name"
          value={providerName}
          onChange={(e) => onChange("provider_name", e.target.value)}
          placeholder="Enter provider/hospital name"
          className={nameError ? "border-[var(--status-danger)]" : ""}
        />
        {nameError && (
          <p className="text-xs text-[var(--status-danger)] flex items-center gap-1">
            <AlertCircle className="h-3 w-3" />
            {nameError}
          </p>
        )}
      </div>

      {/* Network Tier (Optional) */}
      <div className="space-y-1.5">
        <Label htmlFor="network_tier" className="text-xs font-medium text-text-primary">
          Network Tier (Optional)
        </Label>
        <select
          id="network_tier"
          value={networkTier ?? ""}
          onChange={(e) => onChange("network_tier", e.target.value)}
          className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="">Select network tier...</option>
          <option value="IN_NETWORK">In Network</option>
          <option value="OUT_OF_NETWORK">Out of Network</option>
          <option value="DIRECT_BILLING">Direct Billing</option>
        </select>
      </div>
    </div>
  );
}
