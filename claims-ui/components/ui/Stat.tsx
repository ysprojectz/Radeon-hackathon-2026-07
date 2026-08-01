import * as React from "react"

import { cn } from "@/lib/utils"

type StatProps = React.HTMLAttributes<HTMLElement> & {
  as?: React.ElementType
  bare?: boolean
  type?: string
  tone?: "neutral" | "success" | "warning" | "danger" | "info" | "violet" | "custom"
}

const toneClassName: Record<Exclude<NonNullable<StatProps["tone"]>, "custom">, string> = {
  neutral: "border-white/[0.06] bg-white/[0.035] text-white/78",
  success: "border-emerald-300/15 bg-emerald-300/[0.07] text-emerald-200",
  warning: "border-amber-300/15 bg-amber-300/[0.07] text-amber-200",
  danger: "border-red-400/15 bg-red-400/[0.07] text-red-300",
  info: "border-cyan-400/15 bg-cyan-400/[0.07] text-cyan-200",
  violet: "border-violet-400/15 bg-violet-400/[0.07] text-violet-200",
}

function Stat({ as: Component = "div", bare, className, tone = "neutral", ...props }: StatProps) {
  return (
    <Component
      data-slot="stat"
      className={cn(!bare && "rounded-2xl border px-3 py-2.5", !bare && tone !== "custom" && toneClassName[tone], className)}
      {...props}
    />
  )
}

function StatLabel({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="stat-label"
      className={cn("text-[8px] font-black uppercase tracking-[0.16em] text-white/34", className)}
      {...props}
    />
  )
}

function StatValue({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <p
      data-slot="stat-value"
      className={cn("mt-1 font-mono text-lg font-black leading-none tabular-nums", className)}
      {...props}
    />
  )
}

export { Stat, StatLabel, StatValue }
