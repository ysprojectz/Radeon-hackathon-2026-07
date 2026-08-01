import type { AvatarMode } from "@/components/chat/BotAvatarCanvas";

export type ChatAssistantVariantKey =
  | "dashboard-copilot"
  | "legacy-widget"
  | "sentinel-ops"
  | "orange-cinematic";

export type ChatAssistantBoardStyle = "dashboard" | "legacy" | "cinematic" | "workspace";

export interface ChatAssistantVariantDefinition {
  key: ChatAssistantVariantKey;
  name: string;
  description: string;
  boardStyle: ChatAssistantBoardStyle;
  historyLabel: string;
  historyCommit: string;
  thumbnailAccent: string;
  thumbnailGlow: string;
  avatarModes: AvatarMode[];
  motionLabel: string;
  specialty: string;
  traits: string[];
}

export const CHAT_ASSISTANT_VARIANT_DEFAULT: ChatAssistantVariantKey = "dashboard-copilot";

export const CHAT_ASSISTANT_VARIANTS: ChatAssistantVariantDefinition[] = [
  {
    key: "dashboard-copilot",
    name: "NOVA Analyst",
    description: "A calm neural analyst for metric checks, lifecycle gaps, and quick claim summaries.",
    boardStyle: "dashboard",
    historyLabel: "Neural scan motion",
    historyCommit: "NOVA-01",
    thumbnailAccent: "from-cyan-300/45 to-cyan-500/10",
    thumbnailGlow: "bg-cyan-300/30",
    avatarModes: ["neural", "thinking", "assisting", "monitoring"],
    motionLabel: "Pulse scan",
    specialty: "Operational answers",
    traits: ["Short answers", "Metrics aware", "Low-distraction"],
  },
  {
    key: "legacy-widget",
    name: "Code Runner",
    description: "A focused techie character for exports, admin checks, and workflow troubleshooting.",
    boardStyle: "legacy",
    historyLabel: "Terminal motion",
    historyCommit: "CODE-02",
    thumbnailAccent: "from-slate-200/35 to-slate-500/10",
    thumbnailGlow: "bg-slate-300/20",
    avatarModes: ["hacker", "coding", "explorer", "presenting"],
    motionLabel: "Console drift",
    specialty: "Admin diagnostics",
    traits: ["Checklist style", "Export help", "Settings support"],
  },
  {
    key: "sentinel-ops",
    name: "Sentinel Auditor",
    description: "A visor-led control character for blockers, fraud signals, and review queue attention.",
    boardStyle: "legacy",
    historyLabel: "Radar sweep motion",
    historyCommit: "SENT-03",
    thumbnailAccent: "from-orange-300/45 to-red-500/10",
    thumbnailGlow: "bg-orange-300/30",
    avatarModes: ["sentinel", "monitoring", "searching", "thinking"],
    motionLabel: "Visor sweep",
    specialty: "Risk monitoring",
    traits: ["Blocker focused", "Queue aware", "Audit ready"],
  },
  {
    key: "orange-cinematic",
    name: "Relay Bot",
    description: "A high-visibility animated bot for guided support, next actions, and user onboarding.",
    boardStyle: "cinematic",
    historyLabel: "Cinematic hover motion",
    historyCommit: "RELAY-04",
    thumbnailAccent: "from-orange-400/50 to-amber-500/12",
    thumbnailGlow: "bg-orange-400/35",
    avatarModes: ["orangerobot", "orangerobot", "orangerobot"],
    motionLabel: "Hover relay",
    specialty: "Guided support",
    traits: ["Warm tone", "Next-action prompts", "High visibility"],
  },
];

export const CHAT_ASSISTANT_VARIANT_KEYS = CHAT_ASSISTANT_VARIANTS.map((variant) => variant.key);

export function isChatAssistantVariantKey(value: string | null | undefined): value is ChatAssistantVariantKey {
  return Boolean(value) && CHAT_ASSISTANT_VARIANT_KEYS.includes(value as ChatAssistantVariantKey);
}

export function getChatAssistantVariant(
  value: string | null | undefined
): ChatAssistantVariantDefinition {
  return CHAT_ASSISTANT_VARIANTS.find((variant) => variant.key === value) ??
    CHAT_ASSISTANT_VARIANTS.find((variant) => variant.key === CHAT_ASSISTANT_VARIANT_DEFAULT)!;
}
