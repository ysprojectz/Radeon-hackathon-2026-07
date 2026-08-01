import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { SettlementResponse } from "@/lib/types";

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
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
    paddingHorizontal: 4,
  },
  rowAlt: {
    backgroundColor: "#f9fafb",
  },
  label: {
    fontSize: 9,
    color: "#4b5563",
  },
  labelIndent: {
    fontSize: 9,
    color: "#6b7280",
    paddingLeft: 12,
  },
  amount: {
    fontSize: 9,
    color: "#111827",
    fontFamily: "Courier",
  },
  divider: {
    borderBottom: "0.5pt dashed #d1d5db",
    marginVertical: 6,
  },
  planPayRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 5,
    paddingHorizontal: 4,
    backgroundColor: "#f0fdf4",
    borderRadius: 4,
    marginTop: 4,
  },
  planPayLabel: {
    fontSize: 10,
    fontWeight: "bold",
    color: "#15803d",
  },
  planPayAmount: {
    fontSize: 10,
    fontWeight: "bold",
    color: "#15803d",
    fontFamily: "Courier",
  },
  memberRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 5,
    paddingHorizontal: 4,
    backgroundColor: "#fffbeb",
    borderRadius: 4,
    marginTop: 4,
  },
  memberLabel: {
    fontSize: 10,
    fontWeight: "bold",
    color: "#b45309",
  },
  memberAmount: {
    fontSize: 10,
    fontWeight: "bold",
    color: "#b45309",
    fontFamily: "Courier",
  },
});

function fmt(val: string | number | undefined | null, currency: string): string {
  if (val === undefined || val === null) return `${currency} —`;
  const n = typeof val === "string" ? parseFloat(val) : val;
  if (isNaN(n)) return `${currency} —`;
  return `${currency} ${n.toFixed(2)}`;
}

interface Props {
  settlement: SettlementResponse;
}

export function PDFSettlementTable({ settlement: s }: Props) {
  const billed = parseFloat(s.total_billed) || 0;
  const allowed = parseFloat(s.total_allowed) || 0;
  const netAdj = billed - allowed;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>
        Section 1 — Financial Settlement
      </Text>

      <View style={styles.row}>
        <Text style={styles.label}>Total Billed</Text>
        <Text style={styles.amount}>{fmt(s.total_billed, s.currency)}</Text>
      </View>

      {netAdj > 0 && (
        <View style={[styles.row, styles.rowAlt]}>
          <Text style={styles.labelIndent}>Network Adjustment</Text>
          <Text style={styles.amount}>
            − {fmt(netAdj, s.currency)}
          </Text>
        </View>
      )}

      <View style={styles.row}>
        <Text style={styles.label}>Total Allowed</Text>
        <Text style={styles.amount}>{fmt(s.total_allowed, s.currency)}</Text>
      </View>

      {(parseFloat(s.total_deductible) || 0) > 0 && (
        <View style={[styles.row, styles.rowAlt]}>
          <Text style={styles.labelIndent}>Annual Deductible</Text>
          <Text style={styles.amount}>
            − {fmt(s.total_deductible, s.currency)}
          </Text>
        </View>
      )}

      {(parseFloat(s.total_copay) || 0) > 0 && (
        <View style={styles.row}>
          <Text style={styles.labelIndent}>
            Copay
          </Text>
          <Text style={styles.amount}>
            − {fmt(s.total_copay, s.currency)}
          </Text>
        </View>
      )}

      {(parseFloat(s.total_coinsurance_member) || 0) > 0 && (
        <View style={[styles.row, styles.rowAlt]}>
          <Text style={styles.labelIndent}>Coinsurance (member)</Text>
          <Text style={styles.amount}>
            − {fmt(s.total_coinsurance_member, s.currency)}
          </Text>
        </View>
      )}

      <View style={styles.divider} />

      <View style={styles.planPayRow}>
        <Text style={styles.planPayLabel}>PLAN PAYMENT</Text>
        <Text style={styles.planPayAmount}>
          {fmt(s.total_plan_payment, s.currency)}
        </Text>
      </View>

      <View style={styles.memberRow}>
        <Text style={styles.memberLabel}>MEMBER RESPONSIBILITY</Text>
        <Text style={styles.memberAmount}>
          {fmt(s.total_member_responsibility, s.currency)}
        </Text>
      </View>
    </View>
  );
}
