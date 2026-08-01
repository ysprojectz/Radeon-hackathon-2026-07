/**
 * Client-side validation rules for manual claim entry
 */

export interface ValidationError {
  field: string;
  message: string;
}

export interface ManualFormState {
  // Header
  claim_type: string;
  market_region: string;
  currency: string;

  // Member/Patient
  member_number: string;
  patient_name: string;
  patient_dob: string;

  // Provider
  provider_code: string;
  provider_name: string;
  network_tier?: string;

  // Clinical
  service_date: string;
  admission_date?: string;
  discharge_date?: string;
  primary_diagnosis_code: string;
  primary_diagnosis_desc?: string;

  // Payout account
  bank_account_holder?: string;
  account_type?: string;
  bank_name?: string;
  iban?: string;
  swift_bic?: string;
  account_number?: string;
  ifsc_code?: string;
  upi_vpa?: string;
  upi_provider?: string;

  // Line Items
  line_items: Array<{
    line_number: number;
    procedure_code: string;
    service_category: string;
    billed_amount: string;
    units?: string;
  }>;
}

/**
 * Validate date is not in the future
 */
function isValidDate(dateStr: string): boolean {
  if (!dateStr) return false;
  const date = new Date(dateStr);
  return !isNaN(date.getTime()) && date <= new Date();
}

/**
 * Validate amount is a positive number
 */
function isValidAmount(amountStr: string): boolean {
  if (!amountStr) return false;
  const amount = parseFloat(amountStr);
  return !isNaN(amount) && amount > 0;
}

/**
 * Validate the entire manual claim form
 */
export function validateClaimForm(data: ManualFormState): ValidationError[] {
  const errors: ValidationError[] = [];

  // Required fields
  if (!data.member_number?.trim()) {
    errors.push({ field: "member_number", message: "Member number is required" });
  }

  if (!data.patient_name?.trim()) {
    errors.push({ field: "patient_name", message: "Patient name is required" });
  }

  if (!data.patient_dob) {
    errors.push({ field: "patient_dob", message: "Date of birth is required" });
  } else if (!isValidDate(data.patient_dob)) {
    errors.push({ field: "patient_dob", message: "Date of birth cannot be in the future" });
  }

  if (!data.service_date) {
    errors.push({ field: "service_date", message: "Service date is required" });
  } else if (!isValidDate(data.service_date)) {
    errors.push({ field: "service_date", message: "Service date cannot be in the future" });
  }

  if (!data.provider_code?.trim()) {
    errors.push({ field: "provider_code", message: "Provider code is required" });
  }

  if (!data.provider_name?.trim()) {
    errors.push({ field: "provider_name", message: "Provider name is required" });
  }

  if (!data.primary_diagnosis_code?.trim()) {
    errors.push({ field: "primary_diagnosis_code", message: "Primary diagnosis code is required" });
  }

  // Conditional validation for INPATIENT claims
  if (data.claim_type === "INPATIENT") {
    if (data.admission_date && !isValidDate(data.admission_date)) {
      errors.push({ field: "admission_date", message: "Admission date cannot be in the future" });
    }

    if (data.discharge_date && !isValidDate(data.discharge_date)) {
      errors.push({ field: "discharge_date", message: "Discharge date cannot be in the future" });
    }

    // Discharge must be after admission
    if (data.admission_date && data.discharge_date) {
      const admission = new Date(data.admission_date);
      const discharge = new Date(data.discharge_date);
      if (discharge < admission) {
        errors.push({ field: "discharge_date", message: "Discharge date must be after admission date" });
      }
    }
  }

  // Line items validation
  if (!data.line_items || data.line_items.length === 0) {
    errors.push({ field: "line_items", message: "At least one line item is required" });
  } else {
    data.line_items.forEach((item, index) => {
      if (!item.procedure_code?.trim()) {
        errors.push({
          field: `line_items[${index}].procedure_code`,
          message: `Line ${index + 1}: Procedure code is required`,
        });
      }

      if (!item.service_category?.trim()) {
        errors.push({
          field: `line_items[${index}].service_category`,
          message: `Line ${index + 1}: Service category is required`,
        });
      }

      if (!isValidAmount(item.billed_amount)) {
        errors.push({
          field: `line_items[${index}].billed_amount`,
          message: `Line ${index + 1}: Billed amount must be greater than 0`,
        });
      }
    });
  }

  return errors;
}

/**
 * Get validation error for a specific field
 */
export function getFieldError(errors: ValidationError[], field: string): string | null {
  const error = errors.find((e) => e.field === field);
  return error ? error.message : null;
}
