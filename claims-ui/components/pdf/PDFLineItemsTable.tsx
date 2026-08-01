import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { ClaimLineItemResponse } from "@/lib/types";

const COL_WIDTHS = {
  num: "5%",
  code: "12%",
  cat: "18%",
  billed: "15%",
  allowed: "15%",
  copay: "13%",
  paid: "15%",
  status: "7%",
};

const styles = StyleSheet.create({
  section: {
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 10,
    fontWeight: "bold",
    marginBottom: 8,
    paddingBottom: 4,
    borderBottom: "1pt solid #e5e7eb",
    color: "#1f2937",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  headerRow: {
    flexDirection: "row",
    backgroundColor: "#f3f4f6",
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderRadius: 2,
  },
  headerCell: {
    fontSize: 7,
    fontWeight: "bold",
    color: "#374151",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  bodyRow: {
    flexDirection: "row",
    paddingVertical: 4,
    paddingHorizontal: 4,
    borderBottom: "0.5pt solid #f3f4f6",
  },
  cell: {
    fontSize: 8,
    color: "#374151",
  },
  codeCell: {
    fontSize: 8,
    fontFamily: "Courier",
    color: "#374151",
  },
  numCell: {
    fontSize: 8,
    color: "#9ca3af",
    textAlign: "center",
  },
  amountCell: {
    fontSize: 8,
    color: "#374151",
    textAlign: "right",
    fontFamily: "Courier",
  },
  statusCell: {
    fontSize: 8,
    textAlign: "center",
  },
});

function fmt(val: string | undefined | null, currency?: string): string {
  if (!val) return "—";
  const n = parseFloat(val);
  if (isNaN(n)) return "—";
  const amount = n.toFixed(2);
  return currency ? `${currency} ${amount}` : amount;
}

interface Props {
  lineItems: ClaimLineItemResponse[];
  currency: string;
}

export function PDFLineItemsTable({ lineItems, currency }: Props) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>
        Section 2 — Line Items ({currency})
      </Text>

      {/* Header */}
      <View style={styles.headerRow}>
        <Text style={[styles.headerCell, { width: COL_WIDTHS.num }]}>#</Text>
        <Text style={[styles.headerCell, { width: COL_WIDTHS.code }]}>Code</Text>
        <Text style={[styles.headerCell, { width: COL_WIDTHS.cat }]}>Category</Text>
        <Text style={[styles.headerCell, { width: COL_WIDTHS.billed, textAlign: "right" }]}>
          Billed
        </Text>
        <Text style={[styles.headerCell, { width: COL_WIDTHS.allowed, textAlign: "right" }]}>
          Allowed
        </Text>
        <Text style={[styles.headerCell, { width: COL_WIDTHS.copay, textAlign: "right" }]}>
          Copay
        </Text>
        <Text style={[styles.headerCell, { width: COL_WIDTHS.paid, textAlign: "right" }]}>
          Plan Paid
        </Text>
        <Text style={[styles.headerCell, { width: COL_WIDTHS.status, textAlign: "center" }]}>
          ✓
        </Text>
      </View>

      {/* Rows */}
      {lineItems.map((item, i) => (
        <View
          key={item.line_number}
          style={[
            styles.bodyRow,
            i % 2 === 1 ? { backgroundColor: "#f9fafb" } : {},
          ]}
        >
          <Text style={[styles.numCell, { width: COL_WIDTHS.num }]}>
            {item.line_number}
          </Text>
          <Text style={[styles.codeCell, { width: COL_WIDTHS.code }]}>
            {item.procedure_code}
          </Text>
          <Text style={[styles.cell, { width: COL_WIDTHS.cat }]}>
            {item.service_category}
          </Text>
          <Text style={[styles.amountCell, { width: COL_WIDTHS.billed }]}>
            {fmt(item.billed_amount, currency)}
          </Text>
          <Text style={[styles.amountCell, { width: COL_WIDTHS.allowed }]}>
            {fmt(item.allowed_amount, currency)}
          </Text>
          <Text style={[styles.amountCell, { width: COL_WIDTHS.copay }]}>
            {fmt(item.copay_amount, currency)}
          </Text>
          <Text
            style={[
              styles.amountCell,
              { width: COL_WIDTHS.paid, fontWeight: "bold" },
            ]}
          >
            {fmt(item.plan_paid, currency)}
          </Text>
          <Text style={[styles.statusCell, { width: COL_WIDTHS.status }]}>
            {item.is_covered === false ? "✗" : "✓"}
          </Text>
        </View>
      ))}
    </View>
  );
}
