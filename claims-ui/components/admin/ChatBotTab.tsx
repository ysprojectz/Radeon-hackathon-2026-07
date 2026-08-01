"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Cpu, MessageSquareMore, Radio, Save, Sparkles, Zap } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { SystemConfig } from "@/lib/types";
import { adminUpdateConfig } from "@/lib/api";
import { BotAvatarCanvas } from "@/components/chat/BotAvatarCanvas";
import {
  CHAT_ASSISTANT_VARIANTS,
  CHAT_ASSISTANT_VARIANT_DEFAULT,
  getChatAssistantVariant,
  type ChatAssistantVariantDefinition,
  type ChatAssistantVariantKey,
} from "@/components/chat/chatboard-presets";
import {
  adminActionButtonClass,
  adminPanelClass,
  adminSectionTitleClass,
  adminSubPanelClass,
} from "@/components/admin/admin-theme";
import { cn } from "@/lib/utils";

interface Props {
  config: SystemConfig | undefined;
  onSaved: () => void;
}

function CharacterPreviewCard({
  variant,
  selected,
  onSelect,
}: {
  variant: ChatAssistantVariantDefinition;
  selected: boolean;
  onSelect: () => void;
}) {
  const primaryMode = variant.avatarModes[0] ?? "sentinel";
  const shellClass = variant.boardStyle === "legacy"
    ? "border-white/[0.12] bg-[#0d0d0f]/96"
    : variant.boardStyle === "cinematic"
      ? "border-orange-300/16 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02)),rgba(18,12,10,0.94)]"
      : variant.boardStyle === "workspace"
        ? "border-fuchsia-300/14 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.018)),rgba(15,15,19,0.96)]"
        : "border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.018)),rgba(17,19,23,0.95)]";

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group rounded-[1.25rem] border p-5 text-left transition-all duration-300 shadow-sm hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/50",
        selected
          ? "border-brand-primary/40 bg-brand-primary/[0.08] shadow-[0_0_24px_rgba(0,216,214,0.12)_inset]"
          : "border-white/[0.08] bg-black/20 hover:border-white/[0.15] hover:bg-black/40"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[15px] font-bold text-white">{variant.name}</p>
          <p className="mt-1.5 text-[12px] leading-relaxed text-white/50">{variant.description}</p>
        </div>
        {selected ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-brand-primary drop-shadow-[0_0_8px_rgba(0,216,214,0.4)]" /> : null}
      </div>

      <div className="mt-5 overflow-hidden rounded-xl border border-white/[0.04] bg-black/40 p-4">
        <div className={cn("relative min-h-[210px] overflow-hidden rounded-[1rem] border p-4 shadow-inner", shellClass)}>
          <div className={cn("absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-white/40 to-transparent opacity-50")} />
          <div className={cn("absolute right-8 top-8 h-28 w-28 rounded-full blur-3xl opacity-75", variant.thumbnailGlow)} />
          <div className={cn("absolute inset-x-3 top-3 h-16 rounded-2xl bg-gradient-to-r opacity-80", variant.thumbnailAccent)} />

          <div className="relative z-[1] grid gap-4 sm:grid-cols-[150px_1fr]">
            <div className="relative flex min-h-[172px] items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-black/35">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_28%,rgba(255,255,255,0.13),transparent_48%)]" />
              <div className="absolute inset-x-6 bottom-5 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
              <div className="relative z-[1] transition-transform duration-300 group-hover:scale-105">
                <BotAvatarCanvas mode={primaryMode} size={118} />
              </div>
              <span className="absolute bottom-3 left-3 rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.14em] text-white/55">
                {variant.motionLabel}
              </span>
            </div>

            <div className="flex min-w-0 flex-col justify-between gap-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/35">Assistant role</p>
                  <p className="mt-1 text-[18px] font-black text-white">{variant.specialty}</p>
                </div>
                <MessageSquareMore className="h-5 w-5 shrink-0 text-white/25" />
              </div>

              <div className="grid gap-2 sm:grid-cols-3">
                {variant.traits.map((trait) => (
                  <div key={trait} className="rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.08em] text-white/58">
                    {trait}
                  </div>
                ))}
              </div>

              <div className="rounded-2xl border border-white/10 bg-black/25 p-3">
                <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.16em] text-white/35">
                  <Sparkles className="h-3.5 w-3.5 text-brand-primary" />
                  Response preview
                </div>
                <p className="mt-2 text-[11px] font-medium leading-relaxed text-white/68">
                  Short bullets, claim-aware next steps, and no repeated filler.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between text-[11px]">
        <span className="rounded-md border border-white/10 bg-white/[0.05] px-2.5 py-1 font-bold uppercase tracking-[0.16em] text-white/50">
          {variant.historyCommit}
        </span>
        <span className="inline-flex items-center gap-1.5 font-medium text-white/40">
          <Radio className="h-3.5 w-3.5" />
          {variant.historyLabel}
        </span>
      </div>
    </button>
  );
}

export function ChatBotTab({ config, onSaved }: Props) {
  const [selectedVariant, setSelectedVariant] = useState<ChatAssistantVariantKey>(CHAT_ASSISTANT_VARIANT_DEFAULT);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSelectedVariant(getChatAssistantVariant(config?.chat_assistant_variant).key);
  }, [config?.chat_assistant_variant]);

  async function save() {
    setSaving(true);
    try {
      await adminUpdateConfig({
        chat_assistant_variant: selectedVariant,
      });
      toast.success("Assistant character updated", {
        description: "The selected character and motion profile are now active across ACOS.",
      });
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update assistant character");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className={cn(adminPanelClass, "p-6 shadow-sm")}>
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/40 flex items-center gap-2">
          <Cpu className="h-4 w-4 text-brand-primary" /> Bot Character Studio
        </p>
        <p className="mt-2.5 max-w-4xl text-[14px] leading-relaxed text-white/60">
          Choose the animated assistant character users see across ACOS. The knowledge, rules, and claim context stay
          unchanged; the selected character controls the launcher personality and motion profile.
        </p>
      </div>

      <section className={cn(adminPanelClass, "p-6 space-y-5 shadow-sm")}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className={cn(adminSectionTitleClass, "text-[16px]")}>Character Library</h3>
            <p className="mt-1 text-xs text-white/40">Select one animated tech assistant for the product launcher</p>
          </div>
          <Button
            type="button"
            onClick={save}
            disabled={saving}
            className={cn(adminActionButtonClass, "h-10 px-6 font-bold")}
          >
            <Save className="mr-2 h-4 w-4" />
            {saving ? "Saving Character..." : "Save Character"}
          </Button>
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          {CHAT_ASSISTANT_VARIANTS.map((variant) => (
            <CharacterPreviewCard
              key={variant.key}
              variant={variant}
              selected={selectedVariant === variant.key}
              onSelect={() => setSelectedVariant(variant.key)}
            />
          ))}
        </div>
      </section>

      <section className={cn(adminSubPanelClass, "p-5")}>
        <h3 className={cn(adminSectionTitleClass, "text-[14px] font-bold text-white/80")}>Productivity Contract</h3>
        <div className="mt-3 grid gap-3 text-xs font-medium leading-relaxed text-white/50 md:grid-cols-3">
          <div className="flex gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" /> Answers stay short, action-first, and claim-aware.</div>
          <div className="flex gap-2"><Zap className="h-4 w-4 text-brand-primary shrink-0" /> Suggestions continue to use the current page and operational context.</div>
          <div className="flex gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" /> Character choice changes motion and launcher identity only.</div>
        </div>
      </section>
    </div>
  );
}
