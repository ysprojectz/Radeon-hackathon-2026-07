"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  FileText,
  FileCheck,
  SlidersHorizontal,
  Settings2,
  LogOut,
  AlertTriangle,
  ReceiptText,
  CreditCard,
  LayoutDashboard,
  Activity,
  Shield,
  Minus,
  Pin,
} from "lucide-react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useHITLQueue } from "@/lib/hooks/useHITLQueue";
import { fetchCurrentUser, serverLogout, type StoredUser } from "@/lib/auth";
import { getMyScreenAccess } from "@/lib/api";
import { getAllowedScreenIdsForUser, getDefaultGroups, getScreenIdForPath } from "@/lib/screen-access";
import { motion } from "motion/react";
import { AcosLogo } from "@/components/shared/AcosLogo";
import { useDevice } from "@/hooks/useDevice";
import { SPRING_PHYSICS } from "@/lib/motion";

const NAV_SECTIONS = [
  {
    title: "Data",
    items: [
      { href: "/",              label: "Dashboard", icon: LayoutDashboard, screenId: "dashboard" },
      { href: "/reports",       label: "Reports",   icon: ReceiptText, screenId: "reports" },
    ],
  },
  {
    title: "Operations",
    items: [
      { href: "/hitl",            label: "Review Queue",    icon: AlertTriangle, screenId: "hitl" },
      { href: "/claims",          label: "Claims List",     icon: FileText, screenId: "claims" },
      { href: "/operations/lifecycle", label: "Claim Journey", icon: Activity, screenId: "claim-journey" },
      { href: "/accounts",        label: "Accounts",        icon: CreditCard, screenId: "accounts" },
      { href: "/submit",          label: "Claim Submission", icon: FileCheck, screenId: "submit" },
    ],
  },
  {
    title: "System Control",
    items: [
      { href: "/settings", label: "Settings", icon: SlidersHorizontal, screenId: "settings" },
      { href: "/settings?section=master-settings", label: "Master Settings", icon: Settings2, screenId: "master-settings" },
      { href: "/settings?section=admin-console#operations", label: "Admin Console", icon: Shield, screenId: "admin-console" },
    ],
  },
];

const HITL_BADGE_ROLES = new Set(["ADMIN", "SENIOR_ADJUSTER", "MEDICAL_DIRECTOR"]);

function NavLink({
  item,
  active,
  badge,
  isFrozen,
  onNavigate,
}: {
  item: { href: string; label: string; screenId: string; icon: React.ComponentType<{ className?: string; strokeWidth?: number }> };
  active: boolean;
  badge?: number;
  isFrozen: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={cn(
        "sidebar-nav-button flex items-center group relative overflow-hidden rounded-2xl transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar-bg",
        "active:scale-[0.98] transition-transform",
        isFrozen ? "h-14 px-0 justify-center" : "px-5 py-4",
        active ? "text-white" : "text-[var(--acos-text-muted)] hover:text-[var(--acos-text)] hover:bg-[var(--acos-surface)]",
      )}
      title={isFrozen ? item.label : undefined}
    >
      {active && (
        <motion.div
          layoutId="active-nav-bg"
          className="absolute inset-0 z-0 bg-brand-primary"
          style={{ borderRadius: "1rem" }}
          transition={SPRING_PHYSICS.fluid}
        />
      )}

      <div className={cn(
        "sidebar-icon-shell relative z-10 flex items-center justify-center shrink-0",
        active && "sidebar-icon-shell-active after:absolute after:inset-[-8px] after:rounded-2xl after:bg-dashboard-bg/18 after:blur-md after:content-['']"
      )}>
        <item.icon
          className={cn(
            "h-[22px] w-[22px] transition-colors duration-200",
            "sidebar-icon-motion",
            active ? "text-white" : "group-hover:text-brand-primary"
          )}
          strokeWidth={active ? 2.5 : 2}
        />
        {(badge ?? 0) > 0 && !active && isFrozen && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-brand-primary/10 border border-brand-primary/20 px-1 text-[10px] font-bold text-brand-primary">
            {badge}
          </span>
        )}
      </div>

      <span className={cn(
        "flex-1 text-left whitespace-nowrap ml-4 font-bold text-[13px] uppercase tracking-wide relative z-10",
        active ? "text-white" : "text-[var(--acos-text-muted)] group-hover:text-[var(--acos-text)]",
        isFrozen && "hidden"
      )}>
        {item.label}
      </span>

      {(badge ?? 0) > 0 && !active && !isFrozen && (
        <span className="relative z-10 px-2 py-0.5 bg-brand-primary/10 border border-brand-primary/20 text-brand-primary rounded-lg text-[9px] font-black shrink-0 ml-2">
          {badge}
        </span>
      )}
    </Link>
  );
}

export function Sidebar({
  isMobileOpen = false,
  onMobileClose,
}: {
  isMobileOpen?: boolean;
  onMobileClose?: () => void;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentSection = searchParams.get("section");
  const router = useRouter();
  const { type } = useDevice();
  const [currentUser, setCurrentUser] = useState<StoredUser | null>(null);
  const [allowedScreenIds, setAllowedScreenIds] = useState<Set<string> | null>(null);
  const canLoadHITLBadge = currentUser ? HITL_BADGE_ROLES.has(currentUser.role) : false;
  const { queue } = useHITLQueue(canLoadHITLBadge);
  const manualReviewCount = queue?.pending_count ?? 0;
  const [currentHash, setCurrentHash] = useState(() =>
    typeof window === "undefined" ? "" : window.location.hash
  );
  
  // Auto-freeze for tablets and below
  const [isFrozen, setIsFrozen] = useState(false);
  const sidebarIsFrozen = isMobileOpen ? false : isFrozen;
  const canUseFreezeControl = !isMobileOpen;

  useEffect(() => {
    if (type === "tablet" || type === "mobile") {
      setIsFrozen(true);
    } else {
      setIsFrozen(false);
    }
  }, [type]);

  useEffect(() => {
    function loadUserAndAccess() {
      fetchCurrentUser()
        .then((user) => {
          setCurrentUser(user);
          if (!user) {
            setAllowedScreenIds(null);
            return;
          }
          const fallback = getAllowedScreenIdsForUser(getDefaultGroups(), {
            role: user.role,
            market_region: user.market_region,
            is_active: user.is_active,
          });
          setAllowedScreenIds(new Set(fallback));
          getMyScreenAccess()
            .then((access) => setAllowedScreenIds(new Set(access.allowed_screen_ids)))
            .catch(() => setAllowedScreenIds(new Set(fallback)));
        })
        .catch(() => {
          setCurrentUser(null);
          setAllowedScreenIds(null);
        });
    }

    loadUserAndAccess();
    window.addEventListener("acos-screen-access-updated", loadUserAndAccess);
    return () => window.removeEventListener("acos-screen-access-updated", loadUserAndAccess);
  }, []);

  useEffect(() => {
    function syncHash() {
      setCurrentHash(window.location.hash);
    }

    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  const isActive = (href: string) => {
    const [beforeHash, targetHash] = href.split("#");
    const [targetPath, targetQuery] = beforeHash.split("?");
    if (targetPath === "/") return pathname === "/" && !targetHash;
    if (pathname !== targetPath && !pathname.startsWith(targetPath + "/")) {
      return false;
    }
    // /settings, /settings?section=master-settings and
    // /settings?section=admin-console all share one pathname — the query's
    // `section` param is what actually distinguishes them (unified settings
    // page, see app/settings/SettingsWorkspace.tsx).
    const targetSection = targetQuery ? new URLSearchParams(targetQuery).get("section") : null;
    if (targetSection !== currentSection) return false;
    if (targetPath === "/admin" && !targetHash && currentHash) {
      return false;
    }
    return targetHash ? currentHash === `#${targetHash}` : true;
  };

  const visibleSections = NAV_SECTIONS
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => {
        if (!currentUser) return false;
        if (item.screenId === "master-settings" || item.screenId === "admin-console") {
          if (currentUser.role !== "ADMIN") return false;
        }
        const screenId = item.screenId ?? getScreenIdForPath(item.href.split("#")[0], item.href.includes("#") ? `#${item.href.split("#")[1]}` : "");
        return screenId ? (allowedScreenIds?.has(screenId) ?? true) : true;
      }),
    }))
    .filter((section) => section.items.length > 0);

  function handleLogout() {
    serverLogout().finally(() => router.push("/login"));
  }

  return (
    <>
      {isMobileOpen && (
        <button
          type="button"
          aria-label="Close navigation menu"
          className="fixed inset-0 z-40 bg-black/30 dark:bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={onMobileClose}
        />
      )}
    <aside
      className={cn(
        "fixed inset-y-0 left-0 flex flex-col h-screen shrink-0 select-none z-50 overflow-hidden border-r border-[var(--border-subtle)] lg:sticky",
        "top-0 bg-sidebar-bg/90 backdrop-blur-3xl shadow-[30px_0_40px_rgba(0,0,0,0.18)] dark:shadow-[30px_0_60px_rgba(0,0,0,0.7)] transition-all duration-300",
        isMobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0",
        sidebarIsFrozen ? "w-28" : "w-80"
      )}
      aria-label="Primary navigation"
    >
      <div className="absolute inset-0 bg-brand-primary/[0.01] shadow-[inset_0_0_100px_rgba(0,216,214,0.02)] pointer-events-none" />

      <div className={cn("flex items-center justify-center shrink-0 relative", sidebarIsFrozen ? "h-32 flex-col gap-2" : "h-36")}>
        <button
          type="button"
          onClick={() => router.push("/")}
          aria-label="Go to Dashboard"
          className={cn(
            "flex items-center justify-center text-brand-primary shrink-0 cursor-pointer",
            sidebarIsFrozen && "h-16 w-16 overflow-visible"
          )}
        >
          <AcosLogo
            iconOnly={sidebarIsFrozen}
            stacked={!sidebarIsFrozen}
            showLabel={!sidebarIsFrozen}
            className="relative z-10"
          />
        </button>
        {canUseFreezeControl && !sidebarIsFrozen && (
          <button
            type="button"
            onClick={() => setIsFrozen(true)}
            className="absolute right-5 top-5 flex h-8 w-8 items-center justify-center rounded-xl border border-[var(--border-subtle)] bg-[var(--acos-surface-muted)] text-[var(--acos-text-subtle)] transition-colors hover:border-brand-primary/30 hover:bg-brand-primary/10 hover:text-brand-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar-bg"
            aria-label="Freeze sidebar"
            title="Freeze sidebar"
          >
            <Pin size={15} />
          </button>
        )}
        {canUseFreezeControl && sidebarIsFrozen && (
          <button
            type="button"
            onClick={() => setIsFrozen(false)}
            className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--acos-surface-muted)] px-2.5 text-[var(--acos-text-subtle)] transition-colors hover:border-brand-primary/30 hover:bg-brand-primary/10 hover:text-brand-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar-bg"
            aria-label="Unfreeze sidebar"
            title="Unfreeze sidebar"
          >
            <span className="text-[8px] font-black uppercase tracking-[0.22em]">ACOS</span>
            <Minus size={13} strokeWidth={3} />
          </button>
        )}
      </div>

      <nav
        className={cn(
          "flex-1 overflow-y-auto scrollbar-hide overflow-x-hidden flex flex-col justify-center py-8",
          sidebarIsFrozen ? "px-6 gap-5" : "px-6 gap-6"
        )}
        aria-label="Main"
      >
        {visibleSections.map((section, idx) => (
          <div key={section.title} className={cn("w-full", sidebarIsFrozen && "flex flex-col items-center", idx > 0 && "mt-0")}>
            {!sidebarIsFrozen && (
              <h3 className="px-4 text-[9px] font-black text-[var(--acos-text-subtle)] uppercase tracking-[0.4em] mb-3 whitespace-nowrap">
                {section.title}
              </h3>
            )}
            <div className={cn("w-full", sidebarIsFrozen ? "space-y-2" : "space-y-2.5")}>
              {section.items.map((item) => (
                <NavLink
                  key={item.href}
                  item={item}
                  active={isActive(item.href)}
                  badge={item.href === "/hitl" ? manualReviewCount : undefined}
                  isFrozen={sidebarIsFrozen}
                  onNavigate={isMobileOpen ? onMobileClose : undefined}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className={cn("mt-auto shrink-0 border-t border-[var(--border-subtle)]", sidebarIsFrozen ? "p-5" : "p-6")}>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <button className={cn(
              "flex items-center group relative w-full rounded-2xl text-[var(--acos-text-subtle)] hover:text-red-500 dark:hover:text-red-300 hover:bg-red-500/10 hover:shadow-[0_0_28px_rgba(239,68,68,0.12)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar-bg",
              sidebarIsFrozen ? "h-14 justify-center px-0" : "px-5 py-4"
            )}>
              <LogOut
                size={22}
                strokeWidth={2.5}
                className="transition-transform duration-300 shrink-0 group-hover:-translate-x-1"
              />
              <span className={cn(
                "text-[13px] font-bold uppercase tracking-wide whitespace-nowrap ml-4 text-[var(--acos-text-muted)] group-hover:text-red-500 dark:group-hover:text-red-300",
                sidebarIsFrozen && "hidden"
              )}>
                Sign Out
              </span>
            </button>
          </AlertDialogTrigger>
          <AlertDialogContent className="ui-modal-surface">
            <AlertDialogHeader>
              <AlertDialogTitle style={{ color: "var(--text-primary)" }}>Sign out?</AlertDialogTitle>
              <AlertDialogDescription style={{ color: "var(--text-muted)" }}>
                Are you sure you want to sign out? You will need to log in again to access the system.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel style={{ background: "var(--surface-raised)", borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={handleLogout} className="bg-red-600 hover:bg-red-700 text-white">
                Sign Out
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </aside>
    </>
  );
}
