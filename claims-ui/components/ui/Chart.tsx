import * as React from "react"

import { cn } from "@/lib/utils"

type ChartProps = React.ComponentProps<"div"> & {
  minHeight?: number | string
}

function Chart({ className, minHeight, style, ...props }: ChartProps) {
  return (
    <div
      data-slot="chart"
      className={cn("min-h-0", className)}
      style={{ minHeight, ...style }}
      {...props}
    />
  )
}

function ChartLoading({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="chart-loading"
      className={cn("h-64 animate-pulse rounded-2xl border border-white/[0.05] bg-white/[0.03]", className)}
      {...props}
    />
  )
}

function ChartEmpty({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="chart-empty"
      className={cn("flex h-64 items-center justify-center text-sm font-semibold text-white/25", className)}
      {...props}
    />
  )
}

export { Chart, ChartEmpty, ChartLoading }
