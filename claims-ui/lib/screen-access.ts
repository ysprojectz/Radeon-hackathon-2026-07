import type { AdminUser, AccessGroupPolicy } from "./types";

export const ROLE_OPTIONS = [
  { key: "ADMIN", label: "Administrator", help: "Full system control", family: "Control" },
  { key: "ADJUSTER", label: "Claims Adjuster", help: "Daily claim handling", family: "Operations" },
  { key: "SENIOR_ADJUSTER", label: "Senior Adjuster", help: "Override and approval review", family: "Operations" },
  { key: "MEDICAL_DIRECTOR", label: "Medical Reviewer", help: "Clinical necessity decisions", family: "Clinical" },
  { key: "COMPLIANCE_OFFICER", label: "Compliance Officer", help: "Audit and regulatory checks", family: "Governance" },
  { key: "API_CONSUMER", label: "Integration Account", help: "System-to-system access", family: "Integration" },
] as const;

export const MARKET_OPTIONS = [
  { key: "INDIA", label: "India", region: "Asia" },
] as const;

export const SCREEN_CATALOG = [
  { id: "dashboard", label: "Dashboard", href: "/", section: "Data" },
  { id: "reports", label: "Reports", href: "/reports", section: "Data" },
  { id: "hitl", label: "Review Queue", href: "/hitl", section: "Operations" },
  { id: "claims", label: "Claims List", href: "/claims", section: "Operations" },
  { id: "claim-journey", label: "Claim Journey", href: "/operations/lifecycle", section: "Operations" },
  { id: "accounts", label: "Accounts", href: "/accounts", section: "Operations" },
  { id: "submit", label: "Claim Submission", href: "/submit", section: "Operations" },
  { id: "settings", label: "Settings", href: "/settings", section: "System Control" },
  { id: "master-settings", label: "Master Settings", href: "/master-settings", section: "System Control" },
  { id: "admin-console", label: "Admin Console", href: "/admin#operations", section: "System Control" },
  { id: "admin-settings", label: "Admin Settings", href: "/admin#settings", section: "Admin Console", parentId: "admin-console" },
  { id: "admin-policies", label: "Admin Policies", href: "/admin#policies", section: "Admin Console", parentId: "admin-console" },
  { id: "admin-audit", label: "Admin Audit", href: "/admin#audit", section: "Admin Console", parentId: "admin-console" },
  { id: "admin-integrations", label: "Admin Integrations", href: "/admin#integrations", section: "Admin Console", parentId: "admin-console" },
  { id: "admin-operations", label: "Admin Operations", href: "/admin#operations", section: "Admin Console", parentId: "admin-console" },
] as const;

export type ScreenId = (typeof SCREEN_CATALOG)[number]["id"];

export const ALL_ROLES = ROLE_OPTIONS.map((role) => role.key);
export const ALL_MARKETS = MARKET_OPTIONS.map((market) => market.key);
export const ALL_SCREEN_IDS = SCREEN_CATALOG.map((screen) => screen.id);

export function canonicalMarket(value?: string | null) {
  return String(value ?? "").trim().toUpperCase();
}

export function getDefaultGroups(): AccessGroupPolicy[] {
  return [
    {
      id: "claims-admins",
      name: "System Administrators",
      description: "Owns platform setup, users, policies, service settings, and operational overrides.",
      roleScope: ["ADMIN"],
      marketScope: [...ALL_MARKETS],
      screenAccess: [...ALL_SCREEN_IDS],
      isActive: true,
    },
    {
      id: "claims-operations",
      name: "Claims Operations",
      description: "Handles daily adjudication, review queue triage, settlement checks, and due-time follow-up.",
      roleScope: ["ADJUSTER", "SENIOR_ADJUSTER"],
      marketScope: ["INDIA"],
      screenAccess: ["dashboard", "hitl", "claims", "claim-journey", "accounts", "submit", "settings"],
      isActive: true,
    },
    {
      id: "clinical-review",
      name: "Clinical Review",
      description: "Reviews medical necessity, policy interpretation, and high-value clinical decisions.",
      roleScope: ["MEDICAL_DIRECTOR"],
      marketScope: [...ALL_MARKETS],
      screenAccess: ["dashboard", "hitl", "claims", "claim-journey", "settings"],
      isActive: true,
    },
    {
      id: "compliance-audit",
      name: "Compliance and Audit",
      description: "Reviews regulatory exceptions, audit trails, policy governance, and market controls.",
      roleScope: ["COMPLIANCE_OFFICER"],
      marketScope: [...ALL_MARKETS],
      screenAccess: ["dashboard", "reports", "claims", "claim-journey", "settings"],
      isActive: true,
    },
    {
      id: "integration-access",
      name: "Integration Access",
      description: "Limits service accounts used for exports, intake automation, and reporting connections.",
      roleScope: ["API_CONSUMER"],
      marketScope: [...ALL_MARKETS],
      screenAccess: [],
      isActive: true,
    },
  ];
}

const ROLE_KEYS = new Set<string>(ALL_ROLES);
const MARKET_KEYS = new Set<string>(ALL_MARKETS);
const SCREEN_KEYS = new Set<string>(ALL_SCREEN_IDS);

function normalizeScope(values: unknown, allowed: Set<string>, mapper = (value: string) => value) {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === "string")
        .map((value) => mapper(value).trim().toUpperCase())
        .filter((value) => allowed.has(value))
    )
  );
}

function normalizeScreenScope(values: unknown) {
  if (!Array.isArray(values)) return [];
  return Array.from(
    new Set(
      values
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter((value) => SCREEN_KEYS.has(value))
    )
  );
}

export function normalizeGroup(value: unknown): AccessGroupPolicy | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const group = value as Partial<AccessGroupPolicy>;
  if (typeof group.id !== "string" || typeof group.name !== "string") return null;
  return {
    id: group.id,
    name: group.name,
    description: typeof group.description === "string" ? group.description : "",
    roleScope: normalizeScope(group.roleScope, ROLE_KEYS),
    marketScope: normalizeScope(group.marketScope, MARKET_KEYS, canonicalMarket),
    screenAccess: normalizeScreenScope(group.screenAccess),
    isActive: Boolean(group.isActive),
  };
}

export function normalizeGroups(values: unknown): AccessGroupPolicy[] {
  if (!Array.isArray(values)) return getDefaultGroups();
  const groups = values.map(normalizeGroup).filter((group): group is AccessGroupPolicy => group !== null);
  return groups.length ? groups : getDefaultGroups();
}

export function groupMatchesUser(group: AccessGroupPolicy, user: Pick<AdminUser, "role" | "market_region" | "is_active">) {
  if (!group.isActive || !user.is_active) return false;
  const roleMatch = group.roleScope.length === 0 || group.roleScope.includes(user.role);
  const marketMatch = group.marketScope.length === 0 || group.marketScope.includes(canonicalMarket(user.market_region));
  return roleMatch && marketMatch;
}

export function getAllowedScreenIdsForUser(
  groups: AccessGroupPolicy[],
  user: Pick<AdminUser, "role" | "market_region" | "is_active">
) {
  return Array.from(
    new Set(
      groups
        .filter((group) => groupMatchesUser(group, user))
        .flatMap((group) => group.screenAccess)
    )
  );
}

export function getScreenIdForPath(pathname: string, hash = ""): ScreenId | null {
  if (pathname === "/") return "dashboard";
  if (pathname === "/reports") return "reports";
  if (pathname === "/hitl") return "hitl";
  if (pathname === "/claims" || pathname.startsWith("/claims/")) return "claims";
  if (pathname === "/operations/lifecycle") return "claim-journey";
  if (pathname === "/accounts") return "accounts";
  if (pathname === "/submit") return "submit";
  if (pathname === "/settings") return "settings";
  if (pathname === "/master-settings") return "master-settings";
  if (pathname === "/admin") {
    const adminHash = hash.replace(/^#/, "");
    if (adminHash === "settings") return "admin-settings";
    if (adminHash === "policies") return "admin-policies";
    if (adminHash === "audit") return "admin-audit";
    if (adminHash === "integrations" || adminHash.startsWith("integrations-") || adminHash === "gateway" || adminHash === "hms" || adminHash === "flows") {
      return "admin-integrations";
    }
    if (adminHash === "operations" || adminHash.startsWith("operations-") || adminHash === "sales" || adminHash === "support" || adminHash === "reports") {
      return "admin-operations";
    }
    return "admin-console";
  }
  return null;
}
