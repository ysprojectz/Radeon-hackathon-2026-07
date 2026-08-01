"use client";

import { useMemo } from "react";
import { USD_FX_RATES, MARKET_CURRENCY } from "@/lib/constants";

export interface CurrencyConversionResult {
  convert: (amount: number | string) => number;
  marketCurrency: string;
  displayCurrency: string;
  rate: number;
}

export function useCurrencyConversion(
  marketRegion: string,
  targetCurrency: string = "USD"
): CurrencyConversionResult {
  const marketCurrency = marketRegion ? MARKET_CURRENCY[marketRegion] ?? "USD" : "USD";

  const convert = useMemo(() => {
    return (amount: number | string): number => {
      const num = typeof amount === "string" ? parseFloat(amount) : amount;
      if (isNaN(num)) return 0;

      const marketRate = USD_FX_RATES[marketCurrency] ?? 1;
      const targetRate = USD_FX_RATES[targetCurrency] ?? 1;

      // Rates are stored as 1 unit of currency = X USD.
      const amountInUSD = num * marketRate;
      return amountInUSD / targetRate;
    };
  }, [targetCurrency, marketCurrency]);

  return {
    convert,
    marketCurrency,
    displayCurrency: targetCurrency,
    rate: (USD_FX_RATES[marketCurrency] ?? 1) / (USD_FX_RATES[targetCurrency] ?? 1),
  };
}
