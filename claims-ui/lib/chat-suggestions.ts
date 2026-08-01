export type AssistantSuggestionKind =
  | "claims"
  | "kpi"
  | "report"
  | "export"
  | "error"
  | "text";

interface FollowUpSuggestionInput {
  content: string;
  prompt?: string;
  pathname?: string | null;
  kind?: AssistantSuggestionKind;
  previous?: string[];
}

const INTENT_SUGGESTIONS: Array<{
  intent: string;
  pattern: RegExp;
  suggestions: string[];
}> = [
  {
    intent: "denial",
    pattern: /\b(denial|denied|reject|rejected|exclusion|not covered|appeal)\b/i,
    suggestions: ["Why was this denied?", "Show denial breakdown", "Appeal options", "Download denial report"],
  },
  {
    intent: "settlement",
    pattern: /\b(settled|settlement|approved|payable|covered|paid|member responsibility)\b/i,
    suggestions: ["View settlement details", "Compare similar claims", "Generate settlement report", "Download report"],
  },
  {
    intent: "account",
    pattern: /\b(account|bank|iban|ifsc|upi|payout|payment gateway|gateway sync|sync)\b/i,
    suggestions: ["Open accounts page", "Show unverified accounts", "Check gateway sync", "Review payout blockers"],
  },
  {
    intent: "queue",
    pattern: /\b(pending|queue|review|hitl|manual|sla|breach|priority|prioritize)\b/i,
    suggestions: ["Show pending claims", "Due-time risk", "Prioritize queue", "What needs action now?"],
  },
  {
    intent: "policy",
    pattern: /\b(policy|clause|coverage|benefit|eligible|copay|deductible)\b/i,
    suggestions: ["Show full policy", "Check exclusions list", "Compare policies", "Open policy library"],
  },
  {
    intent: "kpi",
    pattern: /\b(kpi|metric|rate|auto.?adjudic|performance|trend|dashboard)\b/i,
    suggestions: ["Show 30-day trend", "Drill into denials", "Automation breakdown", "Generate metrics report"],
  },
  {
    intent: "report",
    pattern: /\b(report|export|csv|summary|download)\b/i,
    suggestions: ["Download this report", "Schedule daily report", "Compare to last period", "Open reports"],
  },
  {
    intent: "risk",
    pattern: /\b(anomal|fraud|duplicate|suspicious|risk|flagged)\b/i,
    suggestions: ["Show flagged claims", "Run fraud scan", "Export suspicious claims", "Notify compliance"],
  },
  {
    intent: "system",
    pattern: /\b(system|health|api|service|uptime|down|gateway|integration)\b/i,
    suggestions: ["Check service health", "Show failed services", "Review integration logs", "Open system settings"],
  },
];

function unique(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function routeFallback(pathname?: string | null): string[] {
  if (pathname === "/") return ["Top 3 action items", "Claims needing review", "Service health check", "Due-time status"];
  if (pathname?.startsWith("/accounts")) return ["Show unverified accounts", "Check gateway sync", "Review payout blockers", "Open recent claims"];
  if (pathname?.startsWith("/claims")) return ["Filter by status", "High-risk claims", "Claims due today", "Export filtered list"];
  if (pathname?.startsWith("/hitl")) return ["Pending decisions", "Policy guidance", "Escalate a claim", "Due-time risk"];
  if (pathname?.startsWith("/admin")) return ["System status", "Review audit logs", "Open reports", "Check configuration"];
  return ["Related insights", "Run a report", "System status", "Show open claims"];
}

function kindFallback(kind?: AssistantSuggestionKind): string[] {
  if (kind === "claims") return ["Open claims list", "Filter by status", "Export to CSV", "Show high-risk claims"];
  if (kind === "kpi") return ["Drill into denials", "Automation breakdown", "Generate metrics report", "Show 30-day trend"];
  if (kind === "report" || kind === "export") return ["Generate another report", "View pipeline report", "Open reports page", "Compare to last period"];
  if (kind === "error") return ["Try again", "Show claims list", "Service health check", "Narrow the question"];
  return [];
}

export function buildFollowUpSuggestions({
  content,
  prompt = "",
  pathname,
  kind,
  previous = [],
}: FollowUpSuggestionInput): string[] {
  const text = `${prompt}\n${content}`;
  const ranked: string[] = [];

  for (const intent of INTENT_SUGGESTIONS) {
    if (intent.pattern.test(text)) ranked.push(...intent.suggestions);
  }

  ranked.push(...kindFallback(kind), ...routeFallback(pathname));

  const previousSet = new Set(previous.map((item) => item.toLowerCase()));
  const deduped = unique(ranked).filter((item) => !previousSet.has(item.toLowerCase()));
  const fallback = unique(ranked);
  const refill = fallback.filter((item) => !deduped.some((candidate) => candidate.toLowerCase() === item.toLowerCase()));
  const selected = (deduped.length ? unique([...deduped, ...refill]) : fallback).slice(0, 4);

  return unique([...selected, "✏ Write my own"]);
}
