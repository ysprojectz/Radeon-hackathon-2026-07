import * as React from "react"

import { cn } from "@/lib/utils"

type CardVariant = "default" | "dashboard" | "kpi" | "surface"

const cardVariantClassName: Record<CardVariant, string> = {
  default: "glass-card flex flex-col gap-6 py-6 text-[var(--text-primary)]",
  dashboard: "dashboard-panel",
  kpi: "pro-kpi-card",
  surface: "rounded-2xl border border-[var(--border-subtle)] bg-[var(--acos-surface)] text-[var(--text-primary)]",
}

function cardSurfaceClassName(variant: CardVariant = "default", className?: string) {
  return cn(cardVariantClassName[variant], className)
}

function Card({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"div"> & { variant?: CardVariant }) {
  return (
    <div
      data-slot="card"
      className={cardSurfaceClassName(variant, className)}
      {...props}
    />
  )
}

function CardAccent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-accent"
      aria-hidden="true"
      className={cn("dashboard-panel-accent", className)}
      {...props}
    />
  )
}

function CardGlow({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-glow"
      aria-hidden="true"
      className={cn("dashboard-panel-glow", className)}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-2 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn("text-lg font-semibold leading-none tracking-normal text-[var(--text-primary)]", className)}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-[var(--text-muted)]", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        className
      )}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      className={cn("px-6", className)}
      {...props}
    />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn("flex items-center px-6 [.border-t]:pt-6", className)}
      {...props}
    />
  )
}

export {
  Card,
  CardAccent,
  CardHeader,
  CardFooter,
  CardGlow,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
  cardSurfaceClassName,
}
