import { View, Text, StyleSheet } from "@react-pdf/renderer";
import type { AuditTrailResponse } from "@/lib/types";

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
  validRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  validBadge: {
    fontSize: 8,
    backgroundColor: "#dcfce7",
    color: "#15803d",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  invalidBadge: {
    fontSize: 8,
    backgroundColor: "#fee2e2",
    color: "#dc2626",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  entryRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 8,
    paddingBottom: 8,
    borderBottom: "0.5pt solid #f3f4f6",
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#6366f1",
    marginTop: 2,
    flexShrink: 0,
  },
  entryContent: {
    flex: 1,
  },
  entryHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  eventType: {
    fontSize: 8,
    fontWeight: "bold",
    color: "#374151",
    textTransform: "uppercase",
  },
  timestamp: {
    fontSize: 7,
    color: "#9ca3af",
  },
  actor: {
    fontSize: 7,
    color: "#6b7280",
    marginBottom: 1,
  },
  description: {
    fontSize: 8,
    color: "#4b5563",
    marginBottom: 2,
  },
  hash: {
    fontSize: 6,
    color: "#9ca3af",
    fontFamily: "Courier",
  },
});

interface Props {
  audit: AuditTrailResponse;
}

function formatTs(ts: string): string {
  try {
    return new Date(ts).toISOString().replace("T", " ").slice(0, 19);
  } catch {
    return ts;
  }
}

function truncateHash(hash: string): string {
  if (!hash) return "";
  return `${hash.slice(0, 8)}…${hash.slice(-8)}`;
}

export function PDFAuditTrail({ audit }: Props) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>
        Section 3 — Audit Trail
      </Text>

      <View style={styles.validRow}>
        <Text style={audit.chain_valid ? styles.validBadge : styles.invalidBadge}>
          {audit.chain_valid ? "✓ Chain Valid" : "✗ Chain Invalid"}
          {" · "}
          {audit.total_entries} events
        </Text>
      </View>

      {(audit.entries ?? []).map((entry, i) => (
        <View key={i} style={styles.entryRow}>
          <View style={styles.dot} />
          <View style={styles.entryContent}>
            <View style={styles.entryHeader}>
              <Text style={styles.eventType}>
                {entry.event_type.replace(/_/g, " ")}
              </Text>
              <Text style={styles.timestamp}>{formatTs(entry.timestamp)}</Text>
            </View>
            <Text style={styles.actor}>
              {entry.actor_type}{entry.actor_id ? ` (${entry.actor_id})` : ""}
            </Text>
            <Text style={styles.description}>{entry.description}</Text>
            <Text style={styles.hash}>
              Hash: {truncateHash(entry.entry_hash)}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}
