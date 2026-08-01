"use client";
import { formatCurrency } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface CurrencyAmountProps {
  amount: string | number | undefined | null;
  currency?: string;
  className?: string;
  bold?: boolean;
}

export function CurrencyAmount({
  amount,
  currency = "INR",
  className,
  bold,
}: CurrencyAmountProps) {
  return (
    <span className={cn(bold && "font-semibold", className)}>
      {formatCurrency(amount, currency)}
    </span>
  );
}
