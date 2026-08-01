export type AnalyticsCardDesign = "command" | "flow" | "ledger";

export const ANALYTICS_CARD_DESIGNS: Array<{
  key: AnalyticsCardDesign;
  label: string;
  description: string;
}> = [
  {
    key: "command",
    label: "Command Split",
    description: "Large signal area with compact operational rows.",
  },
  {
    key: "flow",
    label: "Flow Board",
    description: "Ranked bars and decision throughput focus.",
  },
  {
    key: "ledger",
    label: "Executive Ledger",
    description: "Dense, readable summary tiles for quick scanning.",
  },
];

export function normalizeAnalyticsCardDesign(value: string | null): AnalyticsCardDesign {
  return value === "flow" || value === "ledger" ? value : "command";
}
