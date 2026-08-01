"use client";
import { SWRConfig } from "swr";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "next-themes";
import ToastProvider from "@/components/ui/toast";
import { NuqsAdapter } from "nuqs/adapters/next/app";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <NuqsAdapter>
      <ThemeProvider
        attribute="class"
        defaultTheme="light"
        forcedTheme="light"
        enableSystem={false}
        disableTransitionOnChange
      >
        <SWRConfig value={{ shouldRetryOnError: false, revalidateOnFocus: false }}>
          <TooltipProvider>
            {children}
            <ToastProvider />
          </TooltipProvider>
        </SWRConfig>
      </ThemeProvider>
    </NuqsAdapter>
  );
}
