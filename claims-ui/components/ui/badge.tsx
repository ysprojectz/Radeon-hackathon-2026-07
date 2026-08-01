import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center justify-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-[0.01em] w-fit whitespace-nowrap shrink-0 [&>svg]:size-3 gap-1 [&>svg]:pointer-events-none transition-all overflow-hidden",
  {
    variants: {
      variant: {
        default: "bg-brand-primary/10 text-brand-primary border-brand-primary/25 [a&]:hover:bg-brand-primary/16",
        secondary:
          "bg-[var(--acos-surface)] text-[var(--text-secondary)] border-[var(--border-subtle)] [a&]:hover:bg-[var(--surface-raised)]",
        destructive:
          "bg-[var(--status-danger)]/10 text-[var(--status-danger)] border-[var(--status-danger)]/25 [a&]:hover:bg-[var(--status-danger)]/16",
        success:
          "bg-[var(--status-success)]/10 text-[var(--status-success)] border-[var(--status-success)]/25 [a&]:hover:bg-[var(--status-success)]/16",
        warning:
          "bg-[var(--status-warning)]/10 text-[var(--status-warning)] border-[var(--status-warning)]/25 [a&]:hover:bg-[var(--status-warning)]/16",
        outline:
          "bg-transparent border-[var(--border-subtle)] text-[var(--text-muted)] [a&]:hover:bg-[var(--acos-surface)]",
        ghost: "border-transparent text-[var(--text-muted)] [a&]:hover:bg-[var(--acos-surface)]",
        link: "text-brand-primary underline-offset-4 [a&]:hover:underline border-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
