"use client";

import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { MARKET_CURRENCY, MARKET_FLAGS, MARKET_LABELS } from "@/lib/constants";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface DashboardRegionFilterProps {
  marketRegion: string;
  displayCurrency: string;
  onMarketChange: (market: string) => void;
}

export function DashboardRegionFilter({
  marketRegion,
  displayCurrency,
  onMarketChange,
}: DashboardRegionFilterProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Filter dashboard by region"
          className="flex items-center gap-1.5 rounded-2xl border border-white/5 bg-white/5 px-3 py-2 transition-all duration-200 hover:-translate-y-0.5 hover:border-white/15 hover:bg-white/10 active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-dashboard-bg"
        >
          <span className="text-base leading-none">
            {marketRegion ? MARKET_FLAGS[marketRegion] : "🌍"}
          </span>
          <span className="text-sm font-bold uppercase tracking-widest text-white/80">
            {marketRegion || "Global"}
          </span>
          <span className="rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2 py-1 text-[10px] font-black text-cyan-200">
            {displayCurrency}
          </span>
          <ChevronDown className="h-3.5 w-3.5 text-white/40" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="min-w-[260px]">
        <DropdownMenuLabel>Market Region</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => onMarketChange("")}
          className={cn(!marketRegion && "bg-brand-primary/10 text-white")}
        >
          <span className="text-lg leading-none">🌐</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Global</p>
            <p className="text-[10px] uppercase tracking-[0.14em] text-white/30">Display in USD</p>
          </div>
        </DropdownMenuItem>

        {Object.keys(MARKET_LABELS).map((market) => (
          <DropdownMenuItem
            key={market}
            onSelect={() => onMarketChange(market)}
            className={cn(marketRegion === market && "bg-brand-primary/10 text-white")}
          >
            <span className="text-lg leading-none">{MARKET_FLAGS[market] ?? "🏳️"}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{MARKET_LABELS[market] ?? market}</p>
              <p className="text-[10px] uppercase tracking-[0.14em] text-white/30">{MARKET_CURRENCY[market] ?? "USD"}</p>
            </div>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
