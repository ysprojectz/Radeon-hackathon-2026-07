"use client";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  Save, Eye, EyeOff, Bot, Brain, Zap, CheckCircle2, Loader2, XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { adminUpdateConfig } from "@/lib/api";
import type { SystemConfig } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  adminActionButtonClass,
  adminInputClass,
  adminPanelClass,
  adminSectionCopyClass,
  adminSectionTitleClass,
} from "@/components/admin/admin-theme";

// ── Model lists per provider ──────────────────────────────────────────────────
const PRIMARY_AGENT_MODELS = [
  { value: "qwen/qwen3-32b",          label: "Intelligence AI Agent - Fast" },
  { value: "llama-3.3-70b-versatile", label: "Intelligence AI Agent - Large" },
  { value: "llama-3.1-8b-instant",    label: "Intelligence AI Agent - Instant" },
];

const ANTHROPIC_MODELS = [
  { value: "claude-opus-4-5",              label: "Claude Opus 4.5" },
  { value: "claude-sonnet-4-5",            label: "Claude Sonnet 4.5" },
  { value: "claude-3-5-haiku-20241022",    label: "Claude 3.5 Haiku" },
];

const OPENAI_MODELS = [
  { value: "gpt-4o",       label: "GPT-4o" },
  { value: "gpt-4o-mini",  label: "GPT-4o Mini" },
  { value: "gpt-4-turbo",  label: "GPT-4 Turbo" },
];

const BACKUP_AGENT_MODELS = [
  { value: "nvidia/llama-3.1-nemotron-ultra-253b-v1", label: "Intelligence AI Agent - Advanced" },
  { value: "meta/llama-3.3-70b-instruct",             label: "Intelligence AI Agent - Enterprise" },
  { value: "nvidia/llama-3.1-nemotron-70b-instruct",  label: "Intelligence AI Agent - Balanced" },
];

// ── Masked API Key Input ───────────────────────────────────────────────────────

interface MaskedInputProps {
  id: string; value: string;
  onChange: (v: string) => void; placeholder?: string;
  disabled?: boolean;
}

function MaskedInput({ id, value, onChange, placeholder, disabled }: MaskedInputProps) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input id={id} type={show ? "text" : "password"} value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "Paste key here to update"}
        disabled={disabled}
        className={`${adminInputClass} h-8 pr-10 font-mono text-xs`} />
      <button type="button" onClick={() => setShow(!show)} disabled={disabled}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-white/35 hover:text-white disabled:opacity-40">
        {show ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

// ── Intelligence agent transition overlay ─────────────────────────────────────

interface TransitionOverlayProps {
  enabling: boolean;
  error: string | null;
  onRetry: () => void;
}

function AgentTransitionOverlay({ enabling, error, onRetry }: TransitionOverlayProps) {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    if (error) return;
    const timers = [
      setTimeout(() => setStage(1), 400),
      setTimeout(() => setStage(2), 900),
      setTimeout(() => setStage(3), 1500),
    ];
    return () => timers.forEach(clearTimeout);
  }, [error]);

  const disableStages = [
    { label: "Saving configuration to store",      icon: Zap    },
    { label: "Switching to rules-only review", icon: Bot    },
    { label: "Rules check mode active",        icon: Brain  },
  ];
  const enableStages = [
    { label: "Saving configuration to store",       icon: Zap    },
    { label: "Restoring assistant review",          icon: Brain  },
    { label: "Dual validation ready",               icon: Bot    },
  ];
  const stages = enabling ? enableStages : disableStages;

  return (
    <div className="absolute inset-0 z-50 rounded-xl overflow-hidden flex items-center justify-center backdrop-blur-sm bg-background/80">
      <div className="flex flex-col items-center gap-5 p-8 max-w-xs text-center">
        {error ? (
          <>
            <div className="rounded-full bg-red-100 dark:bg-red-900/30 p-3">
              <XCircle className="h-8 w-8 text-red-500" />
            </div>
            <div>
              <p className="font-semibold text-sm">Toggle failed</p>
              <p className="text-xs text-muted-foreground mt-1">{error}</p>
            </div>
            <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>
          </>
        ) : (
          <>
            <div className={cn(
              "rounded-full p-4 transition-all duration-700",
              enabling ? "bg-emerald-100 dark:bg-emerald-900/30" : "bg-amber-100 dark:bg-amber-900/30"
            )}>
              <Bot className={cn(
                "h-10 w-10 transition-all duration-500",
                enabling ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400",
                stage < 3 && "animate-pulse"
              )} />
            </div>
            <div>
              <p className="font-bold text-sm">
                {enabling ? "Enabling Intelligence AI Agent…" : "Disabling Intelligence AI Agent…"}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {enabling ? "Restoring dual-agent validation pipeline" : "Switching to Rules Engine only mode"}
              </p>
            </div>
            <div className="w-full space-y-2">
              {stages.map((s, i) => {
                const done   = stage > i;
                const active = stage === i;
                const StageIcon = s.icon;
                return (
                  <div key={i} className={cn(
                    "flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs transition-all duration-500",
                    done && "bg-emerald-50 dark:bg-emerald-950/20",
                    active && "bg-muted/60",
                    !done && !active && "opacity-30"
                  )}>
                    {done ? (
                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                    ) : active ? (
                      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                    ) : (
                      <StageIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className={cn(done && "text-emerald-700 dark:text-emerald-400 font-medium")}>
                      {s.label}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-muted-foreground leading-snug">
              {enabling
                ? "✦ Active claims complete normally. New claims restore full pipeline."
                : "⚠ Active claims complete normally. New claims use deterministic rules only."}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

// ── Provider Row ─────────────────────────────────────────────────────────────

interface ProviderConfig {
  name:        string;
  description: string;
  color:       string; // Tailwind color base e.g. "orange"
  models:      { value: string; label: string }[];
  keyField:    "groq_api_key" | "anthropic_api_key" | "openai_api_key" | "nvidia_api_key";
  modelField:  "llm_model" | "anthropic_model" | "openai_model" | "nvidia_model";
  enabledField: "groq_enabled" | "anthropic_enabled" | "openai_enabled" | "nvidia_enabled";
  logo:        React.ReactNode;
}

function ProviderRow({
  provider,
  enabled,
  onToggle,
  apiKeyMasked,
  selectedModel,
  onModelChange,
  keyInput,
  onKeyInputChange,
  onSave,
  saving,
  isMasterDisabled,
}: {
  provider:         ProviderConfig;
  enabled:          boolean;
  onToggle:         (v: boolean) => void;
  apiKeyMasked:     string | null;
  selectedModel:    string;
  onModelChange:    (v: string) => void;
  keyInput:         string;
  onKeyInputChange: (v: string) => void;
  onSave:           () => void;
  saving:           boolean;
  isMasterDisabled: boolean;
}) {
  const colorMap: Record<string, string> = {
    orange:  "from-orange-50/80 to-transparent dark:from-orange-950/20 border-orange-200/60 dark:border-orange-900/40",
    purple:  "from-purple-50/80 to-transparent dark:from-purple-950/20 border-purple-200/60 dark:border-purple-900/40",
    emerald: "from-emerald-50/80 to-transparent dark:from-emerald-950/20 border-emerald-200/60 dark:border-emerald-900/40",
    green:   "from-green-50/80 to-transparent dark:from-green-950/20 border-green-200/60 dark:border-green-900/40",
  };
  const badgeMap: Record<string, string> = {
    orange:  "bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-800",
    purple:  "bg-purple-100 text-purple-700 border-purple-200 dark:bg-purple-900/30 dark:text-purple-400 dark:border-purple-800",
    emerald: "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800",
    green:   "bg-green-100 text-green-700 border-green-200 dark:bg-green-900/30 dark:text-green-400 dark:border-green-800",
  };
  const switchMap: Record<string, string> = {
    orange:  "data-[state=checked]:bg-orange-500",
    purple:  "data-[state=checked]:bg-purple-500",
    emerald: "data-[state=checked]:bg-emerald-500",
    green:   "data-[state=checked]:bg-green-500",
  };

  const dimmed = isMasterDisabled || !enabled;

  return (
    <div className={cn(
      "flex h-full flex-col overflow-hidden rounded-[1.25rem] border bg-gradient-to-br transition-all duration-300 shadow-sm hover:shadow-md",
      colorMap[provider.color] ?? colorMap.orange,
      !enabled && "opacity-70 grayscale-[0.2]"
    )}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-3 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-[14px] font-bold shadow-sm",
            badgeMap[provider.color] ?? badgeMap.orange
          )}>
            {provider.logo}
          </div>
          <div className="min-w-0">
            <p className="text-[15px] font-bold leading-none text-white">{provider.name}</p>
            <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-white/50">{provider.description}</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <Switch
            checked={enabled}
            onCheckedChange={onToggle}
            disabled={isMasterDisabled}
            className={cn("transition-opacity", switchMap[provider.color] ?? switchMap.orange)}
          />
          <span className={cn(
            "inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-bold tracking-wide uppercase",
            enabled
              ? (badgeMap[provider.color] ?? badgeMap.orange)
              : "bg-muted text-muted-foreground border-border"
          )}>
            {enabled ? "Active" : "Inactive"}
          </span>
        </div>
      </div>

      {/* Body */}
      <div className={cn(
        "flex flex-1 flex-col border-t border-white/[0.04] px-5 py-4 transition-opacity bg-black/10",
        dimmed && "pointer-events-none opacity-50"
      )}>
        {/* API Key */}
        <div className="space-y-1.5">
          <Label className="text-[10px] font-bold uppercase tracking-[0.1em] text-white/40">
            API Key
          </Label>
          <MaskedInput
            id={`${provider.name.toLowerCase()}-key`}
            value={keyInput}
            onChange={onKeyInputChange}
          />
          {apiKeyMasked ? (
            <p className="flex items-center gap-1.5 mt-1 text-[11px] font-medium text-emerald-400">
              <CheckCircle2 className="h-3.5 w-3.5" /> Key securely stored ending in {apiKeyMasked.slice(-4) || "***"}
            </p>
          ) : (
            <p className="mt-1 text-[11px] text-white/30 italic">No key configured</p>
          )}
        </div>

        {/* Model selector */}
        <div className="mt-4 space-y-1.5">
          <Label className="text-[10px] font-bold uppercase tracking-[0.1em] text-white/40">
            Preferred Model
          </Label>
          <Select value={selectedModel} onValueChange={onModelChange}>
            <SelectTrigger className={`${adminInputClass} h-9 text-xs font-medium`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {provider.models.map((m) => (
                <SelectItem key={m.value} value={m.value} className="text-xs font-medium">
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="mt-auto pt-5">
          <Button
            onClick={onSave}
            disabled={saving}
            size="sm"
            variant="outline"
            className={`${adminActionButtonClass} h-9 w-full text-xs font-bold transition-all`}
          >
            <Save className="mr-1.5 h-3.5 w-3.5" />
            {saving ? "Saving Configuration…" : `Save ${provider.name} Settings`}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

interface Props { config: SystemConfig | undefined; onSaved: () => void; }

export function AIConfigTab({ config, onSaved }: Props) {
  // Intelligence agent master toggle
  const [llmEnabled,          setLlmEnabled]          = useState(true);
  const [transitioning,       setTransitioning]        = useState(false);
  const [transitionEnabling,  setTransitionEnabling]   = useState(false);
  const [transitionError,     setTransitionError]      = useState<string | null>(null);

  // Per-provider state
  const [groqEnabled,     setGroqEnabled]     = useState(true);
  const [anthropicEnabled, setAnthropicEnabled] = useState(false);
  const [openaiEnabled,   setOpenaiEnabled]   = useState(false);
  const [nvidiaEnabled,   setNvidiaEnabled]   = useState(false);

  const [groqModel,      setGroqModel]      = useState("qwen/qwen3-32b");
  const [anthropicModel, setAnthropicModel] = useState("claude-sonnet-4-5");
  const [openaiModel,    setOpenaiModel]    = useState("gpt-4o");
  const [nvidiaModel,    setNvidiaModel]    = useState("nvidia/llama-3.1-nemotron-ultra-253b-v1");

  const [groqKey,      setGroqKey]      = useState("");
  const [anthropicKey, setAnthropicKey] = useState("");
  const [openaiKey,    setOpenaiKey]    = useState("");
  const [nvidiaKey,    setNvidiaKey]    = useState("");

  const [groqSaving,      setGroqSaving]      = useState(false);
  const [anthropicSaving, setAnthropicSaving] = useState(false);
  const [openaiSaving,    setOpenaiSaving]    = useState(false);
  const [nvidiaSaving,    setNvidiaSaving]    = useState(false);

  // Dual-agent settings
  const [dualEnabled,        setDualEnabled]        = useState(true);
  const [agreementThreshold, setAgreementThreshold] = useState("0.98");
  const [conflictThreshold,  setConflictThreshold]  = useState("0.80");
  const [dualLoading,        setDualLoading]        = useState(false);

  useEffect(() => {
    if (!config) return;
    setLlmEnabled(config.llm_enabled ?? true);
    setGroqEnabled(config.groq_enabled ?? true);
    setAnthropicEnabled(config.anthropic_enabled ?? false);
    setOpenaiEnabled(config.openai_enabled ?? false);
    setOpenaiModel(config.openai_model ?? "gpt-4o");
    setNvidiaEnabled(config.nvidia_enabled ?? false);
    setNvidiaModel(config.nvidia_model ?? "nvidia/llama-3.1-nemotron-ultra-253b-v1");
    setDualEnabled(config.dual_agent_enabled ?? true);
    setAgreementThreshold(String(config.dual_agent_agreement_threshold ?? 0.98));
    setConflictThreshold(String(config.dual_agent_conflict_threshold ?? 0.80));

    // Set per-provider model from llm_model
    const m = config.llm_model ?? "qwen/qwen3-32b";
    const isGroqModel      = PRIMARY_AGENT_MODELS.some((x) => x.value === m);
    const isAnthropicModel = ANTHROPIC_MODELS.some((x) => x.value === m);
    if (isGroqModel)      setGroqModel(m);
    if (isAnthropicModel) setAnthropicModel(m);
  }, [config]);

  // ── Intelligence agent master toggle ───────────────────────────────────────
  async function handleLLMToggle(next: boolean) {
    setTransitionEnabling(next);
    setTransitionError(null);
    setTransitioning(true);
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    try {
      await Promise.all([adminUpdateConfig({ llm_enabled: next }), sleep(2200)]);
      setLlmEnabled(next);
      onSaved();
      toast.success(
        next ? "Intelligence AI Agent enabled - dual review restored" : "Intelligence AI Agent disabled - rules-only mode active",
        { description: next
            ? "Full dual-agent validation will resume on the next claim"
            : "Claims will use the deterministic Rules Engine only" }
      );
      setTransitioning(false);
    } catch (err) {
      setTransitionError(err instanceof Error ? err.message : "Failed to save");
    }
  }

  // ── Per-provider save + toggle ─────────────────────────────────────────────
  async function saveProvider(
    setLoading: (v: boolean) => void,
    fields: Partial<SystemConfig>,
    label: string,
  ) {
    setLoading(true);
    try {
      await adminUpdateConfig(fields);
      toast.success(`${label} settings saved`);
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleGroqToggle(next: boolean) {
    setGroqEnabled(next);
    await saveProvider(() => {}, { groq_enabled: next }, "Intelligence AI Agent");
    onSaved();
  }
  async function handleAnthropicToggle(next: boolean) {
    setAnthropicEnabled(next);
    await saveProvider(() => {}, { anthropic_enabled: next }, "Anthropic");
    onSaved();
  }
  async function handleOpenAIToggle(next: boolean) {
    setOpenaiEnabled(next);
    await saveProvider(() => {}, { openai_enabled: next }, "OpenAI");
    onSaved();
  }
  async function handleNvidiaToggle(next: boolean) {
    setNvidiaEnabled(next);
    await saveProvider(() => {}, { nvidia_enabled: next }, "Backup Intelligence AI Agent");
    onSaved();
  }

  async function saveGroq() {
    const fields: Partial<SystemConfig> = {
      groq_enabled: groqEnabled,
      llm_model:    groqModel,
    };
    if (groqKey.trim()) fields.groq_api_key = groqKey.trim();
    await saveProvider(setGroqSaving, fields, "Intelligence AI Agent");
    setGroqKey("");
  }

  async function saveAnthropic() {
    const fields: Partial<SystemConfig> = {
      anthropic_enabled: anthropicEnabled,
      anthropic_model:   anthropicModel,
    };
    if (anthropicKey.trim()) fields.anthropic_api_key = anthropicKey.trim();
    await saveProvider(setAnthropicSaving, fields, "Anthropic");
    setAnthropicKey("");
  }

  async function saveOpenAI() {
    const fields: Partial<SystemConfig> = {
      openai_enabled: openaiEnabled,
      openai_model:   openaiModel,
    };
    if (openaiKey.trim()) fields.openai_api_key = openaiKey.trim();
    await saveProvider(setOpenaiSaving, fields, "OpenAI");
    setOpenaiKey("");
  }

  async function saveNvidia() {
    const fields: Partial<SystemConfig> = {
      nvidia_enabled: nvidiaEnabled,
      nvidia_model:   nvidiaModel,
    };
    if (nvidiaKey.trim()) fields.nvidia_api_key = nvidiaKey.trim();
    await saveProvider(setNvidiaSaving, fields, "Backup Intelligence AI Agent");
    setNvidiaKey("");
  }

  // ── Dual-agent save ────────────────────────────────────────────────────────
  async function saveDual() {
    setDualLoading(true);
    try {
      await adminUpdateConfig({
        dual_agent_enabled:             dualEnabled,
        dual_agent_agreement_threshold: parseFloat(agreementThreshold),
        dual_agent_conflict_threshold:  parseFloat(conflictThreshold),
      });
      toast.success("Dual-agent settings saved");
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setDualLoading(false);
    }
  }

  return (
    <div className="max-w-5xl space-y-5">

      {/* ── Intelligence agent master toggle ──────────────────────────────── */}
      <div className={`${adminPanelClass} relative overflow-hidden`}>
        {transitioning && (
          <AgentTransitionOverlay
            enabling={transitionEnabling}
            error={transitionError}
            onRetry={() => handleLLMToggle(transitionEnabling)}
          />
        )}
        <div className={cn(
          "px-4 py-3.5 bg-gradient-to-br transition-colors duration-700",
          llmEnabled
            ? "from-emerald-50 to-emerald-50/20 dark:from-emerald-950/20 dark:to-transparent border-b border-emerald-100 dark:border-emerald-900"
            : "from-amber-50 to-amber-50/20 dark:from-amber-950/20 dark:to-transparent border-b border-amber-100 dark:border-amber-900"
        )}>
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
            <div className={cn(
              "rounded-xl p-2 transition-colors",
                llmEnabled ? "bg-emerald-100 dark:bg-emerald-900/40" : "bg-amber-100 dark:bg-amber-900/40"
              )}>
                <Bot className={cn(
                  "h-4 w-4",
                  llmEnabled ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"
                )} />
              </div>
              <div>
                <p className={adminSectionTitleClass}>Assistant Review</p>
                <p className={`mt-0.5 text-[11px] ${adminSectionCopyClass}`}>
                  {llmEnabled
                    ? "Dual review active (rules + assistant)"
                    : "Rules-only mode — no provider calls, zero cost"}
                </p>
              </div>
            </div>
            <Switch
              checked={llmEnabled}
              onCheckedChange={handleLLMToggle}
              disabled={transitioning}
              className={cn(
                "transition-opacity",
                llmEnabled
                  ? "data-[state=checked]:bg-emerald-500"
                  : "data-[state=unchecked]:bg-amber-400"
              )}
            />
          </div>
        </div>
        {!llmEnabled && (
          <div className="flex items-start gap-2 rounded-[1rem] border border-amber-300/18 bg-amber-300/[0.08] px-4 py-3 text-[11px] text-amber-100/88">
            <span className="shrink-0 mt-0.5">⚠</span>
            <span>
              Intelligence AI Agent is disabled. New claims use the deterministic Rules Engine only.
              Toggle back on to restore the full dual-agent validation pipeline.
            </span>
          </div>
        )}
      </div>

      {/* ── Provider Rows ─────────────────────────────────────────────────── */}
      <div className="space-y-1">
        <p className="px-0.5 pb-1 text-[11px] font-semibold uppercase tracking-[0.10em] text-white/30">
          AI Providers
        </p>

        {/* Auto-fallback notice when all providers disabled */}
        {llmEnabled && !groqEnabled && !anthropicEnabled && !openaiEnabled && !nvidiaEnabled && (
          <div className="mb-2 flex items-start gap-2.5 rounded-[1rem] border border-cyan-300/18 bg-cyan-300/[0.08] px-3.5 py-3">
            <span className="shrink-0 text-base leading-none mt-0.5">🤖</span>
            <div className="space-y-0.5">
              <p className="text-[11px] font-semibold text-cyan-100">
                Standard Rules Active
              </p>
              <p className="text-[11px] leading-relaxed text-cyan-100/70">
                All AI models are turned off. Claims are being checked using only basic standard rules — no AI logic, no cost. Enable at least one provider above to restore smart AI claim processing.
              </p>
            </div>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">

          <ProviderRow
            provider={{
              name:         "Intelligence AI Agent",
              description:  "Primary claim reasoning assistant — active by default",
              color:        "orange",
              models:       PRIMARY_AGENT_MODELS,
              keyField:     "groq_api_key",
              modelField:   "llm_model",
              enabledField: "groq_enabled",
              logo:         <span className="text-orange-600 dark:text-orange-400">G</span>,
            }}
            enabled={groqEnabled}
            onToggle={handleGroqToggle}
            apiKeyMasked={config?.groq_api_key ?? null}
            selectedModel={groqModel}
            onModelChange={setGroqModel}
            keyInput={groqKey}
            onKeyInputChange={setGroqKey}
            onSave={saveGroq}
            saving={groqSaving}
            isMasterDisabled={!llmEnabled}
          />

          <ProviderRow
            provider={{
              name:         "Backup Intelligence AI Agent",
              description:  "Secondary claim reasoning assistant — active by default",
              color:        "green",
              models:       BACKUP_AGENT_MODELS,
              keyField:     "nvidia_api_key",
              modelField:   "nvidia_model",
              enabledField: "nvidia_enabled",
              logo:         <span className="text-green-600 dark:text-green-400">N</span>,
            }}
            enabled={nvidiaEnabled}
            onToggle={handleNvidiaToggle}
            apiKeyMasked={config?.nvidia_api_key ?? null}
            selectedModel={nvidiaModel}
            onModelChange={setNvidiaModel}
            keyInput={nvidiaKey}
            onKeyInputChange={setNvidiaKey}
            onSave={saveNvidia}
            saving={nvidiaSaving}
            isMasterDisabled={!llmEnabled}
          />

          {/* 3. OpenAI — Disabled by default (requires API key) */}
          <ProviderRow
            provider={{
              name:         "OpenAI",
              description:  "GPT-4o family — disabled by default. Paste a key to enable.",
              color:        "emerald",
              models:       OPENAI_MODELS,
              keyField:     "openai_api_key",
              modelField:   "openai_model",
              enabledField: "openai_enabled",
              logo:         <span className="text-emerald-600 dark:text-emerald-400">O</span>,
            }}
            enabled={openaiEnabled}
            onToggle={handleOpenAIToggle}
            apiKeyMasked={config?.openai_api_key ?? null}
            selectedModel={openaiModel}
            onModelChange={setOpenaiModel}
            keyInput={openaiKey}
            onKeyInputChange={setOpenaiKey}
            onSave={saveOpenAI}
            saving={openaiSaving}
            isMasterDisabled={!llmEnabled}
          />

          {/* 4. Anthropic — Disabled by default (requires API key) */}
          <ProviderRow
            provider={{
              name:         "Anthropic",
              description:  "Claude family — disabled by default. Paste a key to enable.",
              color:        "purple",
              models:       ANTHROPIC_MODELS,
              keyField:     "anthropic_api_key",
              modelField:   "anthropic_model",
              enabledField: "anthropic_enabled",
              logo:         <span className="text-purple-600 dark:text-purple-400">A</span>,
            }}
            enabled={anthropicEnabled}
            onToggle={handleAnthropicToggle}
            apiKeyMasked={config?.anthropic_api_key ?? null}
            selectedModel={anthropicModel}
            onModelChange={setAnthropicModel}
            keyInput={anthropicKey}
            onKeyInputChange={setAnthropicKey}
            onSave={saveAnthropic}
            saving={anthropicSaving}
            isMasterDisabled={!llmEnabled}
          />

        </div>
      </div>

      {/* ── Dual-Agent Cross-Validation ───────────────────────────────────── */}
      <div className={cn(
        `${adminPanelClass} space-y-5 p-6 transition-opacity shadow-sm`,
        !llmEnabled && "opacity-40 pointer-events-none grayscale-[0.2]"
      )}>
        <div className="flex items-start justify-between">
          <div>
            <p className={`flex items-center gap-2 ${adminSectionTitleClass} text-[15px]`}>
              <Zap className="h-4 w-4 text-emerald-400" />
              Double AI Verification Framework
            </p>
            <p className={`mt-1.5 ${adminSectionCopyClass}`}>
              Compares the standard rules against the AI&apos;s decision for every part of the claim.
              {!llmEnabled && " Requires AI processing to be active."}
            </p>
          </div>
          <div className="flex items-center gap-3 bg-white/5 px-3 py-1.5 rounded-lg border border-white/10">
            <Label htmlFor="dual-enabled" className={`cursor-pointer font-bold text-[11px] uppercase tracking-wider text-white/70`}>
              {dualEnabled ? "Framework Active" : "Framework Suspended"}
            </Label>
            <Switch
              id="dual-enabled"
              checked={dualEnabled}
              onCheckedChange={setDualEnabled}
              disabled={!llmEnabled}
              className="data-[state=checked]:bg-emerald-500"
            />
          </div>
        </div>

        <div className={cn("grid sm:grid-cols-2 gap-6 pt-2", !dualEnabled && "opacity-40 pointer-events-none")}>
          <div className="space-y-2 p-4 bg-white/[0.02] border border-white/[0.04] rounded-xl">
            <Label htmlFor="agree-thresh" className="text-[11px] font-bold uppercase tracking-wider text-white/70">
              Agreement Threshold
              <span className="ml-1.5 text-emerald-400/80 font-normal normal-case tracking-normal">(auto-proceed)</span>
            </Label>
            <Input
              id="agree-thresh"
              type="number" min={0} max={1} step={0.01}
              value={agreementThreshold}
              onChange={(e) => setAgreementThreshold(e.target.value)}
              className={`${adminInputClass} h-10 text-sm font-mono`}
              disabled={!llmEnabled || !dualEnabled}
            />
            <p className="text-[11px] text-white/40 italic">Confidence score ≥ threshold → Claim auto-settles (0.0–1.0)</p>
          </div>

          <div className="space-y-2 p-4 bg-white/[0.02] border border-white/[0.04] rounded-xl">
            <Label htmlFor="conflict-thresh" className="text-[11px] font-bold uppercase tracking-wider text-white/70">
              Conflict Threshold
              <span className="ml-1.5 text-red-400/80 font-normal normal-case tracking-normal">(manual review trigger)</span>
            </Label>
            <Input
              id="conflict-thresh"
              type="number" min={0} max={1} step={0.01}
              value={conflictThreshold}
              onChange={(e) => setConflictThreshold(e.target.value)}
              className={`${adminInputClass} h-10 text-sm font-mono`}
              disabled={!llmEnabled || !dualEnabled}
            />
            <p className="text-[11px] text-white/40 italic">Confidence score &lt; threshold → Flags for human review (0.0–1.0)</p>
          </div>
        </div>

        <div className="pt-2">
          <Button
            onClick={saveDual}
            disabled={dualLoading || !llmEnabled}
            size="sm" variant="outline" className={`${adminActionButtonClass} h-10 w-full sm:w-auto px-6 text-xs font-bold transition-all`}
          >
            <Save className="mr-2 h-4 w-4" />
            {dualLoading ? "Saving Configuration…" : "Save Dual-Agent Settings"}
          </Button>
        </div>
      </div>
    </div>
  );
}
