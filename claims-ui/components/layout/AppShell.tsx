"use client";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { ClaimAssistant } from "@/components/chat/ClaimAssistant";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { PageHeaderProvider } from "./PageHeaderContext";

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
    setIsMobileMenuOpen(false); // Close menu on route change
  }, [pathname]);

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const node = scrollRef.current;
    if (!node) return;

    const frame = window.requestAnimationFrame(() => {
      const contentIsClipped =
        node.scrollHeight > node.clientHeight &&
        getComputedStyle(node).overflowY === "hidden";
      if (contentIsClipped) {
        console.warn(
          `[AppShell sanity check] Content is clipped for route "${pathname}". Enable vertical scrolling on the page container.`
        );
      }
    });

    return () => window.cancelAnimationFrame(frame);
  }, [pathname, children]);

  return (
    <PageHeaderProvider>
      <div
        className="acos-app-shell relative flex h-screen overflow-hidden font-sans selection:bg-brand-primary selection:text-white"
      >
        <Sidebar
          isMobileOpen={isMobileMenuOpen}
          onMobileClose={() => setIsMobileMenuOpen(false)}
        />

        <main className="relative z-10 flex min-w-0 flex-1 flex-col overflow-hidden">
          <Topbar onMenuClick={() => setIsMobileMenuOpen(true)} />

          <div
            ref={scrollRef}
            className="app-scroll-container scrollbar-styled flex-1 overflow-x-hidden overflow-y-auto pb-[calc(1rem+env(safe-area-inset-bottom))] sm:pb-[calc(1.25rem+env(safe-area-inset-bottom))]"
            style={{
              paddingLeft: "var(--section-padding)",
              paddingRight: "var(--section-padding)",
              paddingTop: "calc(var(--grid-gap) * 1.5)",
            }}
          >
            <div className="mx-auto w-full max-w-screen-2xl min-h-full">
              <div key={pathname} className="cinematic-page-in min-h-full">
                <ErrorBoundary>
                  {children}
                </ErrorBoundary>
              </div>
            </div>
          </div>
        </main>

        <ClaimAssistant />
      </div>
    </PageHeaderProvider>
  );
}
