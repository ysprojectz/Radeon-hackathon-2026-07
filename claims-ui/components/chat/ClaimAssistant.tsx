"use client";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useRouter, usePathname } from "next/navigation";
import { X, Send, Loader2, Bot, User, Minimize2, Maximize2, FileText, BarChart3, Minus, CalendarDays, BellRing, RotateCcw, Search, ShieldAlert, TrendingDown, Copy, CheckCheck, ChevronRight, Zap, Clock, Layers, AlertTriangle, Sparkles } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { PRODUCT_ASSISTANT_NAME } from "@/lib/constants";
import { useClaims } from "@/lib/hooks/useClaims";
import { useDashboardKPIs } from "@/lib/hooks/useDashboardKPIs";
import type { ClaimResponse } from "@/lib/types";
import { buildFollowUpSuggestions, type AssistantSuggestionKind } from "@/lib/chat-suggestions";
import { BotAvatarCanvas, MODE_SEQUENCE, type AvatarMode } from "@/components/chat/BotAvatarCanvas";
import { getChatAssistantVariant, type ChatAssistantVariantKey } from "@/components/chat/chatboard-presets";
import { useProactiveIntelligence } from "@/lib/hooks/useProactiveIntelligence";
import { useHITLQueue } from "@/lib/hooks/useHITLQueue";

const ASSISTANT_POSITION_KEY = "claims-assistant-position";
const ASSISTANT_CHAT_HISTORY_KEY = "claims-assistant-chat-history";
const ASSISTANT_SIDE_OFFSET = 24;
const ASSISTANT_EDGE_MARGIN = 16;
const ASSISTANT_BUTTON_SIZE = 100;
const ASSISTANT_COMPACT_HEIGHT = 520;
const ASSISTANT_EXPANDED_HEIGHT = 720;
const ASSISTANT_COMPACT_WIDTH = 420;
const ASSISTANT_EXPANDED_WIDTH = 720;
const ASSISTANT_PANEL_GAP = 8;
const CHAT_REQUEST_TIMEOUT_MS = 45_000;
const MAX_CHAT_HISTORY_MESSAGES = 8;
const FRIENDLY_SCOPE_GUIDANCE =
  "• I can help with claims, metrics, review queues, policies, exports, settings, integrations, and service health.\n• Ask with a claim reference, queue blocker, metric trend, payment issue, or admin setting.\n• I will keep the answer short and action-oriented.";

const REPORT_TYPE_OPTIONS = [
  "Summary",
  "Risk Analysis",
  "Exceptions",
  "Settlements",
] as const;

const REPORT_RANGE_OPTIONS = [
  "Last 7 days",
  "Last 30 days",
  "This month",
  "This quarter",
] as const;

// Map UI labels → backend IDs expected by _parse_report_generation
const REPORT_TYPE_TO_BACKEND: Record<(typeof REPORT_TYPE_OPTIONS)[number], string> = {
  "Summary":       "processed",
  "Risk Analysis": "pipeline",
  "Exceptions":    "pending",
  "Settlements":   "processed",
};
const DATE_RANGE_TO_BACKEND: Record<(typeof REPORT_RANGE_OPTIONS)[number], string> = {
  "Last 7 days":  "last_7_days",
  "Last 30 days": "last_30_days",
  "This month":   "this_month",
  "This quarter": "last_90_days",
};
const BACKEND_REPORT_TYPE_TO_UI: Record<string, (typeof REPORT_TYPE_OPTIONS)[number]> = {
  processed: "Summary",
  pipeline: "Risk Analysis",
  pending: "Exceptions",
  denied: "Exceptions",
};
const BACKEND_DATE_RANGE_TO_UI: Record<string, (typeof REPORT_RANGE_OPTIONS)[number]> = {
  today: "Last 7 days",
  last_7_days: "Last 7 days",
  last_30_days: "Last 30 days",
  this_month: "This month",
  last_90_days: "This quarter",
  all_time: "Last 30 days",
};

function triggerCsvDownload(base64Csv: string, filename: string) {
  let text = base64Csv;
  try { text = atob(base64Csv); } catch { /* already plain text */ }
  const blob = new Blob([text], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

type WelcomeCategory = "all" | "claims" | "queue" | "reports";

interface QuerySuggestion {
  label: string;
  prompt: string;
  description: string;
  icon?: React.ElementType;
  color?: string;
  category?: WelcomeCategory;
}

const QUERY_SUGGESTIONS: QuerySuggestion[] = [
  {
    label: "Review Worklist",
    prompt: "Show pending claims with exception triggers and priority",
    description: "Claims needing action",
    icon: AlertTriangle,
    color: "amber",
    category: "claims",
  },
  {
    label: "High-Risk Claims",
    prompt: "Show high-risk claims with denial probability and reasons",
    description: "Likely denials and risk drivers",
    icon: ShieldAlert,
    color: "red",
    category: "claims",
  },
  {
    label: "Due Soon",
    prompt: "Which claims are close to their due time in the current queue?",
    description: "Claims close to deadline",
    icon: Clock,
    color: "orange",
    category: "queue",
  },
  {
    label: "Duplicate Signals",
    prompt: "List claims with duplicate or fraud indicators",
    description: "Suspicious & duplicate indicators",
    icon: Layers,
    color: "purple",
    category: "claims",
  },
  {
    label: "Today's Metrics",
    prompt: "Show today's key performance indicators and claim volumes",
    description: "Live operational metrics",
    icon: Zap,
    color: "cyan",
    category: "reports",
  },
  {
    label: "Denial Trends",
    prompt: "What are the denial rate trends and top denial reasons?",
    description: "Denial patterns & root causes",
    icon: TrendingDown,
    color: "red",
    category: "reports",
  },
  {
    label: "Queue Summary",
    prompt: "Summarize the current manual review queue — count, priority breakdown, and oldest item",
    description: "Current review queue status",
    icon: Layers,
    color: "fuchsia",
    category: "queue",
  },
  {
    label: "Generate Report",
    prompt: "generate a claims report",
    description: "Download filtered CSV report",
    icon: FileText,
    color: "emerald",
    category: "reports",
  },
];

const SHORTCUTS = [
  { label: "Find Claim", prompt: "Search for a specific claim reference", icon: Search },
  { label: "Metrics", prompt: "Show today's key performance indicators and claim volumes", icon: Zap },
  { label: "Review", prompt: "Show pending claims with exception triggers and priority", icon: AlertTriangle },
  { label: "Report", prompt: "generate a claims report", icon: FileText },
  { label: "High-Risk", prompt: "Show high-risk claims with denial probability and reasons", icon: ShieldAlert },
  { label: "Due Soon", prompt: "Which claims are close to their due time in the current queue?", icon: Clock },
  { label: "Denial Trends", prompt: "What are the denial rate trends and top denial reasons?", icon: TrendingDown },
];

function getViewportSize() {
  if (typeof window === "undefined") {
    return { width: 1280, height: 800 };
  }
  return { width: window.innerWidth, height: window.innerHeight };
}

function getAssistantLayout(viewport = getViewportSize(), expanded = false) {
  const isTablet = viewport.width <= 1180;
  const isCompactTablet = viewport.width <= 900;
  const isShort = viewport.height <= 760;
  const sideOffset = isCompactTablet ? 14 : isTablet ? 18 : ASSISTANT_SIDE_OFFSET;
  const edgeMargin = isCompactTablet ? 12 : ASSISTANT_EDGE_MARGIN;
  const buttonSize = isCompactTablet ? 80 : isTablet ? 90 : ASSISTANT_BUTTON_SIZE;
  const targetWidth = expanded
    ? (isCompactTablet ? 560 : isTablet ? 620 : ASSISTANT_EXPANDED_WIDTH)
    : (isCompactTablet ? 420 : isTablet ? 460 : ASSISTANT_COMPACT_WIDTH);
  const targetHeight = expanded ? ASSISTANT_EXPANDED_HEIGHT : ASSISTANT_COMPACT_HEIGHT;
  const panelWidth = Math.min(
    targetWidth,
    Math.max(isCompactTablet ? 340 : 360, viewport.width - sideOffset * 2)
  );
  const panelBottom = sideOffset + buttonSize + ASSISTANT_PANEL_GAP;
  const reservedTop = isShort ? 14 : edgeMargin;
  const panelHeight = Math.min(
    targetHeight,
    Math.max(360, viewport.height - panelBottom - reservedTop)
  );

  return {
    sideOffset,
    edgeMargin,
    buttonSize,
    panelWidth,
    panelHeight,
    panelBottom,
    headerAvatarSize: isCompactTablet ? 38 : 44,
    messageAvatarSize: isCompactTablet ? 26 : 28,
    welcomeAvatarSize: isCompactTablet ? 30 : 32,
  };
}

function clampAssistantPosition(
  nextX: number,
  nextY: number,
  widgetWidth: number,
  widgetHeight: number,
  viewport = getViewportSize(),
  edgeMargin = ASSISTANT_EDGE_MARGIN
) {
  // Constrain X to the right side only
  const maxX = Math.max(edgeMargin, viewport.width - widgetWidth - edgeMargin);
  const fixedX = maxX; // Freeze to right rail

  const minY = edgeMargin;
  const maxY = Math.max(edgeMargin, viewport.height - widgetHeight - edgeMargin);

  return {
    x: fixedX,
    y: Math.min(Math.max(nextY, minY), maxY),
  };
}

function getDefaultAssistantPosition(viewport = getViewportSize(), buttonSize = ASSISTANT_BUTTON_SIZE) {
  const maxX = Math.max(ASSISTANT_EDGE_MARGIN, viewport.width - buttonSize - ASSISTANT_EDGE_MARGIN);
  return clampAssistantPosition(
    maxX,
    Math.round(viewport.height * 0.68),
    buttonSize,
    buttonSize,
    viewport,
    ASSISTANT_EDGE_MARGIN
  );
}

function getInitialAssistantPosition(buttonSize = ASSISTANT_BUTTON_SIZE) {
  if (typeof window === "undefined") return { x: 0, y: 420 };
  const viewport = getViewportSize();
  const stored = window.localStorage.getItem(ASSISTANT_POSITION_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as { x?: number; y?: number };
      if (typeof parsed.x === "number" && typeof parsed.y === "number") {
        return clampAssistantPosition(parsed.x, parsed.y, buttonSize, buttonSize, viewport, ASSISTANT_EDGE_MARGIN);
      }
    } catch {
      // Ignore malformed persisted position.
    }
  }
  return getDefaultAssistantPosition(viewport, buttonSize);
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  requestContent?: string;
  ts: Date;
  type?: "text" | "action" | "data" | "suggestion";
  data?: Record<string, unknown>;
  followUps?: string[];
  querySuggestions?: QuerySuggestion[];
  reportBuilder?: ReportBuilderConfig;
}

interface ReportBuilderConfig {
  reportType?: (typeof REPORT_TYPE_OPTIONS)[number];
  dateRange?: (typeof REPORT_RANGE_OPTIONS)[number];
}

interface InsightNudge {
  id: string;
  title: string;
  body: string;
  insights: string[];
  prompt: string;
}

interface AssistantSettingsResponse {
  enabled?: boolean;
  role?: string;
  market?: string;
  variant?: string;
}

interface KPIData {
  total_claims?: number;
  pending_hitl_count?: number;
  claims_today?: number;
  denial_rate?: number;
  auto_adjudication_rate?: number;
  [key: string]: number | undefined;
}

interface ClaimData {
  claim_reference: string;
  patient_name: string;
  status?: string;
  total_billed?: string;
  [key: string]: string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeClaimData(value: unknown): ClaimData | null {
  if (!isRecord(value)) return null;
  const claimReference = typeof value.claim_reference === "string" ? value.claim_reference : "";
  if (!claimReference) return null;
  return {
    claim_reference: claimReference,
    patient_name: typeof value.patient_name === "string" ? value.patient_name : "Unknown patient",
    status: typeof value.status === "string" ? value.status : undefined,
    total_billed: typeof value.total_billed === "string" || typeof value.total_billed === "number"
      ? String(value.total_billed)
      : "0",
  };
}

function getClaimsPreview(data: unknown): ClaimData[] {
  if (!isRecord(data)) return [];
  const claims = data.claims;
  return Array.isArray(claims)
    ? claims.map(normalizeClaimData).filter((claim): claim is ClaimData => claim !== null)
    : [];
}

function friendlyAssistantLine(value: string): string {
  return value
    .replace(/\bHITL\b/gi, "manual review")
    .replace(/\bSLA\b/gi, "due time")
    .replace(/\bKPIs?\b/gi, "metrics")
    .replace(/\bAPI\b/g, "service")
    .replace(new RegExp("\\b" + "LL" + "M\\b", "gi"), "AI assistant")
    .replace(/\bauto-adjudicated\b/gi, "automated")
    .replace(/\bauto-adjudication\b/gi, "automation")
    .replace(/\s+[·|]\s+/g, " - ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function bulletizeAssistantLines(lines: string[], maxLines = 4): string {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of lines) {
    const line = friendlyAssistantLine(raw.replace(/^\s*[-*•\d.)]+\s*/, ""));
    if (!line) continue;
    if (/^(sure|certainly|of course|here(?:'s| is)|based on|let me|i can|i apologize)\b[\s,:-]*/i.test(line)) continue;
    const key = line.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    cleaned.push(line);
    if (cleaned.length >= maxLines) break;
  }
  return cleaned.map((line) => `• ${line}`).join("\n");
}

function cleanAssistantText(value: unknown): string {
  const raw = typeof value === "string" ? value : "";
  if (/only answer questions about claims|outside the claims workspace|outside scope/i.test(raw)) {
    return FRIENDLY_SCOPE_GUIDANCE;
  }
  const stripped = raw
    .replace(/<\s*(think|analysis|reasoning)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*\/?\s*(think|analysis|reasoning)\b[^>]*>/gi, "")
    .replace(/\r\n/g, "\n");
  const baseLines = stripped
    .split("\n")
    .flatMap((line) => line.split(/\s+·\s+/))
    .flatMap((line) => line.length > 220 ? line.split(/(?<=[.!?])\s+/) : [line])
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8);
  const compact = bulletizeAssistantLines(baseLines);

  return compact || "• I could not find a specific answer from the available claims data.\n• Try a claim reference, review queue question, or metrics summary.";
}

function inferAssistantMode(text: string, pathname: string | null): string {
  const lower = text.toLowerCase();
  if (lower.includes("policy") || lower.includes("compliance") || lower.includes("clause") || lower.includes("regulation")) {
    return "compliance";
  }
  if (lower.includes("trend") || lower.includes("kpi") || lower.includes("metric") || lower.includes("performance") || lower.includes("denial")) {
    return "analytics";
  }
  if (lower.includes("workflow") || lower.includes("queue") || lower.includes("sla") || lower.includes("process")) {
    return "workflow";
  }
  if (lower.includes("claim") || pathname?.startsWith("/claims") || pathname?.startsWith("/hitl")) {
    return "claims";
  }
  return "general";
}

function buildChatHistory(messages: Message[], nextMessage: Message) {
  return [...messages, nextMessage]
    .filter((message) => message.role === "user" || message.role === "assistant")
    .slice(-MAX_CHAT_HISTORY_MESSAGES)
    .map((message) => ({
      role: message.role,
      content: message.role === "assistant"
        ? cleanAssistantText(message.content)
        : (message.requestContent ?? message.content),
    }));
}

function buildClaimsContext(claims: ClaimResponse[] | undefined, kpis: unknown, pathname: string | null) {
  return {
    pathname,
    visible_claim_count: claims?.length ?? 0,
    visible_claims: (claims ?? []).slice(0, 5).map((claim) => ({
      claim_reference: claim.claim_reference,
      patient_name: claim.patient_name,
      status: claim.status,
      total_billed: claim.total_billed,
    })),
    kpis: isRecord(kpis) ? kpis : {},
  };
}

function detectInsightNudge(claimList: ClaimResponse[] | undefined): InsightNudge | null {
  if (!claimList || claimList.length < 5) return null;

  const providerCounts = new Map<string, number>();
  for (const claim of claimList) {
    const provider = claim.provider_name?.trim();
    if (!provider) continue;
    providerCounts.set(provider, (providerCounts.get(provider) ?? 0) + 1);
  }

  let topProvider = "";
  let topCount = 0;
  for (const [provider, count] of providerCounts.entries()) {
    if (count > topCount) {
      topProvider = provider;
      topCount = count;
    }
  }

  const concentration = topCount / claimList.length;
  if (!topProvider || topCount < 3 || concentration < 0.4) return null;

  const providerClaims = claimList.filter((claim) => claim.provider_name?.trim() === topProvider);
  const pendingCount = providerClaims.filter((claim) => claim.status === "PENDING").length;
  const deniedCount = providerClaims.filter((claim) => claim.status === "DENIED").length;
  const settledCount = providerClaims.filter((claim) => claim.status === "SETTLED").length;
  const sharePct = Math.round(concentration * 100);

  return {
    id: `provider-activity-${topProvider.toLowerCase()}`,
    title: `${topProvider} activity spike detected`,
    body: `${topCount} of ${claimList.length} visible claims are from ${topProvider} (${sharePct}%).`,
    insights: [
      `Pending: ${pendingCount}`,
      `Denied: ${deniedCount}`,
      `Settled: ${settledCount}`,
    ],
    prompt: `Summarize current findings for ${topProvider}: concentration ${sharePct}%, pending ${pendingCount}, denied ${deniedCount}, settled ${settledCount}. Provide top follow-up actions.`,
  };
}

function getVariantClassSet(boardStyle: ReturnType<typeof getChatAssistantVariant>["boardStyle"]) {
  if (boardStyle === "legacy") {
    return {
      panelClass: "border-slate-900/[0.10] bg-white shadow-[0_30px_80px_rgba(0,0,0,0.8)]",
      headerClass: "bg-[linear-gradient(180deg,#1c1c20_0%,#141416_100%)]",
      accentClass: "bg-gradient-to-r from-transparent via-brand-primary to-transparent",
      glowClass: "bg-brand-primary/24",
      shortcutClass: "rounded-2xl border border-slate-900/[0.08] bg-slate-900/10 hover:border-brand-primary/25 hover:bg-brand-primary/10",
      bubbleClass: "border-slate-900/[0.10] bg-slate-900/[0.045]",
      launcherClass: "bg-transparent border-0 shadow-none",
    };
  }
  if (boardStyle === "cinematic") {
    return {
      panelClass: "border-orange-300/14 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02)),rgba(18,12,10,0.94)] shadow-[0_28px_90px_rgba(0,0,0,0.72)]",
      headerClass: "bg-[linear-gradient(180deg,rgba(255,140,69,0.10)_0%,rgba(17,12,10,0.78)_100%)]",
      accentClass: "bg-gradient-to-r from-transparent via-orange-300/80 to-transparent",
      glowClass: "bg-orange-300/28",
      shortcutClass: "rounded-2xl border border-orange-200/10 bg-slate-900/[0.03] hover:border-orange-300/28 hover:bg-orange-300/10",
      bubbleClass: "border-orange-200/10 bg-slate-900/[0.04]",
      launcherClass: "bg-transparent border-0 shadow-none",
    };
  }
  if (boardStyle === "workspace") {
    return {
      panelClass: "border-fuchsia-300/12 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.018)),rgba(16,16,20,0.96)] shadow-[0_24px_84px_rgba(0,0,0,0.66)]",
      headerClass: "bg-[linear-gradient(180deg,rgba(255,255,255,0.04)_0%,rgba(20,20,27,0.80)_100%)]",
      accentClass: "bg-gradient-to-r from-transparent via-fuchsia-300/65 to-transparent",
      glowClass: "bg-fuchsia-300/20",
      shortcutClass: "rounded-xl border border-slate-900/[0.06] bg-slate-900/[0.05] hover:border-fuchsia-300/20 hover:bg-slate-900/[0.08]",
      bubbleClass: "border-slate-900/[0.08] bg-slate-900/[0.05]",
      launcherClass: "bg-transparent border-0 shadow-none",
    };
  }
  return {
    panelClass: "",
    headerClass: "",
    accentClass: "bg-gradient-to-r from-cyan-400/0 via-cyan-400/55 to-cyan-400/0",
    glowClass: "bg-cyan-400/30",
    shortcutClass: "rounded-lg border border-slate-900/[0.05] bg-slate-900/[0.04] hover:bg-slate-900/10",
    bubbleClass: "border-slate-900/[0.08] bg-slate-900/[0.04]",
    launcherClass: "",
  };
}

function ReportBuilderCard({
  defaultConfig,
  disabled,
  onGenerate,
}: {
  defaultConfig?: ReportBuilderConfig;
  disabled: boolean;
  onGenerate: (config: Required<ReportBuilderConfig>) => void;
}) {
  const [reportType, setReportType] = useState<(typeof REPORT_TYPE_OPTIONS)[number]>(
    defaultConfig?.reportType ?? "Summary"
  );
  const [dateRange, setDateRange] = useState<(typeof REPORT_RANGE_OPTIONS)[number]>(
    defaultConfig?.dateRange ?? "Last 7 days"
  );

  return (
    <div className="mt-2 rounded-xl border border-slate-900/[0.08] bg-slate-900/[0.03] p-3">
      <div className="ui-chip-label mb-2 flex items-center gap-2 text-[10px] text-slate-900/42">
        <BarChart3 size={12} className="text-brand-primary" />
        Report Builder
      </div>
      <div className="space-y-2">
        <div className="flex flex-wrap gap-1.5">
          {REPORT_TYPE_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setReportType(option)}
              className={cn(
                "rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors",
                reportType === option
                  ? "bg-brand-primary/20 text-brand-primary"
                  : "bg-slate-900/[0.04] text-slate-900/70 hover:bg-slate-900/10 hover:text-slate-900/90"
              )}
            >
              {option}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {REPORT_RANGE_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setDateRange(option)}
              className={cn(
                "inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors",
                dateRange === option
                  ? "bg-brand-primary/20 text-brand-primary"
                  : "bg-slate-900/[0.04] text-slate-900/70 hover:bg-slate-900/10 hover:text-slate-900/90"
              )}
            >
              <CalendarDays size={11} className={dateRange === option ? "text-brand-primary" : "text-slate-900/50"} />
              {option}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => onGenerate({ reportType, dateRange })}
          className="mt-1 inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-brand-primary px-3 py-1.5 text-[11px] font-bold text-white transition-all hover:shadow-[0_0_14px_rgba(37,99,235,0.42)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <FileText size={12} />
          Generate
        </button>
      </div>
    </div>
  );
}

export function ClaimAssistant() {
  const router = useRouter();
  const pathname = usePathname();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [assistantEnabled, setAssistantEnabled] = useState(true);
  const [assistantVariant, setAssistantVariant] = useState<ChatAssistantVariantKey>("dashboard-copilot");
  const [activeNudge, setActiveNudge] = useState<InsightNudge | null>(null);
  const [nudgeCooldownUntil, setNudgeCooldownUntil] = useState(0);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [viewport, setViewport] = useState(() => getViewportSize());
  const [dragging, setDragging] = useState<null | {
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    widgetWidth: number;
    widgetHeight: number;
    moved: boolean;
  }>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const launcherRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const nudgeRef = useRef<HTMLDivElement>(null);
  const criticalPanelRef = useRef<HTMLDivElement>(null);
  const suppressClickRef = useRef(false);
  const positionRef = useRef<{ x: number; y: number }>({ x: 0, y: 420 });
  const dragTargetPositionRef = useRef<{ x: number; y: number } | null>(null);
  const dragFrameRef = useRef<number | null>(null);
  const lastNudgeIdRef = useRef<string | null>(null);
  const inFlightRequestRef = useRef(false);
  const lastFollowUpsRef = useRef<string[]>([]);
  const [avatarMode, setAvatarMode] = useState<AvatarMode>("sentinel");
  const [welcomeCategory, setWelcomeCategory] = useState<WelcomeCategory>("all");
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [dismissedFollowUpMessageId, setDismissedFollowUpMessageId] = useState<string | null>(null);

  const clearChatHistory = useCallback(() => {
    setMessages([]);
    setInput("");
    setLoading(false);
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(ASSISTANT_CHAT_HISTORY_KEY);
    }
  }, []);

  // Fetch real-time data for context
  const { data: claims } = useClaims({ page_size: 10 });
  const { kpis } = useDashboardKPIs({ enabled: true });
  const { queue: hitlQueue } = useHITLQueue();
  const { visibleAlerts, criticalCount, warningCount, totalUnread, dismiss, dismissAll } = useProactiveIntelligence(kpis, hitlQueue);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    let active = true;
    fetch("/api/v1/proxy/chat/settings", { credentials: "include" })
      .then((res) => {
        if (!res.ok) {
          return { enabled: false };
        }
        return res.json() as Promise<AssistantSettingsResponse>;
      })
      .then((data) => {
        if (!active) return;
        setAssistantEnabled(Boolean(data.enabled));
        setAssistantVariant(getChatAssistantVariant(data.variant).key);
      })
      .catch(() => {
        if (active) {
          setAssistantEnabled(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const canShowPassiveNudge = pathname === "/" && viewport.width >= 768;

  useEffect(() => {
    if (!canShowPassiveNudge && activeNudge) {
      setActiveNudge(null);
    }
  }, [activeNudge, canShowPassiveNudge]);

  useEffect(() => {
    if (!assistantEnabled || !canShowPassiveNudge || open || loading) return;
    if (Date.now() < nudgeCooldownUntil) return;

    const detected = detectInsightNudge(claims?.claims);
    if (!detected) return;
    if (detected.id === lastNudgeIdRef.current) return;

    setActiveNudge(detected);
    lastNudgeIdRef.current = detected.id;
  }, [assistantEnabled, canShowPassiveNudge, claims?.claims, loading, nudgeCooldownUntil, open]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const clearOnUnload = () => {
      clearChatHistory();
    };

    window.addEventListener("beforeunload", clearOnUnload);
    window.addEventListener("pagehide", clearOnUnload);
    return () => {
      window.removeEventListener("beforeunload", clearOnUnload);
      window.removeEventListener("pagehide", clearOnUnload);
    };
  }, [clearChatHistory]);

  const assistantLayout = getAssistantLayout(viewport, expanded);
  const selectedVariant = getChatAssistantVariant(assistantVariant);
  const variantClasses = getVariantClassSet(selectedVariant.boardStyle);
  const variantAvatarPool = useMemo<AvatarMode[]>(
    () => selectedVariant.avatarModes.length
      ? selectedVariant.avatarModes
      : MODE_SEQUENCE.filter((mode) => mode !== "chatboticon"),
    [selectedVariant]
  );
  const criticalAlerts = useMemo(
    () => visibleAlerts.filter((alert) => alert.severity === "critical"),
    [visibleAlerts]
  );
  const secondaryAlerts = useMemo(
    () => visibleAlerts.filter((alert) => alert.severity !== "critical"),
    [visibleAlerts]
  );
  const basePosition = position ?? getDefaultAssistantPosition(viewport, assistantLayout.buttonSize);
  const resolvedPosition = clampAssistantPosition(
    basePosition.x,
    basePosition.y,
    open ? assistantLayout.panelWidth : assistantLayout.buttonSize,
    open ? assistantLayout.panelHeight : assistantLayout.buttonSize,
    viewport,
    assistantLayout.edgeMargin
  );

  useEffect(() => {
    setPosition(getInitialAssistantPosition(assistantLayout.buttonSize));
  }, [assistantLayout.buttonSize]);

  useEffect(() => {
    positionRef.current = position ?? basePosition;
  }, [basePosition, position]);

  const applyFloatingTransforms = useCallback((nextPosition: { x: number; y: number }) => {
    const transform = `translate3d(${Math.round(nextPosition.x)}px, ${Math.round(nextPosition.y)}px, 0)`;
    if (launcherRef.current) {
      launcherRef.current.style.transform = transform;
      // Reveal after first positioning so icon never flashes at (0,0)
      launcherRef.current.style.opacity = "1";
    }
    if (panelRef.current) {
      panelRef.current.style.transform = transform;
      panelRef.current.style.opacity = "1";
    }
    if (criticalPanelRef.current) {
      const criticalPanelWidth = Math.min(380, Math.max(320, assistantLayout.panelWidth - 28));
      const criticalPanelHeight = Math.min(
        Math.max(220, criticalAlerts.length * 116 + 92),
        Math.max(240, viewport.height - assistantLayout.edgeMargin * 2)
      );
      const criticalY = Math.min(
        Math.max(assistantLayout.edgeMargin, nextPosition.y + 14),
        Math.max(assistantLayout.edgeMargin, viewport.height - criticalPanelHeight - assistantLayout.edgeMargin)
      );
      const attachedLeftX = nextPosition.x - criticalPanelWidth - 14;
      const attachedRightX = nextPosition.x + assistantLayout.panelWidth + 14;
      const criticalX =
        attachedLeftX >= assistantLayout.edgeMargin
          ? attachedLeftX
          : Math.min(
              attachedRightX,
              Math.max(assistantLayout.edgeMargin, viewport.width - criticalPanelWidth - assistantLayout.edgeMargin)
            );
      criticalPanelRef.current.style.width = `${criticalPanelWidth}px`;
      criticalPanelRef.current.style.maxHeight = `${criticalPanelHeight}px`;
      criticalPanelRef.current.style.transform = `translate3d(${Math.round(criticalX)}px, ${Math.round(criticalY)}px, 0)`;
      criticalPanelRef.current.style.opacity = "1";
    }
    if (nudgeRef.current) {
      const nudgeWidth = Math.min(assistantLayout.panelWidth, 420);
      const nudgeHeight = 170;
      const nudgeY = Math.min(
        Math.max(assistantLayout.edgeMargin, nextPosition.y - 112),
        Math.max(assistantLayout.edgeMargin, viewport.height - nudgeHeight - assistantLayout.edgeMargin)
      );
      // Anchor the live insight popup to the launcher so it clearly emerges from the bot icon.
      const preferredLeftX = nextPosition.x - nudgeWidth - 14;
      const preferredRightX = nextPosition.x + assistantLayout.buttonSize + 14;
      const nudgeX =
        preferredLeftX >= assistantLayout.edgeMargin
          ? preferredLeftX
          : Math.min(
              preferredRightX,
              Math.max(assistantLayout.edgeMargin, viewport.width - nudgeWidth - assistantLayout.edgeMargin)
            );
      nudgeRef.current.style.transform = `translate3d(${Math.round(nudgeX)}px, ${Math.round(nudgeY)}px, 0)`;
      nudgeRef.current.style.opacity = "1";
    }
  }, [assistantLayout.buttonSize, assistantLayout.edgeMargin, assistantLayout.panelWidth, criticalAlerts.length, viewport.height, viewport.width]);

  useEffect(() => {
    applyFloatingTransforms(resolvedPosition);
  }, [applyFloatingTransforms, resolvedPosition]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleResize = () => {
      const nextViewport = getViewportSize();
      const nextLayout = getAssistantLayout(nextViewport, expanded);
      setViewport(nextViewport);
      setPosition((current) => {
        const fallback = getDefaultAssistantPosition(nextViewport, nextLayout.buttonSize);
        const next = current ?? fallback;
        return clampAssistantPosition(
          next.x,
          next.y,
          nextLayout.buttonSize,
          nextLayout.buttonSize,
          nextViewport,
          nextLayout.edgeMargin
        );
      });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [expanded]);

  useEffect(() => {
    if (!dragging || typeof window === "undefined") return;

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== dragging.pointerId) return;
      const deltaX = event.clientX - dragging.startClientX;
      const deltaY = event.clientY - dragging.startClientY;
      const nextPosition = clampAssistantPosition(
        dragging.startX + deltaX,
        dragging.startY + deltaY,
        dragging.widgetWidth,
        dragging.widgetHeight,
        viewport,
        assistantLayout.edgeMargin
      );
      if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
        suppressClickRef.current = true;
      }
      dragTargetPositionRef.current = nextPosition;
      if (dragFrameRef.current === null) {
        dragFrameRef.current = window.requestAnimationFrame(() => {
          if (dragTargetPositionRef.current !== null) {
            applyFloatingTransforms(dragTargetPositionRef.current);
          }
          dragFrameRef.current = null;
        });
      }
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerId !== dragging.pointerId) return;
      let finalPosition = positionRef.current;
      if (dragFrameRef.current !== null) {
        window.cancelAnimationFrame(dragFrameRef.current);
        dragFrameRef.current = null;
      }
      if (dragTargetPositionRef.current !== null) {
        finalPosition = dragTargetPositionRef.current;
        applyFloatingTransforms(finalPosition);
        setPosition(finalPosition);
        dragTargetPositionRef.current = null;
      }
      setDragging(null);
      window.localStorage.setItem(
        ASSISTANT_POSITION_KEY,
        JSON.stringify(finalPosition)
      );
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      if (dragFrameRef.current !== null) {
        window.cancelAnimationFrame(dragFrameRef.current);
        dragFrameRef.current = null;
      }
      dragTargetPositionRef.current = null;
    };
  }, [applyFloatingTransforms, assistantLayout.edgeMargin, dragging, viewport]);

  const startRailDrag = useCallback((
    event: React.PointerEvent<HTMLElement>,
    widgetWidth: number,
    widgetHeight: number,
    currentX = resolvedPosition.x,
    currentY = resolvedPosition.y
  ) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging({
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: currentX,
      startY: currentY,
      widgetWidth,
      widgetHeight,
      moved: false,
    });
  }, [resolvedPosition.x, resolvedPosition.y]);

  // Generate smart suggestions based on context
  const getSmartSuggestions = useCallback((): string[] => {
    const suggestions: string[] = [];

    if (pathname === "/") {
      if (kpis?.pending_hitl_count && kpis.pending_hitl_count > 0) {
        suggestions.push(`Why are ${kpis.pending_hitl_count} claims in manual review?`);
      }
      if (kpis?.denial_rate && kpis.denial_rate > 10) {
        suggestions.push(`How can I reduce the ${kpis.denial_rate.toFixed(1)}% denial rate?`);
      }
      if (kpis?.auto_adjudication_rate) {
        suggestions.push(`How can we improve automation from ${kpis.auto_adjudication_rate.toFixed(1)}%?`);
      }
      suggestions.push("What are the top 3 action items for today?");
    }

    if (pathname?.startsWith("/claims")) {
      suggestions.push("What's the settlement pattern for similar claims?");
      suggestions.push("Which claims need immediate attention?");
      suggestions.push("Show me compliance issues in recent claims");
    }

    if (pathname?.startsWith("/hitl")) {
      suggestions.push("What policy clauses apply to this claim?");
      suggestions.push("Show me similar past decisions");
      suggestions.push("What's the recommended action?");
    }

    return suggestions;
  }, [pathname, kpis]);

  // Structured response types - defined inside submit to avoid router dependency
  const getFollowUpSuggestions = useCallback((
    content: string,
    prompt?: string,
    kind?: AssistantSuggestionKind,
  ): string[] => {
    const next = buildFollowUpSuggestions({
      content,
      prompt,
      pathname,
      kind,
      previous: lastFollowUpsRef.current,
    });
    lastFollowUpsRef.current = next.filter((item) => item !== "✏ Write my own");
    return next;
  }, [pathname]);

  const createStructuredResponse = useCallback((data: unknown, sourcePrompt = ""): Message => {
    const id = crypto.randomUUID();
    const ts = new Date();
    const response = isRecord(data) ? data : { reply: "Chat service returned an invalid response." };

    // Handle different response types
    const claimArray = getClaimsPreview(response);
    if (claimArray.length > 0) {
      const claimCount = claimArray.length;
      const totalValue = claimArray.reduce((sum: number, c: ClaimData) => sum + (parseFloat(c.total_billed ?? "0") || 0), 0);
      
      const content = [
        `• Matching claims: ${claimCount}`,
        `• Total billed: ${formatCurrency(totalValue, "USD")}`,
        "• Open a claim below for the full journey and settlement view.",
      ].join("\n");
      return {
        id,
        role: "assistant",
        content,
        ts,
        type: "data",
        data: { claims: claimArray, count: claimCount, totalValue },
        followUps: getFollowUpSuggestions(content, sourcePrompt, "claims"),
      };
    }

    if (isRecord(response.kpis)) {
      const kpiData = response.kpis as KPIData;
      const totalClaims = kpiData.total_claims ?? 0;
      const autoRate = kpiData.auto_adjudication_rate ?? 0;
      const denialRate = kpiData.denial_rate ?? 0;
      const pendingHitl = kpiData.pending_hitl_count ?? 0;
      const content = [
        `• Total claims: ${totalClaims}`,
        `• Automation rate: ${autoRate}%`,
        `• Denial rate: ${denialRate}%`,
        `• Manual review queue: ${pendingHitl}`,
      ].join("\n");
      return {
        id,
        role: "assistant",
        content,
        ts,
        type: "data",
        data: { kpis: kpiData },
        followUps: getFollowUpSuggestions(content, sourcePrompt, "kpi"),
      };
    }

    // CSV export — trigger download and confirm in the chat
    if (typeof response.export_csv === "string" && typeof response.export_filename === "string") {
      triggerCsvDownload(response.export_csv, response.export_filename);
      const content = cleanAssistantText(response.reply) || `Report ready. Download started: ${response.export_filename}`;
      return {
        id,
        role: "assistant",
        content,
        ts,
        type: "text",
        followUps: getFollowUpSuggestions(content, sourcePrompt, "export"),
      };
    }

    if (isRecord(response.report_options)) {
      const options = response.report_options;
      const defaultReportType = typeof options.default_report_type === "string"
        ? BACKEND_REPORT_TYPE_TO_UI[options.default_report_type] ?? "Summary"
        : "Summary";
      const defaultDateRange = typeof options.default_date_range === "string"
        ? BACKEND_DATE_RANGE_TO_UI[options.default_date_range] ?? "Last 30 days"
        : "Last 30 days";
      return {
        id,
        role: "assistant",
        content: cleanAssistantText(response.reply) || "Select report type and date range, then click Generate.",
        ts,
        type: "suggestion",
        reportBuilder: { reportType: defaultReportType, dateRange: defaultDateRange },
      };
    }

    // Default text response
    const content = cleanAssistantText(response.reply);
    return {
      id,
      role: "assistant",
      content,
      ts,
      type: "text",
      followUps: getFollowUpSuggestions(content, sourcePrompt, "text"),
    };
  }, [getFollowUpSuggestions]);

  // Handle user input with context-aware processing
  const submit = useCallback(
    async (text: string, displayText?: string) => {
      const trimmed = text.trim();
      if (!trimmed || loading || inFlightRequestRef.current) return;
      inFlightRequestRef.current = true;
      
      const displayContent = displayText?.trim() || trimmed;
      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content: displayContent,
        requestContent: trimmed,
        ts: new Date(),
        type: "text",
      };
      
      setMessages((prev) => [...prev, userMsg]);
      setInput("");
      setDismissedFollowUpMessageId(null);
      setCopiedMessageId(null);
      setLoading(true);

      try {
        // First, try to handle as a structured query
        const lowerText = trimmed.toLowerCase();

        // Show the report builder ONLY for natural-language setup requests.
        // Execution messages (sent by the builder itself) contain "report_type="
        // and must fall through to the API — never re-show the builder.
        const isReportExecution = lowerText.includes("report_type=") && lowerText.includes("date_range=");
        if (
          !isReportExecution &&
          (lowerText.includes("generate a claims report") ||
           lowerText === "generate a report" ||
           lowerText === "auto-report" ||
           (lowerText.includes("report") && lowerText.includes("generate")))
        ) {
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content: "Select report type and date range, then click Generate.",
              ts: new Date(),
              type: "suggestion",
              reportBuilder: { reportType: "Summary", dateRange: "Last 7 days" },
            },
          ]);
          setLoading(false);
          return;
        }

        if (lowerText.includes("high-risk claims and pending exceptions") || lowerText === "query") {
          setMessages((prev) => [
            ...prev,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content: "Choose the query focus to continue.",
              ts: new Date(),
              type: "suggestion",
              querySuggestions: QUERY_SUGGESTIONS,
            },
          ]);
          setLoading(false);
          return;
        }
        
        // Check if user wants to see claims with specific status
        if (lowerText.includes("claims") && (lowerText.includes("pending") || lowerText.includes("denied") || lowerText.includes("settled"))) {
          const status = lowerText.includes("pending") ? "PENDING" : 
                        lowerText.includes("denied") ? "DENIED" : 
                        lowerText.includes("settled") ? "SETTLED" : undefined;
          
          if (status) {
            const filteredClaims = claims?.claims?.filter((c: ClaimResponse) => c.status === status) ?? [];
            setMessages(prev => [
              ...prev,
              filteredClaims.length > 0
                ? createStructuredResponse({ claims: filteredClaims }, trimmed)
                : {
                  id: crypto.randomUUID(),
                  role: "assistant" as const,
                  content: `• No ${status.toLowerCase()} claims in the current preview.\n• Try the full filtered list for a wider search.`,
                  ts: new Date(),
                  type: "suggestion" as const,
                  followUps: getFollowUpSuggestions(`No ${status.toLowerCase()} claims in the current preview. Try the full filtered list.`, trimmed, "claims"),
                },
            ]);
            setLoading(false);
            return;
          }
        }

        // Check for KPI queries
        if (lowerText.includes("kpi") || lowerText.includes("today") || lowerText.includes("performance")) {
          if (kpis) {
            const m = createStructuredResponse({ kpis }, trimmed);
            setMessages(prev => [...prev, m]);
            setLoading(false);
            return;
          }
        }

        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), CHAT_REQUEST_TIMEOUT_MS);
        let upstream: Response;

        try {
          upstream = await fetch("/api/v1/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            signal: controller.signal,
            body: JSON.stringify({
              messages: buildChatHistory(messages, userMsg),
              context: {
                ...buildClaimsContext(claims?.claims, kpis, pathname),
                mode: inferAssistantMode(trimmed, pathname),
                timestamp: new Date().toISOString(),
              }
            }),
          });
        } finally {
          window.clearTimeout(timeout);
        }

        if (upstream.status === 401) {
          clearChatHistory();
          setOpen(false);
          router.push("/login");
          return;
        }

        const data = await upstream.json().catch(() => ({
          reply: upstream.ok
            ? "Chat service returned an invalid response."
            : "Chat service is temporarily unavailable.",
        }));
        if (!upstream.ok) {
          throw new Error(typeof data.detail === "string" ? data.detail : `HTTP ${upstream.status}`);
        }
        // When executing a report (not just requesting the builder), strip
        // report_options from the response so the builder doesn't loop.
        const responseData = isReportExecution && isRecord(data) && data.report_options
          ? { ...data, report_options: undefined }
          : data;
        const aiMsg = createStructuredResponse(responseData, trimmed);
        setMessages((prev) => [...prev, aiMsg]);
        
      } catch (error) {
        if (error instanceof Error && /401|unauthorized/i.test(error.message)) {
          clearChatHistory();
          setOpen(false);
          router.push("/login");
          return;
        }
        const message = error instanceof DOMException && error.name === "AbortError"
          ? "• Request timed out.\n• Try a more specific claim reference or queue question."
          : "• Assistant is temporarily unavailable.\n• Try again or ask for service health.";
        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: "assistant" as const,
            content: message,
            ts: new Date(),
            type: "text" as const,
            followUps: getFollowUpSuggestions(message, trimmed, "error"),
          },
        ]);
      } finally {
        inFlightRequestRef.current = false;
        setLoading(false);
      }
    },
    [messages, loading, claims, kpis, pathname, createStructuredResponse, router, clearChatHistory, getFollowUpSuggestions]
  );

  // Handle quick actions
  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit(input);
    }
  };

  // Scroll to bottom
  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
  }, [messages, open]);

  // Focus input when opened (short delay lets panel animate in first)
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 160);
  }, [open]);

  // Character cycling keeps the selected admin character family visible while still reacting to live status.
  useEffect(() => {
    const pickFrom = (pool: AvatarMode[]) => pool[Math.floor(Math.random() * pool.length)] ?? variantAvatarPool[0] ?? "sentinel";
    const preferredMode = (preferred: AvatarMode) =>
      variantAvatarPool.includes(preferred) ? preferred : variantAvatarPool[0] ?? preferred;

    if (loading) { setAvatarMode(preferredMode("thinking")); return; }
    if (criticalCount > 0) { setAvatarMode(preferredMode("monitoring")); return; }
    if (warningCount > 0) {
      const statusPool = variantAvatarPool.filter((mode) => ["searching", "assisting", "monitoring", "thinking"].includes(mode));
      setAvatarMode(pickFrom(statusPool.length ? statusPool : variantAvatarPool));
      return;
    }
    let timer: ReturnType<typeof setTimeout>;
    function cycle() {
      setAvatarMode(pickFrom(variantAvatarPool));
      timer = setTimeout(cycle, 3500 + Math.random() * 7000);
    }
    cycle();
    return () => clearTimeout(timer);
  }, [loading, criticalCount, warningCount, variantAvatarPool]);


  const handleSuggestionTap = useCallback((s: string) => {
    submit(s);
  }, [submit]);

  const copyMessage = useCallback((id: string, text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedMessageId(id);
      setTimeout(() => setCopiedMessageId(null), 2000);
    }).catch(() => {});
  }, []);

  const smartSuggestions = getSmartSuggestions();
  const dismissNudge = useCallback(() => {
    setActiveNudge(null);
    setNudgeCooldownUntil(Date.now() + 10 * 60 * 1000);
  }, []);

  const acceptNudge = useCallback(() => {
    if (!activeNudge) return;
    setOpen(true);
    setActiveNudge(null);
    void submit(activeNudge.prompt, activeNudge.title);
  }, [activeNudge, submit]);

  const assistantOverlay = !assistantEnabled ? null : (
      <>
      {!open && activeNudge && (
        <div
          ref={nudgeRef}
          style={{
            top: 0,
            left: 0,
            opacity: 0,
            width: Math.min(assistantLayout.panelWidth, 420),
            willChange: "transform, opacity",
            background: "var(--glass-bg)",
            borderColor: "var(--glass-border)",
            boxShadow: "var(--card-hover-shadow)",
            color: "var(--text-primary)",
          }}
          className="glass-card pointer-events-auto fixed z-[59] relative overflow-hidden rounded-[1.35rem] p-3.5"
          role="status"
          aria-live="polite"
        >
          <div className="pointer-events-none absolute inset-x-0 top-0 h-16 bg-gradient-to-r from-cyan-400/18 via-cyan-400/8 to-transparent" />
          <div className="pointer-events-none absolute inset-y-3 left-0 w-1 rounded-r-full bg-cyan-400/70" />
          <div className="flex items-start gap-2.5">
            <span
              className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border"
              style={{
                borderColor: "var(--glass-border)",
                background: "color-mix(in srgb, var(--accent-cyan) 16%, transparent)",
              }}
            >
              <BellRing size={13} className="text-brand-primary" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-brand-primary">Live insight</p>
              <p className="mt-1 text-[13px] font-semibold" style={{ color: "var(--text-primary)" }}>{activeNudge.title}</p>
              <p className="mt-1 text-[11px] leading-relaxed" style={{ color: "var(--text-secondary)" }}>{activeNudge.body}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {activeNudge.insights.map((insight) => (
                  <span
                    key={insight}
                    className="ui-chip-label rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.12em]"
                    style={{
                      borderColor: "var(--glass-border)",
                      background: "color-mix(in srgb, var(--bg-card) 82%, transparent)",
                      color: "var(--text-secondary)",
                    }}
                  >
                    {insight}
                  </span>
                ))}
              </div>
              <div className="mt-2.5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={acceptNudge}
                  className="rounded-xl px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] transition-all"
                  style={{
                    background: "var(--accent-cyan)",
                    color: "#061114",
                    boxShadow: "0 10px 24px rgba(6, 182, 212, 0.22)",
                  }}
                >
                  Open Insights
                </button>
                <button
                  type="button"
                  onClick={dismissNudge}
                  className="rounded-xl border px-3 py-1.5 text-[10px] font-semibold transition-colors"
                  style={{
                    borderColor: "var(--glass-border)",
                    background: "color-mix(in srgb, var(--bg-card) 78%, transparent)",
                    color: "var(--text-secondary)",
                  }}
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {open && criticalAlerts.length > 0 && (
        <div
          ref={criticalPanelRef}
          style={{
            top: 0,
            left: 0,
            opacity: 0,
            willChange: "transform, opacity",
            background: "var(--glass-bg)",
            borderColor: "rgba(239, 68, 68, 0.22)",
            boxShadow: "0 20px 56px rgba(0,0,0,0.34)",
          }}
          className="glass-card pointer-events-auto fixed z-[58] relative overflow-hidden rounded-[1.5rem] border"
          role="status"
          aria-live="polite"
        >
          <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-r from-red-500/18 via-red-500/8 to-transparent" />
          <div className="pointer-events-none absolute inset-y-4 left-0 w-1 rounded-r-full bg-red-400/80" />
          <div className="relative border-b border-slate-900/[0.06] px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-black uppercase tracking-[0.18em] text-[#DC2626]">
                  {criticalAlerts.length} Critical {criticalAlerts.length === 1 ? "Update" : "Updates"}
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-900/50">
                  Kept separate from the chat thread so investigation alerts stay visible.
                </p>
              </div>
              <button
                type="button"
                onClick={dismissAll}
                className="rounded-lg border border-slate-900/[0.08] bg-slate-900/[0.04] px-2.5 py-1 text-[10px] font-semibold text-slate-900/55 transition hover:bg-slate-900/[0.08] hover:text-slate-900/85"
              >
                Dismiss all
              </button>
            </div>
          </div>
          <div className="custom-scrollbar relative max-h-[inherit] space-y-3 overflow-y-auto px-4 py-4">
            {criticalAlerts.map((alert) => (
              <div
                key={alert.id}
                className="rounded-[1.35rem] border border-red-500/25 bg-red-500/[0.06] px-4 py-3"
              >
                <div className="flex items-start gap-2.5">
                  <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.55)]" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-semibold leading-snug text-red-700">{alert.title}</p>
                    <p className="mt-1 text-[11px] leading-relaxed text-slate-900/55">{alert.body}</p>
                    <div className="mt-2.5 flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => { dismiss(alert.id); handleSuggestionTap(alert.prompt); }}
                        className="rounded-xl bg-red-500/18 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-red-700 transition hover:bg-red-500/28"
                      >
                        Investigate
                      </button>
                      <button
                        type="button"
                        onClick={() => dismiss(alert.id)}
                        className="text-[10px] font-semibold text-slate-900/35 transition hover:text-slate-900/70"
                      >
                        Dismiss
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {!open && (
        <button
          ref={launcherRef}
          onPointerDown={(event) => startRailDrag(event, assistantLayout.buttonSize, assistantLayout.buttonSize)}
          onClick={() => {
            if (suppressClickRef.current) return;
            setOpen(true);
          }}
          style={{
            top: 0,
            left: 0,
            opacity: 0,
            width: assistantLayout.buttonSize,
            height: assistantLayout.buttonSize,
            willChange: "transform, opacity",
            transition: dragging ? "none" : "transform 0.6s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s ease",
          }}
          className={cn(
            // ── Outer button: NO transition-all, NO transform-based hover/active ──
            // transition-all conflicts with the imperative translate3d set by
            // applyFloatingTransforms and causes the rapid jitter/oscillation bug.
            // Scale and active effects live on the inner span (group-hover/group-active)
            // so they never touch the outer element's transform property.
            "group pointer-events-auto fixed z-[60] touch-none cursor-grab p-0 bg-transparent border-0 shadow-none outline-none active:cursor-grabbing"
          )}
          aria-label="Open Claim Assistant"
          title="Drag to place, click to open"
        >
          {/* Avatar — random mood swings, severity-locked when alerts active */}
          <span className="chat-assistant-avatar-stage absolute inset-0 flex items-center justify-center transition-transform duration-200 group-hover:scale-110 group-active:scale-95">
            <span className="chat-assistant-scan-ring" aria-hidden="true" />
            <span className="chat-assistant-signal-dot chat-assistant-signal-dot-a" aria-hidden="true" />
            <span className="chat-assistant-signal-dot chat-assistant-signal-dot-b" aria-hidden="true" />
            <BotAvatarCanvas mode={avatarMode} size={assistantLayout.buttonSize < 88 ? 68 : 80} />
          </span>
          {/* Alert badge */}
          {totalUnread > 0 && (
            <span className={cn(
              "absolute -top-0.5 -right-0.5 flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-[10px] font-black text-white shadow-lg",
              criticalCount > 0 ? "bg-red-500" : "bg-amber-500"
            )}>
              {totalUnread}
            </span>
          )}
        </button>
      )}

      {/* Assistant panel — anchored bottom-right, grows upward */}
       {open && (
         <div
           ref={panelRef}
           className={cn(
             "dashboard-panel pointer-events-auto fixed z-[60] flex max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-2xl",
             variantClasses.panelClass,
             dragging ? "select-none" : "transition-[width,height] duration-300"
           )}
           role="dialog"
           aria-modal="true"
           aria-labelledby="claim-assistant-title"
           style={{
             width: assistantLayout.panelWidth,
             height: assistantLayout.panelHeight,
             top: 0,
             left: 0,
             opacity: 0,
             willChange: "transform, opacity",
             transition: dragging ? "none" : "transform 0.6s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.3s ease, width 0.3s ease, height 0.3s ease",
             background: "linear-gradient(165deg, rgba(255,255,255,0.98) 0%, rgba(248,250,252,0.97) 45%, rgba(255,255,255,0.99) 100%)",
             backdropFilter: "blur(24px)",
             boxShadow: "var(--shadow-lg), inset 0 1px 0 rgba(255,255,255,0.6)",
             border: "1px solid var(--border-subtle)",
           }}
         >
          <div className={cn("dashboard-panel-accent", variantClasses.accentClass)} />
          <div className={cn("dashboard-panel-glow -top-8 -right-8", variantClasses.glowClass)} />
          {/* Header */}
          <div
            onPointerDown={(event) => startRailDrag(event, assistantLayout.panelWidth, assistantLayout.panelHeight)}
            className={cn(
              "dashboard-panel-header relative z-[2] flex min-h-[66px] shrink-0 touch-none cursor-grab items-center justify-between gap-3 border-b border-slate-900/[0.07] px-4 active:cursor-grabbing",
              variantClasses.headerClass
            )}
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="chat-assistant-header-avatar relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-900/[0.08] bg-slate-900/[0.04] shadow-[0_0_18px_rgba(0,216,214,0.14)] transition-[transform,box-shadow] duration-300 ease-out">
                <div className="transition-transform duration-300 ease-out">
                  <BotAvatarCanvas mode={avatarMode} size={assistantLayout.headerAvatarSize} />
                </div>
                <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-white bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]" />
              </div>
              <div className="min-w-0">
                <p id="claim-assistant-title" className="truncate text-[13.5px] font-black tracking-[0.06em] uppercase text-slate-900/90 leading-none">
                  {PRODUCT_ASSISTANT_NAME}
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-1">
              <button
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => { event.stopPropagation(); setExpanded((e) => !e); }}
                aria-label={expanded ? "Compact assistant window" : "Expand assistant window"}
                title={expanded ? "Compact window" : "Expand window"}
                className="flex h-9 w-9 touch-manipulation items-center justify-center rounded-lg border border-slate-900/[0.05] bg-slate-900/[0.04] text-slate-900/45 transition-colors hover:bg-slate-900/10 hover:text-slate-900 xl:h-8 xl:w-8"
              >
                {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              </button>

              <button
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => { event.stopPropagation(); clearChatHistory(); }}
                disabled={messages.length === 0}
                aria-label="Clear conversation"
                title="Clear conversation"
                className="flex h-9 w-9 touch-manipulation items-center justify-center rounded-lg border border-slate-900/[0.05] bg-slate-900/[0.04] text-slate-900/45 transition-colors hover:bg-slate-900/10 hover:text-slate-900 disabled:opacity-25 disabled:cursor-not-allowed xl:h-8 xl:w-8"
              >
                <RotateCcw size={13} />
              </button>

              <button
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => { event.stopPropagation(); setOpen(false); }}
                aria-label="Minimize assistant to bubble"
                title="Minimize to bubble"
                className="flex h-9 w-9 touch-manipulation items-center justify-center rounded-lg border border-slate-900/[0.05] bg-slate-900/[0.04] text-slate-900/45 transition-colors hover:bg-slate-900/10 hover:text-slate-900 xl:h-8 xl:w-8"
              >
                <Minus size={15} />
              </button>

              <button
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => { event.stopPropagation(); setOpen(false); }}
                aria-label="Close"
                className="flex h-9 w-9 touch-manipulation items-center justify-center rounded-lg border border-slate-900/[0.05] bg-slate-900/[0.04] text-slate-900/45 transition-colors hover:bg-red-500/20 hover:text-slate-900 xl:h-8 xl:w-8"
              >
                <X size={15} />
              </button>
            </div>
          </div>

          {/* ── Proactive Alert Feed ────────────────────────────────────── */}
          {secondaryAlerts.length > 0 && (
            <div className="relative z-[2] shrink-0 border-b border-slate-900/[0.06] px-3 py-2 space-y-1.5" style={{ background: "rgba(15,23,42,0.03)" }}>
              <div className="flex items-center justify-between mb-1">
                <span className="ui-chip-label text-slate-900/35 flex items-center gap-1.5">
                  <span className={cn("h-1.5 w-1.5 rounded-full", warningCount > 0 ? "bg-amber-400" : "bg-sky-400")}
                    style={{ animation: "neuralPulse 1.5s ease-in-out infinite" }} />
                  {warningCount > 0 ? `${warningCount} warning${warningCount > 1 ? "s" : ""}` : `${secondaryAlerts.length} update${secondaryAlerts.length > 1 ? "s" : ""}`}
                </span>
                <button type="button" onClick={dismissAll}
                  className="text-[10px] font-semibold text-slate-900/25 transition hover:text-slate-900/55">
                  Dismiss all
                </button>
              </div>
              {secondaryAlerts.map(alert => (
                <div key={alert.id}
                  className={cn("flex items-start gap-2.5 rounded-xl border px-3 py-2",
                    alert.severity === "critical"
                      ? "border-red-500/20 bg-red-500/[0.06]"
                      : alert.severity === "warning"
                      ? "border-amber-500/20 bg-amber-500/[0.05]"
                      : "border-slate-900/[0.07] bg-slate-900/[0.03]"
                  )}>
                  {/* Severity dot */}
                  <span className={cn("mt-[3px] h-2 w-2 shrink-0 rounded-full",
                    alert.severity === "critical" ? "bg-red-400" : alert.severity === "warning" ? "bg-amber-400" : "bg-sky-400"
                  )} />
                  <div className="min-w-0 flex-1">
                    <p className={cn("text-xs font-semibold leading-snug",
                      alert.severity === "critical" ? "text-red-600" : alert.severity === "warning" ? "text-amber-600" : "text-slate-900/75"
                    )}>{alert.title}</p>
                    <p className="mt-0.5 text-[10px] leading-relaxed text-slate-900/40">{alert.body}</p>
                    <div className="mt-1.5 flex items-center gap-2">
                      <button type="button"
                        onClick={() => { dismiss(alert.id); handleSuggestionTap(alert.prompt); }}
                        className={cn("rounded-lg px-2.5 py-1 text-[10px] font-bold transition-all",
                          alert.severity === "critical"
                            ? "bg-red-500/15 text-red-600 hover:bg-red-500/25"
                            : "bg-amber-500/12 text-amber-600 hover:bg-amber-500/22"
                        )}>
                        Investigate
                      </button>
                      <button type="button" onClick={() => dismiss(alert.id)}
                        className="text-[10px] text-slate-900/22 transition hover:text-slate-900/50">
                        Dismiss
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Messages */}
          <div className="custom-scrollbar relative z-[2] flex-1 space-y-3 overflow-y-auto px-4 py-4">

            {/* Welcome state — category tabs + 2-col icon grid */}
            {messages.length === 0 && !loading && (
              <div className="flex flex-col gap-3">
                {/* Greeting bubble */}
                <div className="flex gap-2.5 items-start">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl border border-slate-900/[0.08] bg-slate-900/[0.04]">
                    <Bot size={13} className="text-brand-primary" />
                  </div>
                  <div className={cn("rounded-2xl rounded-tl-sm px-3.5 py-2.5 text-sm text-slate-900/75 border border-slate-900/[0.08] bg-slate-900/[0.05] flex items-center gap-2", variantClasses.bubbleClass)}>
                    <Sparkles size={12} className="text-brand-primary shrink-0" />
                    What should we investigate?
                  </div>
                </div>

                {/* Context-aware smart suggestions (if available) */}
                {smartSuggestions.length > 0 && (
                  <div className="pl-9 flex flex-col gap-1">
                    <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-900/22 mb-0.5">Based on current context</p>
                    {smartSuggestions.slice(0, 2).map((s) => (
                      <button key={s} type="button" disabled={loading}
                        onClick={() => handleSuggestionTap(s)}
                        className="touch-manipulation flex items-center gap-2 rounded-xl border border-brand-primary/15 bg-brand-primary/[0.04] px-3 py-2 text-left text-xs font-semibold text-slate-900/65 transition-all hover:border-brand-primary/30 hover:bg-brand-primary/[0.08] hover:text-slate-900/90 disabled:opacity-40">
                        <span className="h-1.5 w-1.5 rounded-full bg-brand-primary/60 shrink-0" />
                        {s}
                      </button>
                    ))}
                  </div>
                )}

                {/* Category tabs */}
                <div className="pl-9">
                  <div className="flex gap-1 overflow-x-auto pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {(["all", "claims", "queue", "reports"] as WelcomeCategory[]).map((cat) => (
                      <button key={cat} type="button"
                        onClick={() => setWelcomeCategory(cat)}
                        className={cn(
                          "shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold capitalize transition-all",
                          welcomeCategory === cat
                            ? "bg-brand-primary/15 text-brand-primary border border-brand-primary/30"
                            : "border border-slate-900/[0.06] bg-slate-900/[0.03] text-slate-900/35 hover:text-slate-900/60 hover:bg-slate-900/[0.06]"
                        )}>
                        {cat === "all" ? "All" : cat === "claims" ? "Claims" : cat === "queue" ? "Queue" : "Reports"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 2-column icon-chip grid */}
                <div className="pl-9 grid grid-cols-2 gap-1.5">
                  {QUERY_SUGGESTIONS.filter(s => welcomeCategory === "all" || s.category === welcomeCategory).map((s) => {
                    const Icon = s.icon;
                    const colorMap: Record<string, string> = {
                      amber: "text-amber-600 bg-amber-400/10 border-amber-400/20",
                      red: "text-red-600 bg-red-400/10 border-red-400/20",
                      orange: "text-orange-600 bg-orange-400/10 border-orange-400/20",
                      purple: "text-fuchsia-600 bg-fuchsia-400/10 border-fuchsia-400/20",
                      cyan: "text-sky-600 bg-cyan-400/10 border-cyan-400/20",
                      fuchsia: "text-fuchsia-600 bg-fuchsia-400/10 border-fuchsia-400/20",
                      emerald: "text-emerald-600 bg-emerald-400/10 border-emerald-400/20",
                    };
                    const chipColor = s.color ? colorMap[s.color] : "text-slate-900/50 bg-slate-900/[0.04] border-slate-900/[0.08]";
                    return (
                      <button key={s.label} type="button" disabled={loading}
                        onClick={() => handleSuggestionTap(s.prompt)}
                        className="touch-manipulation flex flex-col gap-1.5 rounded-xl border border-slate-900/[0.07] bg-slate-900/[0.03] p-2.5 text-left transition-all hover:border-slate-900/[0.14] hover:bg-slate-900/[0.06] disabled:opacity-40 group">
                        {Icon && (
                          <span className={cn("inline-flex h-6 w-6 items-center justify-center rounded-lg border", chipColor)}>
                            <Icon size={11} />
                          </span>
                        )}
                        <span className="text-[11px] font-semibold text-slate-900/75 group-hover:text-slate-900/95 leading-tight">{s.label}</span>
                        <span className="text-[9px] text-slate-900/30 leading-tight">{s.description}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {messages.map((msg) => {
              const claimsPreview = getClaimsPreview(msg.data);
              const isLast = msg === messages[messages.length - 1];
              return (
                <div key={msg.id} className={cn("relative z-[2] flex flex-col", msg.role === "user" ? "items-end" : "items-start")}>
                  <div className={cn("flex gap-2 items-end max-w-[92%] group/bubble", msg.role === "user" && "flex-row-reverse")}>
                    <div className={cn("flex-shrink-0 flex h-6 w-6 items-center justify-center rounded-lg",
                      msg.role === "user" ? "border border-brand-primary/25 bg-brand-primary/15" : "border border-slate-900/[0.08] bg-slate-900/[0.04]"
                    )}>
                      {msg.role === "user"
                        ? <User size={11} className="text-brand-primary" />
                        : <Bot size={11} className="text-brand-primary" />}
                    </div>
                    <div className="relative">
                      <div className={cn(
                        "rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                        msg.role === "user"
                          ? "rounded-br-sm border border-brand-primary/20 bg-brand-primary/10 text-slate-900/90"
                          : "whitespace-pre-line rounded-bl-sm border border-slate-900/[0.07] bg-slate-900/[0.04] text-slate-900/75"
                      )}>
                        {msg.content}
                      </div>
                      {/* Copy button — appears on hover for assistant messages */}
                      {msg.role === "assistant" && (
                        <button
                          type="button"
                          onClick={() => copyMessage(msg.id, msg.content)}
                          title="Copy message"
                          className="absolute -right-6 top-1/2 -translate-y-1/2 opacity-0 group-hover/bubble:opacity-100 transition-opacity flex h-5 w-5 items-center justify-center rounded-md border border-slate-900/[0.08] bg-slate-900/[0.05] text-slate-900/30 hover:text-slate-900/70 hover:bg-slate-900/[0.10]"
                        >
                          {copiedMessageId === msg.id
                            ? <CheckCheck size={9} className="text-emerald-400" />
                            : <Copy size={9} />}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Claims data preview — compact inline */}
                  {msg.type === "data" && claimsPreview.length > 0 && (
                    <div className="mt-1.5 ml-8 w-full max-w-[92%] rounded-xl border border-slate-900/[0.07] bg-slate-900/[0.02] px-3 py-2">
                      <p className="ui-chip-label mb-1.5 text-slate-900/35">Preview · {claimsPreview.length} claims</p>
                      <div className="space-y-1">
                        {claimsPreview.slice(0, 3).map((claim: ClaimData) => (
                          <button key={claim.claim_reference} onClick={() => router.push(`/claims/${claim.claim_reference}`)}
                            className="flex w-full items-center justify-between rounded-lg px-1.5 py-1 transition-colors hover:bg-slate-900/[0.06]">
                            <span className="font-mono text-xs text-brand-primary">#{claim.claim_reference?.split("-").pop()}</span>
                            <span className="min-w-0 truncate pl-2 text-xs text-slate-900/40">{claim.patient_name}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* querySuggestions — crisp label only, no subcaption */}
                  {msg.querySuggestions && msg.querySuggestions.length > 0 && (
                    <div className="mt-1.5 ml-8 grid w-full max-w-[92%] gap-1 md:grid-cols-2">
                      {msg.querySuggestions.map((opt) => (
                        <button key={opt.label} type="button" disabled={loading}
                          onClick={() => handleSuggestionTap(opt.prompt)}
                          className="touch-manipulation rounded-xl border border-slate-900/[0.07] bg-slate-900/[0.03] px-3.5 py-2 text-left text-xs font-semibold text-slate-900/70 transition-all hover:border-slate-900/[0.14] hover:bg-slate-900/[0.07] hover:text-slate-900/90 disabled:opacity-40">
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* reportBuilder */}
                  {msg.reportBuilder && (
                    <div className="mt-1.5 ml-8 w-full max-w-[92%]">
                      <ReportBuilderCard defaultConfig={msg.reportBuilder} disabled={loading}
                        onGenerate={({ reportType, dateRange }) =>
                          submit(
                            `report_type=${REPORT_TYPE_TO_BACKEND[reportType]} date_range=${DATE_RANGE_TO_BACKEND[dateRange]}`,
                            `Generate ${reportType} report (${dateRange})`
                          )
                        }
                      />
                    </div>
                  )}

                  {/* Follow-up suggestions — horizontal scrollable pills shown directly */}
                  {msg.role === "assistant" && isLast && msg.followUps && msg.followUps.length > 0 && !loading && dismissedFollowUpMessageId !== msg.id && (
                    <div className="mt-1.5 ml-8 w-full max-w-[90%]">
                      <div className="flex items-center gap-1 mb-1.5">
                        <ChevronRight size={9} className="text-slate-900/20" />
                        <span className="text-[9px] font-black uppercase tracking-[0.16em] text-slate-900/25">Next steps</span>
                        <button
                          type="button"
                          onClick={() => setDismissedFollowUpMessageId(msg.id)}
                          className="ml-auto text-[9px] text-slate-900/18 hover:text-slate-900/45 transition-colors"
                          title="Dismiss"
                        >
                          ✕
                        </button>
                      </div>
                      <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        {msg.followUps.filter(s => s !== "✏ Write my own").map((s) => (
                          <button key={s} type="button" disabled={loading}
                            onClick={() => handleSuggestionTap(s)}
                            className="shrink-0 touch-manipulation rounded-xl border border-slate-900/[0.07] bg-slate-900/[0.03] px-3 py-1.5 text-left text-[11px] font-semibold text-slate-900/60 transition-all hover:border-slate-900/[0.14] hover:bg-slate-900/[0.07] hover:text-slate-900/90 disabled:opacity-40 whitespace-nowrap">
                            {s}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {loading && (
              <div className="flex gap-2 items-end">
                <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-slate-900/[0.08] bg-slate-900/[0.04]">
                  <Bot size={11} className="text-brand-primary" />
                </div>
                <div className="flex items-center gap-2 rounded-2xl rounded-bl-sm border border-slate-900/[0.07] bg-slate-900/[0.04] px-3.5 py-2.5">
                  <Loader2 size={11} className="animate-spin text-brand-primary" />
                  <span className="ui-chip-label text-slate-900/35">Checking...</span>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input — always visible with shortcuts bar */}
          <div className="relative z-[2] shrink-0 border-t border-slate-900/[0.06] px-3 pb-3 pt-2.5 space-y-2">
            {/* Shortcut pills — scrollable horizontal row */}
            <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {SHORTCUTS.map((shortcut) => (
                <button
                  key={shortcut.label}
                  type="button"
                  disabled={loading}
                  onClick={() => handleSuggestionTap(shortcut.prompt)}
                  className="shrink-0 inline-flex items-center gap-1 rounded-full border border-slate-900/[0.07] bg-slate-900/[0.03] px-2.5 py-1 text-[10px] font-semibold text-slate-900/45 transition-all hover:border-brand-primary/25 hover:bg-brand-primary/[0.06] hover:text-brand-primary/80 disabled:opacity-30 whitespace-nowrap"
                >
                  <shortcut.icon size={9} />
                  {shortcut.label}
                </button>
              ))}
            </div>
            {/* Always-visible textarea */}
            <div className="ui-form-field relative flex items-end gap-2 rounded-2xl px-4 py-2.5">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Ask about claims, metrics, review queue..."
                rows={1}
                disabled={loading}
                className="max-h-28 flex-1 resize-none overflow-y-auto bg-transparent text-sm leading-relaxed text-slate-900/85 outline-none placeholder:text-slate-900/25"
              />
              <button
                onClick={() => submit(input)}
                disabled={!input.trim() || loading}
                className="flex h-9 w-9 shrink-0 touch-manipulation items-center justify-center rounded-xl bg-brand-primary transition-all hover:shadow-[0_0_18px_rgba(0,216,214,0.4)] disabled:cursor-not-allowed disabled:opacity-30"
              >
                {loading
                  ? <Loader2 size={12} className="animate-spin text-white" />
                  : <Send size={11} className="text-white" strokeWidth={2.5} />}
              </button>
            </div>
          </div>
        </div>
      )}
      </>
  );

  if (!mounted) return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[60] overflow-hidden">
      {assistantOverlay}
    </div>,
    document.body
  );
}
