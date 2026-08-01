import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, parseISO, formatDistanceToNow } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ─── Currency formatting ──────────────────────────────────────────────────────

const CURRENCY_LOCALES: Record<string, string> = {
  INR: "en-IN",
  USD: "en-US",
};

export function formatCurrency(
  amount: string | number | undefined | null,
  currency: string = "INR"
): string {
  if (amount === undefined || amount === null || amount === "") return "—";
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num)) return "—";
  const locale = CURRENCY_LOCALES[currency] ?? "en-US";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

export function formatAmount(
  amount: string | number | undefined | null
): string {
  if (amount === undefined || amount === null || amount === "") return "—";
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num)) return "—";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

// ─── Date formatting ──────────────────────────────────────────────────────────

export function formatDate(dateStr: string | undefined | null): string {
  if (!dateStr) return "—";
  try {
    return format(parseISO(dateStr), "dd MMM yyyy");
  } catch {
    return dateStr;
  }
}

export function formatDateTime(dateStr: string | undefined | null): string {
  if (!dateStr) return "—";
  try {
    return format(parseISO(dateStr), "dd MMM yyyy HH:mm:ss");
  } catch {
    return dateStr;
  }
}

export function formatTimeOnly(dateStr: string | undefined | null): string {
  if (!dateStr) return "—";
  try {
    return format(parseISO(dateStr), "HH:mm:ss");
  } catch {
    return dateStr;
  }
}

export function formatRelative(dateStr: string | undefined | null): string {
  if (!dateStr) return "—";
  try {
    return formatDistanceToNow(parseISO(dateStr), { addSuffix: true });
  } catch {
    return dateStr;
  }
}

// ─── Date range helpers (for dashboard filters) ──────────────────────────────

export function toISODate(d: Date): string {
  return d.toISOString().split("T")[0];
}

export function getTodayRange(): { from: string; to: string } {
  const today = toISODate(new Date());
  return { from: today, to: today };
}

export function getWeekRange(): { from: string; to: string } {
  const now = new Date();
  const dayOfWeek = now.getDay();
  const monday = new Date(now);
  const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  monday.setDate(now.getDate() - daysFromMonday);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { from: toISODate(monday), to: toISODate(sunday) };
}

export function getMonthRange(): { from: string; to: string } {
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: toISODate(firstOfMonth), to: toISODate(now) };
}

export function getYearRange(): { from: string; to: string } {
  const now = new Date();
  const jan1 = new Date(now.getFullYear(), 0, 1);
  return { from: toISODate(jan1), to: toISODate(now) };
}

export function getYearRangeForYear(year: number): { from: string; to: string } {
  const jan1 = new Date(year, 0, 1);
  const dec31 = new Date(year, 11, 31);
  return { from: toISODate(jan1), to: toISODate(dec31) };
}

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

export function getMonthName(monthIndex: number): string {
  return MONTHS[monthIndex] ?? "Unknown";
}

export function getMonthRangeForMonth(monthIndex: number, year?: number): { from: string; to: string } {
  const targetYear = year ?? new Date().getFullYear();
  const firstOfMonth = new Date(targetYear, monthIndex, 1);
  const lastOfMonth = new Date(targetYear, monthIndex + 1, 0);
  return { from: toISODate(firstOfMonth), to: toISODate(lastOfMonth) };
}

// ─── Number formatting ────────────────────────────────────────────────────────

export function formatConfidence(
  score: string | number | undefined | null
): string {
  if (score === undefined || score === null) return "—";
  const num = typeof score === "string" ? parseFloat(score) : score;
  if (isNaN(num)) return "—";
  return `${(num * 100).toFixed(1)}%`;
}

export function parseDecimal(value: string | number | undefined | null): number {
  if (value === undefined || value === null) return 0;
  const num = typeof value === "string" ? parseFloat(value) : value;
  return isNaN(num) ? 0 : num;
}

// ─── Hash truncation ──────────────────────────────────────────────────────────

export function truncateHash(hash: string, chars = 8): string {
  if (!hash) return "—";
  return `${hash.slice(0, chars)}…${hash.slice(-chars)}`;
}

// ─── Misc ─────────────────────────────────────────────────────────────────────

export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function slugify(str: string): string {
  return str.toLowerCase().replace(/\s+/g, "-");
}
