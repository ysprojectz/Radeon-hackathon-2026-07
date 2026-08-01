"use client";

/**
 * AuthLayout
 * ──────────
 * Wraps every page in the Claims Portal:
 *   • /login, /landing  → render children bare (no AppShell, no auth check)
 *   • /  (root)         → unauthenticated → redirect to /landing
 *                         authenticated   → render dashboard inside AppShell
 *   • all other routes  → unauthenticated → redirect to /login?next=<path>
 *                         authenticated   → render inside AppShell
 *
 * This lives between the root layout (Server Component) and the pages, so it
 * can use Next.js client hooks (usePathname, useRouter) without polluting the
 * root Server layout.
 */

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { TransientAuthCheckError, fetchCurrentUser } from "@/lib/auth";
import { getMyScreenAccess } from "@/lib/api";
import { getAllowedScreenIdsForUser, getDefaultGroups, getScreenIdForPath } from "@/lib/screen-access";
import { AppShell } from "./AppShell";
import { MobileGate } from "./MobileGate";
import type { ReactNode } from "react";

const PUBLIC_PATHS = new Set(["/login", "/landing", "/title-preview"]);
// Routes that require a specific role in addition to group screen access.
const ROLE_PROTECTED: Record<string, string> = {
  "/admin": "ADMIN",
  "/master-settings": "ADMIN",
};

export function AuthLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router   = useRouter();

  // fetchCurrentUser hits /auth/me with the httpOnly cookie — must run client-side
  const [checked, setChecked] = useState(false);
  const [authed,  setAuthed]  = useState(false);
  const [currentUser, setCurrentUser] = useState<Awaited<ReturnType<typeof fetchCurrentUser>>>(null);
  const [routeAllowed, setRouteAllowed] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryAttempt = 0;

    const checkAuth = () => {
      fetchCurrentUser({ strict: true })
        .then((user) => {
          if (cancelled) return;
          const ok = user !== null;
          setCurrentUser(user);
          setAuthed(ok);
          setChecked(true);

          if (ok && PUBLIC_PATHS.has(pathname)) {
            router.replace("/");
            return;
          }

          if (!ok && !PUBLIC_PATHS.has(pathname)) {
            // Root URL → send unauthenticated visitors to the public landing page
            // Any other protected path → send to login with a post-login redirect
            if (pathname === "/") {
              router.replace("/landing");
            } else {
              router.replace(`/login?next=${encodeURIComponent(pathname)}`);
            }
            return;
          }

          // Role-based protection: admin-only routes still require ADMIN.
          if (ok && user) {
            const requiredRole = Object.entries(ROLE_PROTECTED).find(([prefix]) =>
              pathname.startsWith(prefix)
            )?.[1];
            if (requiredRole && user.role !== requiredRole) {
              router.replace("/");
              return;
            }

            const screenId = getScreenIdForPath(pathname, window.location.hash);
            const fallback = getAllowedScreenIdsForUser(getDefaultGroups(), {
              role: user.role,
              market_region: user.market_region,
              is_active: user.is_active,
            });
            getMyScreenAccess()
              .catch(() => ({ allowed_screen_ids: fallback, allowed_hrefs: [] }))
              .then((access) => {
                if (cancelled || !screenId) return;
                if (!access.allowed_screen_ids.includes(screenId)) {
                  setRouteAllowed(false);
                  router.replace("/");
                } else {
                  setRouteAllowed(true);
                }
              });
          }
        })
        .catch((error) => {
          if (cancelled) return;
          if (error instanceof TransientAuthCheckError) {
            setChecked(false);
            const retryDelayMs = Math.min(10_000, 1500 * 2 ** retryAttempt);
            retryAttempt += 1;
            retryTimer = setTimeout(checkAuth, retryDelayMs);
            return;
          }
          setAuthed(false);
          setCurrentUser(null);
          setChecked(true);
          if (!PUBLIC_PATHS.has(pathname)) {
            router.replace(`/login?next=${encodeURIComponent(pathname)}`);
          }
        });
    };

    checkAuth();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [pathname, router]);

  // Login page — bypass AppShell entirely (but still gate mobile)
  if (PUBLIC_PATHS.has(pathname)) {
    return <>{children}</>;
  }

  // Still checking auth on first render — show nothing (avoids flash)
  if (!checked) {
    return (
      <div className="flex h-screen items-center justify-center bg-dashboard-bg">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-cyan-400/50 border-t-cyan-300" />
      </div>
    );
  }

  // Not authed → redirect in progress, render empty
  if (!authed) return null;

  const requiredRole = Object.entries(ROLE_PROTECTED).find(([prefix]) =>
    pathname.startsWith(prefix)
  )?.[1];
  if (requiredRole && currentUser?.role !== requiredRole) {
    return null;
  }
  if (!routeAllowed) return null;

  return <MobileGate><AppShell>{children}</AppShell></MobileGate>;
}
