import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"
import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

// Four variants only (DESIGN_SYSTEM.md §4): Primary (default), Secondary
// (outline/secondary — same look, kept as two keys for lower-risk migration
// across existing call sites), Ghost, Destructive. `link` is a plain text
// utility kept for inline links, not one of the four card/toolbar variants.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-button)] text-sm font-semibold tracking-[0.01em] transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)]",
  {
    variants: {
      variant: {
        default: "bg-brand-primary text-white hover:bg-brand-primary-hover active:scale-[0.97] transition-all duration-150",
        destructive:
          "bg-[var(--status-danger)] text-white hover:brightness-110 active:scale-[0.97]",
        outline:
          "border border-[var(--border-strong)] bg-transparent text-[var(--text-primary)] hover:bg-[var(--acos-surface)]",
        secondary:
          "border border-[var(--border-strong)] bg-transparent text-[var(--text-primary)] hover:bg-[var(--acos-surface)]",
        ghost:
          "hover:bg-[var(--acos-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]",
        link: "text-brand-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 text-sm font-semibold tracking-[0.01em] rounded-[var(--radius-button)]",
        xs: "h-7 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 px-3 text-xs font-semibold rounded-[var(--radius-button)]",
        lg: "h-10 px-6 text-sm font-semibold rounded-[var(--radius-button)]",
        xl: "h-11 rounded-[var(--radius-button)] px-8 text-base has-[>svg]:px-6",
        icon: "h-9 w-9 rounded-[var(--radius-button)]",
        "icon-xs": "size-7 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  loading = false,
  children,
  disabled,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    loading?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={disabled || loading}
      {...props}
    >
      {asChild ? children : (
        <>
          {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {children}
        </>
      )}
    </Comp>
  )
}

export { Button, buttonVariants }
