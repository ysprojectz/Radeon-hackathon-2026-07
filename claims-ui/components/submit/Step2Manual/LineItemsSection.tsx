"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2, Plus, AlertCircle } from "lucide-react";
import type { ValidationError } from "@/lib/validation/claimValidation";

interface LineItem {
  line_number: number;
  procedure_code: string;
  service_category: string;
  billed_amount: string;
  units?: string;
}

interface LineItemsSectionProps {
  lineItems: LineItem[];
  onChange: (lineItems: LineItem[]) => void;
  errors: ValidationError[];
}

const SERVICE_CATEGORIES = [
  { value: "", label: "Select category..." },
  { value: "CONSULTATION", label: "Consultation" },
  { value: "DIAGNOSTIC", label: "Diagnostic" },
  { value: "LAB", label: "Laboratory" },
  { value: "PHARMACY", label: "Pharmacy" },
  { value: "SURGERY", label: "Surgery" },
  { value: "ROOM_RENT", label: "Room & Board" },
  { value: "ICU", label: "ICU" },
  { value: "IMAGING", label: "Imaging (X-ray/MRI/CT)" },
  { value: "THERAPY", label: "Therapy" },
  { value: "OTHER", label: "Other" },
];

export function LineItemsSection({ lineItems, onChange, errors }: LineItemsSectionProps) {
  function addLineItem() {
    const newItem: LineItem = {
      line_number: lineItems.length + 1,
      procedure_code: "",
      service_category: "",
      billed_amount: "",
      units: "1",
    };
    onChange([...lineItems, newItem]);
  }

  function removeLineItem(index: number) {
    if (lineItems.length > 1) {
      const updated = lineItems.filter((_, i) => i !== index);
      // Renumber line items
      updated.forEach((item, i) => {
        item.line_number = i + 1;
      });
      onChange(updated);
    }
  }

  function updateLineItem(index: number, field: keyof LineItem, value: string) {
    const updated = [...lineItems];
    updated[index] = { ...updated[index], [field]: value };
    onChange(updated);
  }

  // Calculate total billed amount
  const totalBilled = lineItems.reduce((sum, item) => {
    const amount = parseFloat(item.billed_amount) || 0;
    return sum + amount;
  }, 0);

  // Get line item errors
  const getLineItemError = (index: number, field: string) => {
    return errors.find((e) => e.field === `line_items[${index}].${field}`)?.message || null;
  };

  return (
    <div className="glass-card space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-text-primary">Line Items</h3>
          <p className="text-xs text-text-secondary">At least one line item is required</p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addLineItem}
          className="gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Line
        </Button>
      </div>

      {/* Table Header (hidden on mobile) */}
      <div className="hidden md:grid md:grid-cols-12 gap-2 px-3 py-2 bg-muted/30 rounded-md text-xs font-medium text-text-primary">
        <div className="col-span-1">#</div>
        <div className="col-span-3">Procedure Code</div>
        <div className="col-span-3">Category</div>
        <div className="col-span-2">Amount</div>
        <div className="col-span-2">Units</div>
        <div className="col-span-1">Action</div>
      </div>

      {/* Line Items */}
      <div className="space-y-3">
        {lineItems.map((item, index) => {
          const procedureError = getLineItemError(index, "procedure_code");
          const categoryError = getLineItemError(index, "service_category");
          const amountError = getLineItemError(index, "billed_amount");

          return (
            <div
              key={item.line_number}
              className="grid grid-cols-1 md:grid-cols-12 gap-2 p-3 bg-muted/20 rounded-md border border-[var(--border-subtle)]"
            >
              {/* Line Number */}
              <div className="md:col-span-1 flex items-center">
                <span className="text-sm font-semibold text-text-primary md:text-center md:w-full">
                  {item.line_number}
                </span>
              </div>

              {/* Procedure Code */}
              <div className="md:col-span-3 space-y-1">
                <Label className="text-xs md:hidden text-text-primary">Procedure Code</Label>
                <Input
                  value={item.procedure_code}
                  onChange={(e) => updateLineItem(index, "procedure_code", e.target.value)}
                  placeholder="e.g., 99213"
                  className={procedureError ? "border-[var(--status-danger)] h-8" : "h-8"}
                />
                {procedureError && (
                  <p className="text-xs text-[var(--status-danger)] flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {procedureError}
                  </p>
                )}
              </div>

              {/* Service Category */}
              <div className="md:col-span-3 space-y-1">
                <Label className="text-xs md:hidden text-text-primary">Category</Label>
                <select
                  value={item.service_category}
                  onChange={(e) => updateLineItem(index, "service_category", e.target.value)}
                  className={`flex h-8 w-full rounded-md border ${
                    categoryError ? "border-[var(--status-danger)]" : "border-input"
                  } bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring`}
                >
                  {SERVICE_CATEGORIES.map((cat) => (
                    <option key={cat.value} value={cat.value}>
                      {cat.label}
                    </option>
                  ))}
                </select>
                {categoryError && (
                  <p className="text-xs text-[var(--status-danger)] flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {categoryError}
                  </p>
                )}
              </div>

              {/* Billed Amount */}
              <div className="md:col-span-2 space-y-1">
                <Label className="text-xs md:hidden text-text-primary">Amount</Label>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={item.billed_amount}
                  onChange={(e) => updateLineItem(index, "billed_amount", e.target.value)}
                  placeholder="0.00"
                  className={amountError ? "border-[var(--status-danger)] h-8" : "h-8"}
                />
                {amountError && (
                  <p className="text-xs text-[var(--status-danger)] flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" />
                    {amountError}
                  </p>
                )}
              </div>

              {/* Units */}
              <div className="md:col-span-2 space-y-1">
                <Label className="text-xs md:hidden text-text-primary">Units</Label>
                <Input
                  type="number"
                  min="1"
                  value={item.units ?? "1"}
                  onChange={(e) => updateLineItem(index, "units", e.target.value)}
                  className="h-8"
                />
              </div>

              {/* Remove Button */}
              <div className="md:col-span-1 flex items-start md:items-center md:justify-center">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => removeLineItem(index)}
                  disabled={lineItems.length === 1}
                  className="h-8 text-[var(--status-danger)] hover:text-[var(--status-danger)] hover:bg-[var(--status-danger)]/10"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Total */}
      <div className="flex justify-end items-center gap-4 pt-2 border-t border-[var(--border-subtle)]">
        <span className="text-sm font-medium text-text-primary">Total Billed:</span>
        <span className="text-lg font-semibold text-brand-primary">
          {totalBilled.toFixed(2)}
        </span>
      </div>

      {/* General line items error */}
      {errors.some((e) => e.field === "line_items") && (
        <p className="text-xs text-[var(--status-danger)] flex items-center gap-1">
          <AlertCircle className="h-3 w-3" />
          {errors.find((e) => e.field === "line_items")?.message}
        </p>
      )}
    </div>
  );
}
