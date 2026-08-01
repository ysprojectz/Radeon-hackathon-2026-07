import {
  Document,
  Page,
  View,
  Text,
  StyleSheet,
} from "@react-pdf/renderer";
import { PDFSettlementTable } from "./PDFSettlementTable";
import { PDFLineItemsTable } from "./PDFLineItemsTable";
import { PDFAuditTrail } from "./PDFAuditTrail";
import { PRODUCT_FULL_NAME, PRODUCT_SHORT_NAME } from "@/lib/constants";
import type { ClaimResponse, SettlementResponse, AuditTrailResponse } from "@/lib/types";

const styles = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    fontSize: 9,
    paddingTop: 32,
    paddingBottom: 40,
    paddingHorizontal: 36,
    color: "#111827",
    backgroundColor: "#ffffff",
  },
  // ── Header ────────────────────────────────────────────────────
  header: {
    marginBottom: 20,
  },
  headerTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
    paddingBottom: 10,
    borderBottom: "1.5pt solid #3b82f6",
  },
  brandBlock: {
    flexDirection: "column",
  },
  brandTitle: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#1e40af",
    letterSpacing: 0.5,
  },
  brandSub: {
    fontSize: 8,
    color: "#6b7280",
    marginTop: 2,
  },
  reportDate: {
    fontSize: 8,
    color: "#6b7280",
    textAlign: "right",
  },
  // ── Claim Meta grid ──────────────────────────────────────────
  metaGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 0,
    backgroundColor: "#f8fafc",
    borderRadius: 4,
    padding: 10,
    marginBottom: 16,
  },
  metaItem: {
    width: "50%",
    paddingVertical: 3,
  },
  metaLabel: {
    fontSize: 7,
    color: "#9ca3af",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  metaValue: {
    fontSize: 9,
    color: "#111827",
    fontWeight: "bold",
    marginTop: 1,
  },
  // ── Status badge ─────────────────────────────────────────────
  statusBadge: {
    fontSize: 8,
    fontWeight: "bold",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    backgroundColor: "#dcfce7",
    color: "#15803d",
  },
  // ── Footer ────────────────────────────────────────────────────
  footer: {
    position: "absolute",
    bottom: 16,
    left: 36,
    right: 36,
    flexDirection: "row",
    justifyContent: "space-between",
    borderTop: "0.5pt solid #e5e7eb",
    paddingTop: 8,
  },
  footerText: {
    fontSize: 7,
    color: "#9ca3af",
  },
});

interface Props {
  claim: ClaimResponse;
  settlement: SettlementResponse;
  audit: AuditTrailResponse;
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function nowStr(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19) + "Z";
}

function fmtPercent(score: string | number | null | undefined): string {
  if (score == null) return "—";
  let pct = typeof score === "string" ? parseFloat(score) : score;
  if (!Number.isFinite(pct)) return "—";
  if (pct <= 1) pct *= 100;
  return `${pct.toFixed(1)}%`;
}

function fmtDate(d: string): string {
  try {
    return new Date(d).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return d;
  }
}

export function FinancePDFDocument({ claim, settlement, audit }: Props) {
  const confPct = fmtPercent(claim.confidence_score);

  return (
    <Document
      title={`${PRODUCT_SHORT_NAME} Adjudication Report — ${claim.claim_reference}`}
      author={`${PRODUCT_SHORT_NAME} v1.0.0`}
      subject={PRODUCT_FULL_NAME}
    >
      <Page size="A4" style={styles.page}>
        {/* ── Header ── */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <View style={styles.brandBlock}>
              <Text style={styles.brandTitle}>{PRODUCT_SHORT_NAME} ADJUDICATION REPORT</Text>
              <Text style={styles.brandSub}>
                {PRODUCT_FULL_NAME}
              </Text>
            </View>
            <Text style={styles.reportDate}>
              Generated: {todayStr()}
            </Text>
          </View>

          {/* Meta grid */}
          <View style={styles.metaGrid}>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Claim Reference</Text>
              <Text style={styles.metaValue}>{claim.claim_reference}</Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Status</Text>
              <Text style={[styles.metaValue, { color: "#15803d" }]}>
                {claim.status}
              </Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Patient</Text>
              <Text style={styles.metaValue}>{claim.patient_name}</Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Confidence</Text>
              <Text style={styles.metaValue}>{confPct}</Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Provider</Text>
              <Text style={styles.metaValue}>{claim.provider_name}</Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Market</Text>
              <Text style={styles.metaValue}>{claim.market_region}</Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Service Date</Text>
              <Text style={styles.metaValue}>{fmtDate(claim.service_date)}</Text>
            </View>
            <View style={styles.metaItem}>
              <Text style={styles.metaLabel}>Diagnosis</Text>
              <Text style={styles.metaValue}>
                {claim.primary_diagnosis_code}{" "}
                {claim.primary_diagnosis_desc
                  ? `— ${claim.primary_diagnosis_desc.slice(0, 40)}`
                  : ""}
              </Text>
            </View>
            {claim.processing_time_ms && (
              <View style={styles.metaItem}>
                <Text style={styles.metaLabel}>Processing Time</Text>
                <Text style={styles.metaValue}>
                  {claim.processing_time_ms.toLocaleString()} ms
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* ── Settlement ── */}
        <PDFSettlementTable settlement={settlement} />

        {/* ── Line Items ── */}
        {(claim.line_items ?? []).length > 0 && (
          <PDFLineItemsTable
            lineItems={claim.line_items}
            currency={claim.currency}
          />
        )}

        {/* ── Audit Trail ── */}
        {audit && <PDFAuditTrail audit={audit} />}

        {/* ── Footer ── */}
        <View style={styles.footer} fixed>
          <Text style={styles.footerText}>
            Generated: {nowStr()} · Engine v1.0.0
          </Text>
          <Text
            style={styles.footerText}
            render={({ pageNumber, totalPages }) =>
              `Page ${pageNumber} of ${totalPages}`
            }
          />
        </View>
      </Page>
    </Document>
  );
}
