import { convertClaimsToCSV } from "../csv-export";
import type { ClaimResponse } from "../../types";

describe("CSV Export Utility", () => {
  const mockClaim: ClaimResponse = {
    id: "1",
    claim_reference: "CLM-2026-001",
    status: "SETTLED",
    claim_type: "IPD",
    market_region: "INDIA",
    currency: "INR",
    member_number: "MEM12345",
    patient_name: "John Doe",
    provider_name: "Apollo Hospital",
    provider_code: "PROV001",
    network_tier: "IN_NETWORK",
    service_date: "2026-03-01T00:00:00Z",
    primary_diagnosis_code: "J18.9",
    total_billed: "15000.50",
    total_allowed: "12000.00",
    total_settlement: "10800.00",
    total_member_responsibility: "1200.00",
    confidence_score: "0.95",
    processing_time_ms: 1234,
    preauth_number: "PA-2026-001",
    line_items: [],
    date_received: "2026-03-02T10:30:00Z",
  };

  test("converts single claim to CSV", () => {
    const csv = convertClaimsToCSV([mockClaim]);
    const lines = csv.split("\n");

    // Check header
    expect(lines[0]).toContain("Reference");
    expect(lines[0]).toContain("Patient Name");
    expect(lines[0]).toContain("Status");

    // Check data row
    expect(lines[1]).toContain("CLM-2026-001");
    expect(lines[1]).toContain("John Doe");
    expect(lines[1]).toContain("SETTLED");
  });

  test("escapes commas in patient name", () => {
    const claimWithComma = {
      ...mockClaim,
      patient_name: "Doe, John Jr.",
    };

    const csv = convertClaimsToCSV([claimWithComma]);
    const lines = csv.split("\n");

    // Should be quoted
    expect(lines[1]).toContain('"Doe, John Jr."');
  });

  test("escapes quotes in provider name", () => {
    const claimWithQuote = {
      ...mockClaim,
      provider_name: 'St. Mary\'s "Premier" Hospital',
    };

    const csv = convertClaimsToCSV([claimWithQuote]);
    const lines = csv.split("\n");

    // Quotes should be doubled and wrapped
    expect(lines[1]).toContain('""Premier""');
  });

  test("handles missing optional fields", () => {
    const minimalClaim: ClaimResponse = {
      ...mockClaim,
      total_allowed: undefined,
      total_settlement: undefined,
      preauth_number: undefined,
      confidence_score: undefined,
    };

    const csv = convertClaimsToCSV([minimalClaim]);
    const lines = csv.split("\n");

    // Should not throw, should have empty values
    expect(lines.length).toBe(2); // header + 1 row
  });

  test("formats currency with 2 decimals", () => {
    const csv = convertClaimsToCSV([mockClaim]);
    const lines = csv.split("\n");

    expect(lines[1]).toContain("INR 15000.50");
    expect(lines[1]).toContain("INR 12000.00");
  });

  test("formats dates to YYYY-MM-DD", () => {
    const csv = convertClaimsToCSV([mockClaim]);
    const lines = csv.split("\n");

    expect(lines[1]).toContain("2026-03-01");
    expect(lines[1]).toContain("2026-03-02");
  });

  test("handles multiple claims", () => {
    const claims = [
      mockClaim,
      { ...mockClaim, id: "2", claim_reference: "CLM-2026-002" },
      { ...mockClaim, id: "3", claim_reference: "CLM-2026-003" },
    ];

    const csv = convertClaimsToCSV(claims);
    const lines = csv.split("\n");

    expect(lines.length).toBe(4); // header + 3 rows
    expect(lines[1]).toContain("CLM-2026-001");
    expect(lines[2]).toContain("CLM-2026-002");
    expect(lines[3]).toContain("CLM-2026-003");
  });

  test("handles empty array", () => {
    const csv = convertClaimsToCSV([]);
    const lines = csv.split("\n");

    // Only header
    expect(lines.length).toBe(1);
    expect(lines[0]).toContain("Reference");
  });

  test("handles newlines in fields", () => {
    const claimWithNewline = {
      ...mockClaim,
      patient_name: "John\nDoe",
    };

    const csv = convertClaimsToCSV([claimWithNewline]);

    // Should be quoted (field contains newline)
    expect(csv).toContain('"John\nDoe"');
  });
});
