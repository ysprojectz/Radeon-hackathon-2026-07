"use client";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { ComponentType, TouchEvent as ReactTouchEvent } from "react";
import { useRouter } from "next/navigation";
import {
  X, Send, Loader2, Bot, User, Minimize2, Maximize2, ArrowUpRight, Download, FileText, Activity, Trash2, Sparkles, Minus,
  Search, BarChart3, LifeBuoy, Lightbulb, Zap, Shield, Terminal,
} from "lucide-react";
import { PRODUCT_ASSISTANT_NAME } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { BotAvatarCanvas, MODE_SEQUENCE, MODE_META, type AvatarMode } from "./BotAvatarCanvas";
import { NexusAvatar } from "./NexusAvatar";

interface ChatReportOption {
  id: string;
  label: string;
  description: string;
}

interface ChatReportOptions {
  reportTypes: ChatReportOption[];
  dateRanges: ChatReportOption[];
  defaultReportType: string;
  defaultDateRange: string;
}

interface ChatDashboardOptions {
  actionId: string;
  title: string;
  description: string;
  dateRanges: ChatReportOption[];
  defaultDateRange: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  ts: Date;
  contextUsed?: string[];
  action?: {
    label: string;
    href: string;
  };
  exportCsv?: string;
  exportFilename?: string;
  reportOptions?: ChatReportOptions;
  dashboardOptions?: ChatDashboardOptions;
}

const MODE_DURATION_MS = 7000;
const CHAT_REQUEST_TIMEOUT_MS = 12_000;

const WELCOME_MESSAGE =
  "Ask about claims, denials, policies, reports, or navigation. I will keep answers short and operational.";

const QUICK_PROMPTS = [
  "Summarize today's KPIs",
  "List claims needing review",
  "Top denial drivers right now",
  "Generate a report",
  "System health summary",
  "Open claims page",
];

const QUICK_ACTIONS: Array<{
  label: string;
  description: string;
  prompt: string;
  icon: ComponentType<{ className?: string; size?: number }>;
  color: string;
}> = [
  { label: "Query",    description: "Find claims",   prompt: "Show high-risk claims and pending exceptions", icon: Search,   color: "#06b6d4" },
  { label: "Report",   description: "Build export",  prompt: "Generate a report",                            icon: BarChart3, color: "#8b5cf6" },
  { label: "Assist",   description: "Guide work",    prompt: "What should I review next?",                   icon: LifeBuoy,  color: "#10b981" },
  { label: "Insights", description: "Explain trends",prompt: "Top denial drivers right now",                 icon: Lightbulb, color: "#f59e0b" },
];

const SMART_SUGGESTIONS = [
  { match: /\b(claim|claims|case|member|patient|status)\b/i, prompts: ["Show high-risk claims", "List pending claims", "Open claims page"] },
  { match: /\b(deny|denial|rejection|reject|driver|reason)\b/i, prompts: ["Top denial drivers right now", "Show denied claims summary", "Generate denial report"] },
  { match: /\b(report|csv|download|export|analytics)\b/i, prompts: ["Generate a report", "Export processed claims report", "Open reports"] },
  { match: /\b(policy|coverage|clause|benefit|eligibility)\b/i, prompts: ["Find policy coverage gaps", "Open policy library", "Summarize policy exceptions"] },
  { match: /\b(review|hitl|manual|queue|approval)\b/i, prompts: ["List claims needing review", "Open review queue", "Summarize HITL workload"] },
  { match: /\b(health|system|api|agent|pipeline|latency)\b/i, prompts: ["System health summary", "Show pipeline failures", "Open admin settings"] },
];

function getFollowUpSuggestions(reply: string, contextUsed: string[]): string[] {
  const r = reply.toLowerCase();
  const ctx = contextUsed.map((c) => c.toLowerCase()).join(" ");

  if (r.includes("denial") || r.includes("denied") || r.includes("driver") || ctx.includes("denial")) {
    return ["Download denial report", "Show affected claims", "Open review queue", "Break down by provider"];
  }
  if (r.includes("hitl") || r.includes("manual review") || ctx.includes("hitl") || ctx.includes("review queue")) {
    return ["Open review queue", "Export review list", "Show oldest first", "Summarize HITL workload"];
  }
  if (r.includes("kpi") || r.includes("denial rate") || r.includes("auto-adj") || ctx.includes("kpi") || r.includes("total claims")) {
    return ["Show 30-day trend", "Break down by market", "Generate full report", "List claims needing review"];
  }
  if (r.includes("policy") || r.includes("coverage") || r.includes("clause") || ctx.includes("policy")) {
    return ["Find coverage gaps", "Open policy library", "Check deductible limits", "Show policy exceptions"];
  }
  if (r.includes("health") || r.includes("service") || r.includes("api status") || r.includes("uptime")) {
    return ["Open admin settings", "Refresh health status", "View audit logs"];
  }
  if ((r.includes("report") && (r.includes("prepared") || r.includes("ready") || r.includes("file"))) || r.includes("csv")) {
    return ["Generate another report", "View pipeline report", "Open reports page"];
  }
  if (r.includes("claim") || r.includes("billed") || r.includes("settlement") || r.includes("conf:")) {
    return ["Show claim details", "Check HITL queue", "Export claim data", "Show denial reasons"];
  }
  if (r.includes("no claims") || r.includes("unavailable") || r.includes("not found")) {
    return ["Summarize today's KPIs", "List claims needing review", "System health summary", "Generate a report"];
  }
  return QUICK_PROMPTS.slice(0, 4);
}

const CHAT_WIDGET_POSITION_KEY = "claims-chat-right-rail-position";
const CHAT_WIDGET_STORAGE_KEY  = "claims-chat-anchor-y";
const CHAT_EDGE_MARGIN   = 16;
const CHAT_COLLAPSED_SIZE = 56;
const CHAT_COMPACT_HEIGHT = 580;
const CHAT_EXPANDED_HEIGHT = 700;
const CHAT_COMPACT_WIDTH  = 390;
const CHAT_EXPANDED_WIDTH = 530;
const TOUCH_POINTER_ID   = -2;

function getViewportSize() {
  if (typeof window === "undefined") return { width: CHAT_COMPACT_WIDTH + CHAT_EDGE_MARGIN * 2, height: 900 };
  const vv = window.visualViewport;
  return { width: Math.round(vv?.width ?? window.innerWidth), height: Math.round(vv?.height ?? window.innerHeight) };
}

function clampPosition(nextX: number, nextY: number, vw: number, vh: number, ww: number, wh: number) {
  const maxX = Math.max(CHAT_EDGE_MARGIN, vw - ww - CHAT_EDGE_MARGIN);
  const fixedX = maxX; // Freeze to right side rail

  const minY = CHAT_EDGE_MARGIN;
  const maxY = Math.max(CHAT_EDGE_MARGIN, vh - wh - CHAT_EDGE_MARGIN);
  return { x: fixedX, y: Math.min(Math.max(nextY, minY), maxY) };
}

function getDefaultPosition(vw: number, vh: number) {
  const maxX = Math.max(CHAT_EDGE_MARGIN, vw - CHAT_COLLAPSED_SIZE - CHAT_EDGE_MARGIN);
  return clampPosition(maxX, Math.round(vh * 0.68), vw, vh, CHAT_COLLAPSED_SIZE, CHAT_COLLAPSED_SIZE);
}

function triggerCsvDownload(base64Csv: string, filename: string) {
  let csvText = base64Csv;
  try { csvText = atob(base64Csv); } catch { csvText = base64Csv; }
  const blob = new Blob([csvText], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

async function sendChat(messages: { role: string; content: string }[]): Promise<{
  reply: string; contextUsed: string[]; exportCsv?: string; exportFilename?: string;
  reportOptions?: ChatReportOptions; dashboardOptions?: ChatDashboardOptions;
}> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), CHAT_REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch("/api/v1/chat", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "include", signal: controller.signal, body: JSON.stringify({ messages }) });
  } finally {
    window.clearTimeout(timeout);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { throw new Error(typeof data.detail === "string" ? data.detail : data.reply ?? `HTTP ${res.status}`); }
  return {
    reply: data.reply ?? "No response.",
    contextUsed: data.context_used ?? [],
    exportCsv: data.export_csv ?? undefined,
    exportFilename: data.export_filename ?? undefined,
    reportOptions: data.report_options ? { reportTypes: data.report_options.report_types ?? [], dateRanges: data.report_options.date_ranges ?? [], defaultReportType: data.report_options.default_report_type ?? "processed", defaultDateRange: data.report_options.default_date_range ?? "last_30_days" } : undefined,
    dashboardOptions: data.dashboard_options ? { actionId: data.dashboard_options.action_id ?? "", title: data.dashboard_options.title ?? "Dashboard Insight", description: data.dashboard_options.description ?? "", dateRanges: data.dashboard_options.date_ranges ?? [], defaultDateRange: data.dashboard_options.default_date_range ?? "last_30_days" } : undefined,
  };
}

function sanitizeChatError(err: unknown): string {
  const raw = err instanceof Error ? err.message : "";
  const lower = raw.toLowerCase();
  if (lower.includes("provider") || lower.includes("groq") || lower.includes("anthropic") || lower.includes("llm") || lower.includes("openai") || lower.includes("nvidia") || lower.includes("api key") || lower.includes("http 502")) return "Assistant temporarily unavailable. Try again shortly.";
  if (lower.includes("http 401") || lower.includes("http 403")) return "Assistant access is currently restricted.";
  if (lower.includes("http 500") || lower.includes("http 503") || lower.includes("connection")) return "Assistant temporarily unavailable. Try again shortly.";
  return "Assistant temporarily unavailable. Try again shortly.";
}

function buildWelcomeMessage(): Message {
  return { id: "welcome", role: "assistant", content: WELCOME_MESSAGE, ts: new Date() };
}

function getSmartSuggestions(input: string, lastAssistant?: string) {
  const source = `${input} ${lastAssistant ?? ""}`.trim();
  if (!source) return QUICK_PROMPTS.slice(0, 4);
  const matched = SMART_SUGGESTIONS.find((g) => g.match.test(source));
  const prompts = matched?.prompts ?? QUICK_PROMPTS;
  return Array.from(new Set([...prompts, ...QUICK_PROMPTS])).slice(0, 4);
}

function MessageContent({ message }: { message: Message }) {
  if (message.role === "user") return <>{message.content}</>;

  // Simple Markdown-ish parser for assistant responses
  const blocks = message.content.split("\n\n").map((block) => block.trim()).filter(Boolean);

  return (
    <div className="space-y-3">
      {blocks.map((block, bi) => {
        // Detect table-like structures (lines with pipes |)
        const lines = block.split("\n");
        const isTable = lines.length > 1 && lines.every(l => l.includes("|"));

        if (isTable) {
          const rows = lines.map(l => l.split("|").map(c => c.trim()).filter(Boolean));
          return (
            <div key={`block-${bi}`} className="my-2 overflow-hidden rounded-lg border border-white/10 bg-white/5">
              <div className="grid grid-cols-[auto_1fr] divide-x divide-white/10">
                {rows.map((row, ri) => (
                  <div key={`row-${ri}`} className="contents">
                    <div className={cn("px-2 py-1.5 text-[10px] font-bold text-cyan-300/90 bg-white/5", ri === 0 && "border-b border-white/10")}>{row[0]}</div>
                    <div className={cn("px-2 py-1.5 text-[10px] text-white/70", ri === 0 && "border-b border-white/10")}>{row[1]}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        }

        // Detect list items
        if (lines.length > 1 && lines.some(l => /^\s*[-*•]\s*/.test(l))) {
          return (
            <ul key={`block-${bi}`} className="space-y-1.5">
              {lines.map((line, li) => (
                <li key={`line-${li}`} className="flex gap-2.5 items-start">
                  <span className="mt-[0.6em] h-1 w-1 shrink-0 rounded-full bg-[#06b6d4]/70" />
                  <span className="flex-1">{formatInline(line.replace(/^\s*[-*•]\s*/, ""))}</span>
                </li>
              ))}
            </ul>
          );
        }

        // Default paragraph
        return <p key={`block-${bi}`}>{formatInline(block)}</p>;
      })}
    </div>
  );
}

/**
 * Basic bolding/inline formatting
 */
function formatInline(text: string) {
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="font-bold text-cyan-200/90">{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

function detectNavigationIntent(input: string): { href: string; label: string; reply: string } | null {
  const normalized = input.trim().toLowerCase();
  if (!normalized) return null;
  const isNavReq = /\b(open|launch|go to|goto|take me to|show|view|display|navigate|redirect|bring me to|move to|switch to|pull up|visit)\b/.test(normalized) || /\b(page|panel|screen|section|tab|workspace|control)\b/.test(normalized);
  if (!isNavReq) return null;
  const routeMap: Array<{ match: RegExp; href: string; label: string; reply: string }> = [
    { match: /\b(audit|audit trail|security audit|audit logs?|security center)\b/, href: "/admin/audit", label: "Open Audit & Security", reply: "Opening audit and security." },
    { match: /\b(report|reports|reporting|analytics report|admin reports?)\b/, href: "/reports", label: "Open Reports", reply: "Opening reports." },
    { match: /\b(configuration|system configuration|config|llm config|ai config|rules config|admin configuration)\b/, href: "/master-settings", label: "Open Master Settings", reply: "Opening master settings." },
    { match: /\b(admin settings|master settings|control settings|system settings|security settings)\b/, href: "/master-settings", label: "Open Master Settings", reply: "Opening master settings." },
    // /admin/flows and /admin/hms routes removed — pages do not exist
    { match: /\b(policy library|admin policies|policy documents?|policy admin)\b/, href: "/admin/policies", label: "Open Policy Library", reply: "Opening the policy library." },
    { match: /\b(admin|admin control|admin control page|control page|control plane|admin panel|admin dashboard|admin console|control center|users?|user management)\b/, href: "/admin", label: "Open Admin Settings", reply: "Opening admin settings." },
    { match: /\b(claims|claims list|claim list|all claims|claim search|claim register)\b/, href: "/claims", label: "Open Claims List", reply: "Opening the claims list." },
    { match: /\b(review queue|manual review|human review|hitl|pending reviews?|review worklist)\b/, href: "/hitl", label: "Open Review Queue", reply: "Opening the review queue." },
    { match: /\b(policy|policies|coverage|benefits?)\b/, href: "/policies", label: "Open Policies", reply: "Opening the policies page." },
    { match: /\b(submit|new claim|claim submission|create claim|upload claim|file claim|start claim)\b/, href: "/submit", label: "Open Claim Submission", reply: "Opening the claim submission workspace." },
    { match: /\b(profile|my profile|account profile)\b/, href: "/profile", label: "Open Profile", reply: "Opening your profile." },
    { match: /\b(settings|my settings|account settings|user settings)\b/, href: "/settings", label: "Open Settings", reply: "Opening settings." },
    { match: /\b(dashboard|home|overview|main screen|landing)\b/, href: "/", label: "Open Dashboard", reply: "Opening the dashboard." },
  ];
  return routeMap.find((r) => r.match.test(normalized)) ?? null;
}

function ReportOptionsCard({ options, disabled, onGenerate }: { options: ChatReportOptions; disabled: boolean; onGenerate: (reportType: string, dateRange: string, reportLabel: string, dateLabel: string) => void }) {
  const [reportType, setReportType] = useState(options.defaultReportType);
  const [dateRange, setDateRange]   = useState(options.defaultDateRange);
  const selectedReport = options.reportTypes.find((o) => o.id === reportType);
  const selectedRange  = options.dateRanges.find((o) => o.id === dateRange);
  return (
    <div className="mt-2 w-full rounded-xl border border-[#06b6d4]/15 bg-[#06b6d4]/[0.04] p-3">
      <div className="mb-2 flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.18em] text-[#06b6d4]/60">
        <FileText size={9} className="text-[#06b6d4]" />
        Report Builder
      </div>
      <div className="space-y-2">
        <label className="block">
          <span className="mb-1 block text-[9px] font-semibold uppercase tracking-wider text-white/35">Report Type</span>
          <select value={reportType} onChange={(e) => setReportType(e.target.value)} disabled={disabled} className="w-full rounded-lg border border-white/[0.07] bg-black/40 px-2.5 py-1.5 text-[11px] text-white/75 outline-none transition focus:border-[#06b6d4]/30 disabled:opacity-40">
            {options.reportTypes.map((o) => <option key={o.id} value={o.id} className="bg-[#0d0d12] text-white">{o.label}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[9px] font-semibold uppercase tracking-wider text-white/35">Date Range</span>
          <select value={dateRange} onChange={(e) => setDateRange(e.target.value)} disabled={disabled} className="w-full rounded-lg border border-white/[0.07] bg-black/40 px-2.5 py-1.5 text-[11px] text-white/75 outline-none transition focus:border-[#06b6d4]/30 disabled:opacity-40">
            {options.dateRanges.map((o) => <option key={o.id} value={o.id} className="bg-[#0d0d12] text-white">{o.label}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => onGenerate(reportType, dateRange, selectedReport?.label ?? reportType, selectedRange?.label ?? dateRange)} disabled={disabled} className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-[#10b981]/30 bg-[#10b981]/12 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[#10b981] transition hover:bg-[#10b981]/20 disabled:opacity-40">
          <Download size={10} />Generate Report
        </button>
      </div>
    </div>
  );
}

function DashboardOptionsCard({ options, disabled, onGenerate }: { options: ChatDashboardOptions; disabled: boolean; onGenerate: (actionId: string, dateRange: string, title: string, dateLabel: string) => void }) {
  const [dateRange, setDateRange] = useState(options.defaultDateRange);
  const selectedRange = options.dateRanges.find((o) => o.id === dateRange);
  return (
    <div className="mt-2 w-full rounded-xl border border-[#10b981]/15 bg-[#10b981]/[0.04] p-3">
      <div className="mb-1 flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.18em] text-[#10b981]/60">
        <Activity size={9} className="text-[#10b981]" />{options.title}
      </div>
      {options.description && <p className="mb-2 text-[10px] leading-relaxed text-white/30">{options.description}</p>}
      <label className="block">
        <span className="mb-1 block text-[9px] font-semibold uppercase tracking-wider text-white/35">Range</span>
        <select value={dateRange} onChange={(e) => setDateRange(e.target.value)} disabled={disabled} className="w-full rounded-lg border border-white/[0.07] bg-black/40 px-2.5 py-1.5 text-[11px] text-white/75 outline-none transition focus:border-[#10b981]/30 disabled:opacity-40">
          {options.dateRanges.map((o) => <option key={o.id} value={o.id} className="bg-[#0d0d12] text-white">{o.label}</option>)}
        </select>
      </label>
      <button type="button" onClick={() => onGenerate(options.actionId, dateRange, options.title, selectedRange?.label ?? dateRange)} disabled={disabled || !options.actionId} className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-[#10b981]/30 bg-[#10b981]/12 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[#10b981] transition hover:bg-[#10b981]/20 disabled:opacity-40">
        <Activity size={10} />Generate
      </button>
    </div>
  );
}

function AvatarRenderer({ mode, size = 56 }: { mode: AvatarMode; size?: number }) {
  // AXIOM handles sentinel, neural, thinking, searching and all primary AI modes
  const nexusModes: AvatarMode[] = [
    "sentinel","neural","thinking","searching","assisting",
    "monitoring","coding","sleeping","dreaming","celebrating",
    "idle","chatboticon",
  ];
  if (nexusModes.includes(mode)) return <NexusAvatar mode={mode} size={size} />;
  return <BotAvatarCanvas mode={mode} size={size} />;
}

/* ── Typing wave indicator ─────────────────────────────────────────────────── */
function TypingWave() {
  return (
    <span className="flex items-end gap-[3px] h-4">
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className="w-[3px] rounded-full bg-[#06b6d4]/60"
          style={{ animation: `waveBar 1s ease-in-out ${i * 0.1}s infinite`, height: "6px" }}
        />
      ))}
    </span>
  );
}

export function ChatWidget() {
  const router = useRouter();
  const [open, setOpen]         = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [avatarMode, setAvatarMode] = useState<AvatarMode>("sentinel");
  const [showModeLabel, setShowModeLabel] = useState(false);
  const modeLabelKeyRef = useRef(0);
  const [messages, setMessages] = useState<Message[]>(() => [buildWelcomeMessage()]);
  const [input, setInput]     = useState("");
  const [loading, setLoading] = useState(false);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const [inputFocused, setInputFocused] = useState(false);
  const [clockStr, setClockStr] = useState("");
  const bottomRef      = useRef<HTMLDivElement>(null);
  const inputRef       = useRef<HTMLTextAreaElement>(null);
  const animatedIdsRef = useRef<Set<string>>(new Set());
  const dragStateRef   = useRef({ active: false, moved: false, pointerId: -1, offsetX: 0, offsetY: 0, startClientX: 0, startClientY: 0 });
  const inFlightRequestRef = useRef(false);

  const panelHeight = expanded ? CHAT_EXPANDED_HEIGHT : CHAT_COMPACT_HEIGHT;
  const panelWidth  = expanded ? CHAT_EXPANDED_WIDTH : CHAT_COMPACT_WIDTH;
  const { width: viewportWidth, height: viewportHeight } = getViewportSize();
  const resolvedPanelHeight = Math.min(panelHeight, viewportHeight - CHAT_EDGE_MARGIN * 2);
  const resolvedPanelWidth  = Math.min(panelWidth, viewportWidth - CHAT_EDGE_MARGIN * 2);
  const basePosition = position ?? { x: 0, y: 96 };
  const resolvedPosition = clampPosition(basePosition.x, basePosition.y, viewportWidth, viewportHeight, open ? resolvedPanelWidth : CHAT_COLLAPSED_SIZE, open ? resolvedPanelHeight : CHAT_COLLAPSED_SIZE);
  const hasUserConversation = messages.some((m) => m.role === "user");
  const lastAssistantMessage = [...messages].reverse().find((m) => m.role === "assistant" && m.id !== "welcome");
  const suggestions = useMemo(() => {
    if (hasUserConversation && lastAssistantMessage) {
      return getFollowUpSuggestions(lastAssistantMessage.content, lastAssistantMessage.contextUsed ?? []);
    }
    return getSmartSuggestions(input, lastAssistantMessage?.content);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input, lastAssistantMessage?.content, lastAssistantMessage?.contextUsed, hasUserConversation]);

  useEffect(() => { if (open) bottomRef.current?.scrollIntoView({ behavior: "auto", block: "end" }); }, [messages, open]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 120); }, [open]);

  // Live clock — updates every minute
  useEffect(() => {
    function tick() {
      setClockStr(new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false }));
    }
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const vp = getViewportSize();
    const stored = window.localStorage.getItem(CHAT_WIDGET_POSITION_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored) as { x?: number; y?: number };
        const fallback = getDefaultPosition(vp.width, vp.height);
        setPosition(clampPosition(Number.isFinite(parsed?.x) ? Number(parsed.x) : fallback.x, Number.isFinite(parsed?.y) ? Number(parsed.y) : fallback.y, vp.width, vp.height, CHAT_COLLAPSED_SIZE, CHAT_COLLAPSED_SIZE));
        return;
      } catch { /* fall through */ }
    }
    const legacy = window.localStorage.getItem(CHAT_WIDGET_STORAGE_KEY);
    const fb = getDefaultPosition(vp.width, vp.height);
    setPosition(clampPosition(fb.x, legacy && Number.isFinite(Number(legacy)) ? Number(legacy) : fb.y, vp.width, vp.height, CHAT_COLLAPSED_SIZE, CHAT_COLLAPSED_SIZE));
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || position === null) return;
    window.localStorage.setItem(CHAT_WIDGET_POSITION_KEY, JSON.stringify({ x: Math.round(position.x), y: Math.round(position.y) }));
  }, [position]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleResize = () => {
      const vp = getViewportSize();
      setPosition((cur) => { const fb = getDefaultPosition(vp.width, vp.height); return clampPosition(cur?.x ?? fb.x, cur?.y ?? fb.y, vp.width, vp.height, open ? resolvedPanelWidth : CHAT_COLLAPSED_SIZE, open ? resolvedPanelHeight : CHAT_COLLAPSED_SIZE); });
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [open, resolvedPanelHeight, resolvedPanelWidth]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const vp = getViewportSize();
    setPosition((cur) => { const fb = getDefaultPosition(vp.width, vp.height); return clampPosition(cur?.x ?? fb.x, cur?.y ?? fb.y, vp.width, vp.height, open ? resolvedPanelWidth : CHAT_COLLAPSED_SIZE, open ? resolvedPanelHeight : CHAT_COLLAPSED_SIZE); });
  }, [open, expanded, resolvedPanelHeight, resolvedPanelWidth]);

  useEffect(() => {
    function updateDrag(clientX: number, clientY: number) {
      const vp = getViewportSize();
      const ww = open ? resolvedPanelWidth : CHAT_COLLAPSED_SIZE;
      const next = clampPosition(clientX - dragStateRef.current.offsetX, clientY - dragStateRef.current.offsetY, vp.width, vp.height, ww, open ? resolvedPanelHeight : CHAT_COLLAPSED_SIZE);
      if (Math.abs(clientX - dragStateRef.current.startClientX) > 4 || Math.abs(clientY - dragStateRef.current.startClientY) > 4) dragStateRef.current.moved = true;
      setPosition(next);
    }
    function finishDrag() { dragStateRef.current.active = false; window.setTimeout(() => { dragStateRef.current.moved = false; }, 0); }
    function onPointerMove(e: PointerEvent) { if (!dragStateRef.current.active || e.pointerId !== dragStateRef.current.pointerId) return; e.preventDefault(); updateDrag(e.clientX, e.clientY); }
    function onPointerUp(e: PointerEvent) { if (!dragStateRef.current.active || e.pointerId !== dragStateRef.current.pointerId) return; finishDrag(); }
    function onTouchMove(e: TouchEvent) { if (!dragStateRef.current.active || dragStateRef.current.pointerId !== TOUCH_POINTER_ID) return; const t = e.touches[0]; if (!t) return; e.preventDefault(); updateDrag(t.clientX, t.clientY); }
    function onTouchEnd() { if (!dragStateRef.current.active || dragStateRef.current.pointerId !== TOUCH_POINTER_ID) return; finishDrag(); }
    window.addEventListener("pointermove", onPointerMove, { passive: false });
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("touchcancel", onTouchEnd);
    return () => { window.removeEventListener("pointermove", onPointerMove); window.removeEventListener("pointerup", onPointerUp); window.removeEventListener("pointercancel", onPointerUp); window.removeEventListener("touchmove", onTouchMove); window.removeEventListener("touchend", onTouchEnd); window.removeEventListener("touchcancel", onTouchEnd); };
  }, [open, resolvedPanelHeight, resolvedPanelWidth]);

  useEffect(() => {
    if (loading) { setAvatarMode("thinking"); return; }
    if (open) { setAvatarMode("sentinel"); return; }
    let idx = MODE_SEQUENCE.indexOf(avatarMode === "thinking" ? "sentinel" : avatarMode);
    const timer = setInterval(() => {
      idx = (idx + 1) % MODE_SEQUENCE.length;
      const next = MODE_SEQUENCE[idx];
      setAvatarMode(next);
      modeLabelKeyRef.current += 1;
      setShowModeLabel(true);
      setTimeout(() => setShowModeLabel(false), 2700);
    }, MODE_DURATION_MS);
    return () => clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, open]);

  const startDrag = useCallback((clientX: number, clientY: number, pointerId: number, target?: EventTarget | null) => {
    dragStateRef.current = { active: true, moved: false, pointerId, offsetX: clientX - resolvedPosition.x, offsetY: clientY - resolvedPosition.y, startClientX: clientX, startClientY: clientY };
    if (target && (target as Element).setPointerCapture) { try { (target as Element).setPointerCapture(pointerId); } catch { /* ignore */ } }
  }, [resolvedPosition.x, resolvedPosition.y]);

  const startTouchDrag = useCallback((e: ReactTouchEvent<HTMLElement>) => {
    if (dragStateRef.current.active) return;
    const t = e.touches[0]; if (!t) return;
    startDrag(t.clientX, t.clientY, TOUCH_POINTER_ID, e.currentTarget);
  }, [startDrag]);

  const submit = useCallback(async (text: string, displayText?: string) => {
    const trimmed = text.trim();
    if (!trimmed || loading || inFlightRequestRef.current) return;
    inFlightRequestRef.current = true;
    const displayContent = displayText?.trim() || trimmed;
    const userMsg: Message = { id: crypto.randomUUID(), role: "user", content: displayContent, ts: new Date() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    const navIntent = detectNavigationIntent(trimmed);
    if (navIntent) {
      router.push(navIntent.href);
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", content: navIntent.reply, ts: new Date(), action: { label: navIntent.label, href: navIntent.href } }]);
      inFlightRequestRef.current = false;
      return;
    }
    setLoading(true);
    try {
      const history = [...messages, { ...userMsg, content: trimmed }].filter((m) => m.id !== "welcome").map((m) => ({ role: m.role, content: m.content }));
      const { reply, contextUsed, exportCsv, exportFilename, reportOptions, dashboardOptions } = await sendChat(history);
      if (exportCsv && exportFilename) triggerCsvDownload(exportCsv, exportFilename);
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", content: reply, ts: new Date(), contextUsed, exportCsv, exportFilename, reportOptions, dashboardOptions }]);
    } catch (err) {
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "assistant", content: sanitizeChatError(err), ts: new Date() }]);
    } finally { inFlightRequestRef.current = false; setLoading(false); }
  }, [messages, loading, router]);

  const generateReport = useCallback((reportType: string, dateRange: string, reportLabel: string, dateLabel: string) => { submit(`Generate report: report_type=${reportType} date_range=${dateRange}`, `Generate ${reportLabel} report for ${dateLabel}`); }, [submit]);
  const generateDashboardAction = useCallback((actionId: string, dateRange: string, title: string, dateLabel: string) => { submit(`Generate dashboard insight: dashboard_action=${actionId} date_range=${dateRange}`, `${title} for ${dateLabel}`); }, [submit]);
  const clearConversation = useCallback(() => { if (loading) return; setMessages([buildWelcomeMessage()]); setInput(""); setTimeout(() => inputRef.current?.focus(), 50); }, [loading]);
  const handleToggleClick = useCallback(() => { if (dragStateRef.current.moved) return; setOpen(true); }, []);
  const minimizeChat = useCallback(() => setOpen(false), []);
  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(input); } };

  return (
    <div data-theme="dark">
      {/* ── Floating toggle ─────────────────────────────────────────────── */}
      <div
        className="fixed z-[60]"
        style={{
          top: resolvedPosition.y, left: resolvedPosition.x,
          opacity: open ? 0 : 1,
          transform: open ? "scale(0.78) translateY(8px)" : "scale(1) translateY(0)",
          pointerEvents: open ? "none" : "auto",
          transition: dragStateRef.current.active ? "none" : "opacity 240ms ease-in-out, transform 0.6s cubic-bezier(0.16, 1, 0.3, 1)",
          willChange: "opacity, transform",
        }}
      >
        {showModeLabel && (
          <span key={modeLabelKeyRef.current} className="bot-mode-label absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-[#06b6d4]/20 bg-[#0a0c10]/90 px-2.5 py-0.5 text-[9px] font-bold tracking-wider text-[#06b6d4]/80 backdrop-blur-sm pointer-events-none select-none">
            {MODE_META[avatarMode].emoji} {MODE_META[avatarMode].label}
          </span>
        )}
        <button
          onClick={handleToggleClick}
          onPointerDown={(e) => { if (e.pointerType === "mouse" && e.button !== 0) return; e.preventDefault(); startDrag(e.clientX, e.clientY, e.pointerId, e.currentTarget); }}
          onTouchStart={startTouchDrag}
          style={{ background: "transparent" }}
          className="bot-toggle-btn relative flex h-14 w-14 cursor-grab touch-none select-none items-center justify-center rounded-[18px] transition-transform hover:scale-110 active:scale-95 active:cursor-grabbing"
          aria-label="Open chat assistant"
        >
          {/* Outer glow ring */}
          <span className="absolute inset-0 rounded-[18px] border border-[#06b6d4]/20 shadow-[0_0_18px_rgba(6,182,212,0.15)]" />
          <AvatarRenderer mode={avatarMode} size={56} />
        </button>
      </div>

      {/* ── Chat panel ──────────────────────────────────────────────────── */}
      <div
        style={{
          top: resolvedPosition.y, left: resolvedPosition.x,
          width: resolvedPanelWidth, height: resolvedPanelHeight,
          opacity: open ? 1 : 0,
          transform: open ? "scale(1) translateY(0)" : "scale(0.96) translateY(12px)",
          pointerEvents: open ? "auto" : "none",
          transition: dragStateRef.current.active ? "none" : (open
            ? "opacity 280ms cubic-bezier(0.0,0.0,0.2,1), transform 300ms cubic-bezier(0.34,1.1,0.64,1), width 300ms cubic-bezier(0.4,0,0.2,1), height 300ms cubic-bezier(0.4,0,0.2,1)"
            : "opacity 200ms ease-in-out, transform 220ms cubic-bezier(0.4,0,1,1), width 260ms cubic-bezier(0.4,0,0.2,1), height 260ms cubic-bezier(0.4,0,0.2,1)"),
          willChange: "opacity, transform",
        }}
        className="fixed z-[60] flex flex-col overflow-hidden max-w-[calc(100vw-2rem)]"
      >
        {/* Outer frame with gradient border */}
        <div className="chat-panel-border absolute inset-0 rounded-[24px] p-px">
          <div className="absolute inset-px rounded-[23px] bg-[#080a0f]/85 backdrop-blur-3xl" />
        </div>

        {/* Scanline overlay */}
        <div className="chat-scanlines absolute inset-0 z-[1] rounded-[24px] opacity-10" />

        {/* Main panel surface */}
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="chat-widget-title"
          className="relative z-[2] flex h-full flex-col overflow-hidden rounded-[24px] border border-[#06b6d4]/15"
          style={{ 
            background: "linear-gradient(165deg, rgba(12,14,21,0.85) 0%, rgba(8,10,16,0.92) 45%, rgba(5,7,9,0.96) 100%)", 
            boxShadow: "0 32px 90px rgba(0,0,0,0.9), inset 0 1px 0 rgba(6,182,212,0.12), 0 0 0 1px rgba(6,182,212,0.08)",
            backdropFilter: "blur(60px)"
          }}
        >

          {/* Loading beam across top */}
          {loading && (
            <div className="absolute top-0 left-0 right-0 z-[10] h-[2px] overflow-hidden rounded-t-[24px]">
              <div className="absolute top-0 h-full w-[35%] rounded-full bg-gradient-to-r from-transparent via-[#06b6d4] to-transparent" style={{ animation: "loadBeam 1.4s ease-in-out infinite" }} />
            </div>
          )}
          {!loading && (
            <div className="absolute top-0 left-0 right-0 h-[1px] rounded-t-[24px] bg-gradient-to-r from-transparent via-[#06b6d4]/35 to-transparent" />
          )}

          {/* ── HEADER ──────────────────────────────────────────────────── */}
          <div
            onPointerDown={(e) => { const target = e.target as HTMLElement; if (target.closest("button")) return; if (e.pointerType === "mouse" && e.button !== 0) return; e.preventDefault(); startDrag(e.clientX, e.clientY, e.pointerId, e.currentTarget); }}
            onTouchStart={(e) => { const target = e.target as HTMLElement; if (target.closest("button")) return; startTouchDrag(e); }}
            className="relative flex shrink-0 cursor-grab touch-none select-none items-center justify-between px-4 py-3 active:cursor-grabbing"
            style={{ background: "linear-gradient(180deg, rgba(6,182,212,0.08) 0%, rgba(6,182,212,0.03) 100%)", borderBottom: "1px solid rgba(6,182,212,0.12)", minHeight: 60 }}
          >
            {/* Left — identity */}
            <div className="flex items-center gap-3">
              {/* Avatar cell */}
              <div className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-xl border border-[#06b6d4]/25 bg-[#06b6d4]/[0.07] shadow-[0_0_14px_rgba(6,182,212,0.12)] transition-[transform,box-shadow] duration-300 ease-out">
                <div className="transition-transform duration-300 ease-out">
                  <AvatarRenderer mode={avatarMode} size={34} />
                </div>
                {/* Live dot */}
                <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full border border-[#080a10] bg-[#10b981]" style={{ animation: "neuralPulse 2s ease-in-out infinite" }} />
              </div>
              <p className="text-[13.5px] font-black tracking-[0.06em] uppercase text-white/90 leading-none">
                {PRODUCT_ASSISTANT_NAME}
              </p>
            </div>

            {/* Right — controls */}
            <div className="flex items-center gap-1">
              <button onClick={clearConversation} disabled={loading || !hasUserConversation} aria-label="Clear conversation"
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.05] bg-white/[0.03] text-white/30 transition-all hover:border-red-400/20 hover:bg-red-400/10 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-20">
                <Trash2 size={11} />
              </button>
              <button onClick={() => setExpanded((e) => !e)} aria-label={expanded ? "Compact" : "Expand"}
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.05] bg-white/[0.03] text-white/30 transition-all hover:border-[#06b6d4]/20 hover:bg-[#06b6d4]/[0.08] hover:text-[#06b6d4]/70">
                {expanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
              </button>
              <button onClick={minimizeChat} aria-label="Minimize"
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.05] bg-white/[0.03] text-white/30 transition-all hover:border-white/10 hover:bg-white/[0.06] hover:text-white/60">
                <Minus size={12} />
              </button>
              <button onClick={minimizeChat} aria-label="Close"
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.05] bg-white/[0.03] text-white/30 transition-all hover:border-red-500/30 hover:bg-red-500/15 hover:text-red-300">
                <X size={12} />
              </button>
            </div>
          </div>

          {/* ── QUICK ACTION RAIL ────────────────────────────────────────── */}
          <div className="shrink-0 border-b border-white/[0.04]" style={{ background: "rgba(0,0,0,0.15)" }}>
            <div className="flex gap-px p-2">
              {QUICK_ACTIONS.map((action) => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.label}
                    type="button"
                    onClick={() => submit(action.prompt)}
                    disabled={loading}
                    className="group relative flex-1 flex flex-col items-center gap-1 rounded-xl py-2.5 transition-all disabled:cursor-not-allowed disabled:opacity-35"
                    style={{ background: "rgba(255,255,255,0.03)" }}
                  >
                    {/* Hover fill */}
                    <span className="absolute inset-0 rounded-xl opacity-0 transition-opacity group-hover:opacity-100" style={{ background: `${action.color}12`, boxShadow: `inset 0 0 0 1px ${action.color}20` }} />
                    <span className="relative flex h-6 w-6 items-center justify-center rounded-lg transition-transform group-hover:scale-110" style={{ background: `${action.color}15`, border: `1px solid ${action.color}25`, color: action.color }}>
                      <Icon size={12} />
                    </span>
                    <span className="relative text-[9.5px] font-bold tracking-wide text-white/45 transition-colors group-hover:text-white/75">{action.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── MESSAGES ────────────────────────────────────────────────── */}
          <div className="custom-scrollbar relative flex-1 overflow-y-auto px-4 py-4 space-y-3">
            {messages.map((msg) => {
              // Only animate each message once — track by id to avoid re-animating on re-renders
              const isNew = !animatedIdsRef.current.has(msg.id);
              if (isNew) animatedIdsRef.current.add(msg.id);
              return (
              <div
                key={msg.id}
                className={cn(isNew ? "chat-msg-new" : "", "flex gap-2.5 items-end", msg.role === "user" ? "flex-row-reverse" : "flex-row")}
              >
                {/* Avatar */}
                <div className={cn("flex-shrink-0 flex h-6 w-6 items-center justify-center rounded-lg",
                  msg.role === "user"
                    ? "border border-[#06b6d4]/30 bg-[#06b6d4]/12"
                    : "border border-white/[0.08] bg-white/[0.04]"
                )}>
                  {msg.role === "user"
                    ? <User size={11} className="text-[#06b6d4]" />
                    : <Bot size={11} className="text-white/40" />
                  }
                </div>

                {/* Bubble */}
                <div className="flex flex-col gap-1.5 max-w-[84%]">
                  {msg.contextUsed && msg.contextUsed.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {msg.contextUsed.map((src) => (
                        <span key={src} className="inline-flex items-center gap-1 rounded-md border border-[#06b6d4]/20 bg-[#06b6d4]/[0.06] px-2 py-0.5 text-[9px] font-bold tracking-wider text-[#06b6d4]/70">
                          <Zap size={7} />
                          {src}
                        </span>
                      ))}
                    </div>
                  )}

                  {msg.role === "assistant" ? (
                    /* Assistant bubble — bracket-corner card */
                    <div className="relative rounded-xl rounded-bl-sm px-3.5 py-3 text-[12px] leading-relaxed text-white/75"
                      style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0.025) 100%)", border: "1px solid rgba(255,255,255,0.07)", boxShadow: "0 4px 20px rgba(0,0,0,0.3)" }}>
                      {/* Corner brackets */}
                      <span className="absolute -left-px -top-px h-3 w-3 border-l border-t border-[#06b6d4]/40 rounded-tl-xl" style={{ animation: "cornerPulse 3s ease-in-out infinite" }} />
                      <span className="absolute -bottom-px -right-px h-3 w-3 border-b border-r border-[#06b6d4]/20 rounded-br-xl" />
                      <MessageContent message={msg} />
                    </div>
                  ) : (
                    /* User bubble */
                    <div className="rounded-xl rounded-br-sm px-3.5 py-3 text-[12px] leading-relaxed text-white/85"
                      style={{ background: "linear-gradient(135deg, rgba(6,182,212,0.14) 0%, rgba(6,182,212,0.08) 100%)", border: "1px solid rgba(6,182,212,0.18)" }}>
                      <MessageContent message={msg} />
                    </div>
                  )}

                  {msg.action && (
                    <button type="button" onClick={() => router.push(msg.action!.href)}
                      className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-[#06b6d4]/25 bg-[#06b6d4]/10 px-3 py-1.5 text-[10.5px] font-semibold text-[#06b6d4]/80 transition-all hover:border-[#06b6d4]/40 hover:bg-[#06b6d4]/15">
                      {msg.action.label}<ArrowUpRight size={10} />
                    </button>
                  )}
                  {msg.exportCsv && msg.exportFilename && (
                    <button type="button" onClick={() => triggerCsvDownload(msg.exportCsv!, msg.exportFilename!)}
                      className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-[#10b981]/25 bg-[#10b981]/10 px-3 py-1.5 text-[10.5px] font-semibold text-[#10b981]/80 transition-all hover:bg-[#10b981]/20">
                      <Download size={10} />Download CSV
                    </button>
                  )}
                  {msg.reportOptions && <ReportOptionsCard options={msg.reportOptions} disabled={loading} onGenerate={generateReport} />}
                  {msg.dashboardOptions && <DashboardOptionsCard options={msg.dashboardOptions} disabled={loading} onGenerate={generateDashboardAction} />}
                </div>
              </div>
              );
            })}

            {/* Loading indicator */}
            {loading && (
              <div className="flex gap-2.5 items-end">
                <div className="flex-shrink-0 flex h-6 w-6 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04]">
                  <Bot size={11} className="text-[#06b6d4]/60" />
                </div>
                <div className="relative rounded-xl rounded-bl-sm px-3.5 py-2.5"
                  style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.07)" }}>
                  <span className="absolute -left-px -top-px h-3 w-3 border-l border-t border-[#06b6d4]/40 rounded-tl-xl" />
                  <TypingWave />
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* ── SMART SUGGESTIONS ───────────────────────────────────────── */}
          <div className="shrink-0 border-t border-white/[0.04] px-3 py-2.5" style={{ background: "rgba(0,0,0,0.12)" }}>
            <div className="mb-2 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-[0.16em] text-white/25">
                <Sparkles size={9} className="text-[#06b6d4]/50" />
                {hasUserConversation ? "Follow-up" : "Suggested"}
              </span>
              {hasUserConversation && (
                <button type="button" onClick={clearConversation} disabled={loading} className="text-[9px] font-semibold text-white/20 transition hover:text-red-300/70 disabled:opacity-30">
                  Clear
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-1">
              {suggestions.map((q) => (
                <button
                  key={q}
                  onClick={() => submit(q)}
                  disabled={loading}
                  className="group min-w-0 rounded-lg border border-white/[0.05] px-2.5 py-1.5 text-left text-[10.5px] text-white/40 font-medium transition-all hover:border-[#06b6d4]/15 hover:bg-[#06b6d4]/[0.06] hover:text-white/70 disabled:opacity-25"
                  style={{ background: "rgba(255,255,255,0.02)" }}
                >
                  <span className="block truncate">{q}</span>
                </button>
              ))}
            </div>
          </div>

          {/* ── INPUT ────────────────────────────────────────────────────── */}
          <div className="shrink-0 px-3 pb-3 pt-2">
            <div
              className="relative flex items-end gap-2 rounded-xl px-3.5 py-2.5 transition-all duration-200"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: inputFocused ? "1px solid rgba(6,182,212,0.35)" : "1px solid rgba(255,255,255,0.07)",
                boxShadow: inputFocused ? "0 0 0 2px rgba(6,182,212,0.08), inset 0 1px 0 rgba(6,182,212,0.04)" : "none",
              }}
            >
              {/* Prompt sigil */}
              <Terminal size={12} className={cn("shrink-0 mb-0.5 transition-colors", inputFocused ? "text-[#06b6d4]/60" : "text-white/15")} />
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKey}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                placeholder="Query claims, policies, reports…"
                rows={1}
                disabled={loading}
                className="flex-1 bg-transparent text-[12px] text-white/80 placeholder:text-white/18 resize-none outline-none leading-relaxed max-h-28 overflow-y-auto"
                style={{ scrollbarWidth: "none" }}
              />
              <button
                onClick={() => submit(input)}
                disabled={!input.trim() || loading}
                className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                style={{
                  background: input.trim() && !loading
                    ? "linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)"
                    : "rgba(255,255,255,0.06)",
                  boxShadow: input.trim() && !loading ? "0 0 16px rgba(6,182,212,0.30)" : "none",
                }}
              >
                {loading
                  ? <Loader2 size={13} className="text-[#06b6d4] animate-spin" />
                  : <Send size={12} className={input.trim() ? "text-[#040a0b]" : "text-white/25"} strokeWidth={2.5} />
                }
              </button>
            </div>
          </div>

          {/* ── STATUS FOOTER ────────────────────────────────────────────── */}
          <div className="flex shrink-0 items-center justify-between px-4 pb-2.5">
            <div className="flex items-center gap-1.5">
              <span className="h-1 w-1 rounded-full bg-[#10b981]" style={{ animation: "neuralPulse 2.5s ease-in-out infinite" }} />
              <span className="text-[9px] font-semibold tracking-wider text-white/18">SECURE · ENCRYPTED</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Shield size={8} className="text-white/15" />
              <span className="font-mono text-[9px] text-white/18">{clockStr}</span>
            </div>
          </div>

        </div>{/* /main panel surface */}
      </div>
    </div>
  );
}
