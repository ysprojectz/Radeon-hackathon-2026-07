import type { ClaimResponse } from "../types";

/**
 * CSV Export Utility
 *
 * Converts ClaimResponse[] to CSV string format with proper escaping
 * and date/currency formatting.
 */

/**
 * Escapes a value for CSV format.
 * - Wraps in quotes if contains comma, newline, or quote
 * - Doubles internal quotes
 * - Handles null/undefined as empty string
 */
function escapeCsvValue(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  const stringValue = String(value);

  // Check if value needs quoting (contains comma, newline, or quote)
  if (stringValue.includes(",") || stringValue.includes("\n") || stringValue.includes('"')) {
    // Double internal quotes and wrap in quotes
    return `"${stringValue.replace(/"/g, '""')}"`;
  }

  return stringValue;
}

/**
 * Formats a date string (ISO 8601) to readable format: YYYY-MM-DD
 */
function formatDate(isoDate: string | undefined): string {
  if (!isoDate) return "";

  try {
    const date = new Date(isoDate);
    return date.toISOString().split("T")[0]; // YYYY-MM-DD
  } catch {
    return isoDate; // Return as-is if parsing fails
  }
}

/**
 * Formats a currency value (string from backend) to 2 decimal places
 */
function formatCurrency(value: string | undefined): string {
  if (!value) return "0.00";

  try {
    const num = parseFloat(value);
    return num.toFixed(2);
  } catch {
    return value; // Return as-is if parsing fails
  }
}

/**
 * Converts an array of claims to CSV string
 *
 * @param claims - Array of ClaimResponse objects
 * @returns CSV string with headers and data rows
 */
export function convertClaimsToCSV(claims: ClaimResponse[]): string {
  // CSV header row
  const headers = [
    "Reference",
    "Patient Name",
    "Member Number",
    "Claim Type",
    "Status",
    "Market Region",
    "Provider",
    "Network Tier",
    "Service Date",
    "Received Date",
    "Total Billed",
    "Total Allowed",
    "Total Settlement",
    "Member Responsibility",
    "Confidence Score",
    "Processing Time (ms)",
    "Pre-Auth Number"
  ];

  // Build CSV rows
  const rows = claims.map((claim) => [
    escapeCsvValue(claim.claim_reference),
    escapeCsvValue(claim.patient_name),
    escapeCsvValue(claim.member_number),
    escapeCsvValue(claim.claim_type),
    escapeCsvValue(claim.status),
    escapeCsvValue(claim.market_region),
    escapeCsvValue(claim.provider_name),
    escapeCsvValue(claim.network_tier),
    escapeCsvValue(formatDate(claim.service_date)),
    escapeCsvValue(formatDate(claim.date_received)),
    escapeCsvValue(`${claim.currency} ${formatCurrency(claim.total_billed)}`),
    escapeCsvValue(claim.total_allowed ? `${claim.currency} ${formatCurrency(claim.total_allowed)}` : ""),
    escapeCsvValue(claim.total_settlement ? `${claim.currency} ${formatCurrency(claim.total_settlement)}` : ""),
    escapeCsvValue(claim.total_member_responsibility ? `${claim.currency} ${formatCurrency(claim.total_member_responsibility)}` : ""),
    escapeCsvValue(claim.confidence_score ? parseFloat(claim.confidence_score).toFixed(2) : ""),
    escapeCsvValue(claim.processing_time_ms?.toString() || ""),
    escapeCsvValue(claim.preauth_number || "")
  ]);

  // Combine headers and rows
  return [headers.join(","), ...rows.map(row => row.join(","))].join("\n");
}

/**
 * Triggers browser download of CSV file
 *
 * @param csvContent - CSV string content
 * @param filename - Name of file to download (default: claims_export_YYYY-MM-DD.csv)
 */
export function downloadCSV(csvContent: string, filename?: string): void {
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  const finalFilename = filename || `claims_export_${today}.csv`;

  // Create Blob with UTF-8 BOM for Excel compatibility
  const BOM = "\uFEFF";
  const blob = new Blob([BOM + csvContent], { type: "text/csv;charset=utf-8;" });

  // Create temporary download link
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = finalFilename;
  link.style.display = "none";

  // Trigger download
  document.body.appendChild(link);
  link.click();

  // Cleanup
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Main export function - converts claims and triggers download
 *
 * @param claims - Array of ClaimResponse objects
 * @param filename - Optional custom filename
 * @returns Promise resolving to number of claims exported
 */
export async function exportClaimsToCSV(
  claims: ClaimResponse[],
  filename?: string
): Promise<number> {
  if (!claims || claims.length === 0) {
    throw new Error("No claims to export");
  }

  // Convert to CSV
  const csvContent = convertClaimsToCSV(claims);

  // Trigger download
  downloadCSV(csvContent, filename);

  return claims.length;
}
