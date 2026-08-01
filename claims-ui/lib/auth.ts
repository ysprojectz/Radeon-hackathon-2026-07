/**
 * Client-side authentication helpers — httpOnly cookie edition.
 *
 * Token storage strategy (security hardening):
 *   BEFORE: access/refresh JWTs lived in localStorage (readable by any JS / DevTools)
 *   AFTER:  tokens are httpOnly, Secure, SameSite=Strict cookies set by the server.
 *           JavaScript cannot read them — they are invisible in DevTools Application tab
 *           and are NOT accessible via XSS attacks.
 *
 * The browser sends these cookies automatically on every same-origin request when
 * `credentials: "include"` is set on fetch() calls (handled by api.ts).
 *
 * Legacy exports (getAccessToken, setTokens, etc.) are kept as no-op stubs so that
 * any remaining callers don't crash.  They should be removed once all callers are updated.
 */

export interface StoredUser {
  id:              string;
  email:           string;
  full_name:       string;
  role:            string;
  market_region:   string;
  is_active:       boolean;
  is_api_key:      boolean;
  mfa_required?:   boolean;
  mfa_enabled?:    boolean;
  mfa_verified_at?: string | null;
}

export class TransientAuthCheckError extends Error {
  constructor(public status?: number) {
    super(status ? `Auth check temporarily unavailable (${status})` : "Auth check temporarily unavailable");
    this.name = "TransientAuthCheckError";
  }
}

// ── Active cookie-based auth helpers ─────────────────────────────────────────

/**
 * Fetch the currently authenticated user by calling GET /api/v1/auth/me.
 * The httpOnly cookie is sent automatically by the browser (credentials: "include").
 * Returns null if not authenticated. In strict mode, transient failures such as
 * edge 429s are thrown so route guards can retry instead of bouncing to login.
 */
export async function fetchCurrentUser(options: { strict?: boolean } = {}): Promise<StoredUser | null> {
  if (typeof window === "undefined") return null;
  try {
    const res = await fetch("/api/v1/proxy/auth/me", {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
    if (options.strict && (res.status === 429 || res.status >= 500)) {
      throw new TransientAuthCheckError(res.status);
    }
    if (!res.ok) return null;
    return res.json() as Promise<StoredUser>;
  } catch (error) {
    if (options.strict) {
      throw error instanceof TransientAuthCheckError
        ? error
        : new TransientAuthCheckError();
    }
    return null;
  }
}

/**
 * Call POST /api/v1/auth/logout to delete httpOnly cookies on the server.
 * This is the only correct way to invalidate an httpOnly cookie session —
 * JavaScript cannot delete httpOnly cookies directly.
 */
export async function serverLogout(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    await fetch("/api/v1/proxy/auth/logout", {
      method:      "POST",
      credentials: "include",
    });
  } catch {
    // Best-effort — proceed to redirect regardless of network errors
  }
}

// ── Legacy no-op stubs ────────────────────────────────────────────────────────
// These prevent import crashes while callers are migrated away from localStorage.
// All localStorage access has been removed.  Remove these stubs once callers
// have been updated to use fetchCurrentUser() / serverLogout().

/** @deprecated Cookie is set by server — this is a no-op */
export function getAccessToken():                    string | null { return null; }
/** @deprecated Cookie is set by server — this is a no-op */
export function getRefreshToken():                   string | null { return null; }
/** @deprecated Use fetchCurrentUser() instead */
export function getStoredUser():                     StoredUser | null { return null; }
/** @deprecated Tokens are set as httpOnly cookies by the server */
export function setTokens(_accessToken: string, _refreshToken: string): void {} // eslint-disable-line @typescript-eslint/no-unused-vars
/** @deprecated Use fetchCurrentUser() — user data comes from /auth/me */
export function setStoredUser(_user: StoredUser): void {} // eslint-disable-line @typescript-eslint/no-unused-vars
/** @deprecated Use serverLogout() to clear httpOnly cookies server-side */
export function clearAuth():                         void          {}
/** @deprecated Use fetchCurrentUser() !== null to check auth status */
export function isAuthenticated():                   boolean       { return false; }
