"use client";
import {
  LogOut,
  User,
  Shield,
  Menu,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fetchCurrentUser, serverLogout, type StoredUser } from "@/lib/auth";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { AnimatePresence, motion } from "motion/react";
import { usePageHeader } from "./PageHeaderContext";
import { SupportPanel } from "./SupportPanel";

export function Topbar({ onMenuClick }: { onMenuClick?: () => void }) {
  const router = useRouter();
  const { header } = usePageHeader();
  const hasHeaderSubtitle = Boolean(header?.subtitle);
  const [mounted, setMounted] = useState(false);
  const [currentUser, setCurrentUser] = useState<StoredUser | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
    fetchCurrentUser().then(setCurrentUser);
  }, []);

  // Close profile panel on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (
        profileRef.current &&
        !profileRef.current.contains(e.target as Node)
      ) {
        setProfileOpen(false);
      }
    }
    if (profileOpen) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [profileOpen]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setProfileOpen(false);
    }
    if (profileOpen) {
      document.addEventListener("keydown", onKeyDown);
      return () => document.removeEventListener("keydown", onKeyDown);
    }
  }, [profileOpen]);

  const hasHeaderActions = Boolean(header?.actions);

  const userLabel =
    currentUser?.full_name ?? currentUser?.email ?? "Claims Processor";
  const userRole = currentUser?.role ?? "";
  const userInitials = currentUser?.full_name
    ? currentUser.full_name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "CP";

  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    setLoggingOut(true);
    try {
      await serverLogout();
    } catch {
      // best-effort
    }
    window.location.href = "/login";
  }

  return (
    <header
      className="acos-topbar sticky top-0 z-50 w-full shrink-0"
    >
      <div className="flex items-center justify-between h-full px-6 sm:px-8 lg:px-12 gap-6 mt-1">
        {/* Mobile Menu Toggle */}
        <button
          onClick={onMenuClick}
          className="acos-icon-button shrink-0 lg:hidden"
          aria-label="Open navigation menu"
        >
          <Menu className="h-4 w-4" />
        </button>

        {/* Left zone: page title */}
        <div className="min-w-0 flex-1 py-2">
          {header && (
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-3">
                <div className="w-[3px] h-5 shrink-0 rounded-full bg-brand-primary" />
                <div className="min-w-0 pt-0.5">
                  <h1 className="acos-topbar-title truncate whitespace-nowrap text-base font-extrabold tracking-normal">
                    {header.title}
                  </h1>
                  {hasHeaderSubtitle && (
                    <p className="acos-topbar-subtitle text-[11px] font-medium leading-none mt-0.5">
                      {header?.subtitle}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>



        {/* Right zone */}
        <div className="flex shrink-0 items-center gap-2 lg:gap-3">
          {/* PageHeader actions slot */}
          {hasHeaderActions && (
            <div className="flex shrink-0 items-center">
              {header?.actions}
            </div>
          )}

          <SupportPanel />

          {/* Divider */}
          <div className="acos-topbar-divider hidden lg:block w-px h-7" />

          {/* User avatar + profile popup */}
          {mounted && (
            <div className="relative" ref={profileRef}>
              <button
                onClick={() => setProfileOpen((o) => !o)}
                className="flex items-center gap-2 cursor-pointer group rounded-xl px-2 py-1 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/60 focus-visible:ring-offset-2"
                style={{ "--tw-ring-offset-color": "var(--page-bg)" } as React.CSSProperties}
                aria-label="Open profile menu"
              >
                <div
                  className={cn(
                    "flex items-center justify-center font-bold text-sm transition-all",
                    profileOpen ? "shadow-[0_0_16px_rgba(var(--brand-primary),0.3)]" : ""
                  )}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: "50%",
                    background: "color-mix(in srgb, var(--brand-primary) 15%, transparent)",
                    border: profileOpen
                      ? "1.5px solid var(--brand-primary)"
                      : "1.5px solid color-mix(in srgb, var(--brand-primary) 30%, transparent)",
                    color: "var(--brand-primary)",
                    fontSize: "0.75rem",
                    fontWeight: 700,
                  }}
                >
                  {userInitials}
                </div>
              </button>

              {/* Profile dropdown */}
              <AnimatePresence>
                {profileOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 8, scale: 0.98 }}
                    transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                    className="ui-floating-surface absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-2xl"
                    style={{ background: "var(--surface-glass)" }}
                  >
                    <div className="px-4 py-4 border-b" style={{ borderColor: "var(--border-subtle)", background: "var(--surface-raised)" }}>
                      <div className="flex items-center gap-3">
                        <div
                          className="flex items-center justify-center font-bold text-base"
                          style={{
                            width: 44,
                            height: 44,
                            borderRadius: "50%",
                            background: "var(--surface-glass)",
                            backdropFilter: "blur(20px)",
                            border: "1px solid var(--border-strong)",
                            color: "var(--brand-primary)",
                          }}
                        >
                          {userInitials}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-bold truncate" style={{ color: "var(--text-primary)" }}>
                            {userLabel}
                          </p>
                          <p className="text-xs truncate" style={{ color: "var(--text-muted)" }}>
                            {currentUser?.email}
                          </p>
                          <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-brand-primary/10 text-brand-primary">
                            <Shield className="w-2.5 h-2.5" />
                            {userRole}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="p-2">
                      <button
                        onClick={() => {
                          setProfileOpen(false);
                          router.push("/profile");
                        }}
                        className="flex w-full items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 focus-visible:outline-none"
                        style={{ color: "var(--text-secondary)" }}
                        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = "var(--surface-raised)"; (e.currentTarget as HTMLButtonElement).style.color = "var(--text-primary)"; }}
                        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = "transparent"; (e.currentTarget as HTMLButtonElement).style.color = "var(--text-secondary)"; }}
                      >
                        <User className="w-4 h-4" style={{ color: "var(--text-muted)" }} />
                        My Profile
                      </button>
                    </div>

                    <div className="p-2 border-t" style={{ borderColor: "var(--border-subtle)" }}>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <button
                            className="flex w-full items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all duration-200 text-red-400 hover:bg-red-500/10 focus-visible:outline-none focus-visible:bg-red-500/15"
                            disabled={loggingOut}
                          >
                            <LogOut className="w-4 h-4" />
                            {loggingOut ? "Signing out…" : "Sign Out"}
                          </button>
                        </AlertDialogTrigger>
                        <AlertDialogContent className="ui-modal-surface">
                          <AlertDialogHeader>
                            <AlertDialogTitle style={{ color: "var(--text-primary)" }}>
                              Sign out?
                            </AlertDialogTitle>
                            <AlertDialogDescription style={{ color: "var(--text-muted)" }}>
                              Are you sure you want to sign out? You will need
                              to log in again to access the system.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel style={{ background: "var(--surface-raised)", borderColor: "var(--border-subtle)", color: "var(--text-secondary)" }}>
                              Cancel
                            </AlertDialogCancel>
                            <AlertDialogAction
                              onClick={(e) => {
                                e.preventDefault();
                                setProfileOpen(false);
                                handleLogout();
                              }}
                              className="bg-red-600 hover:bg-red-700 text-white"
                            >
                              Sign Out
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
