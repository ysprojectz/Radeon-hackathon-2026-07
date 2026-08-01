/**
 * Server-only API client for fetching data from the backend.
 * Uses the internal Docker network URL (http://api:8000) for cross-container communication.
 */
import { DashboardKPIs } from "./types";

const INTERNAL_API_URL = (process.env.INTERNAL_API_URL || "http://localhost:8000").replace(/\/+$/, "");

export async function getMeServer(token: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${INTERNAL_API_URL}/api/v1/auth/me`, {
      headers: {
        "Cookie": `access_token=${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function getDashboardKPIsServer(token: string): Promise<DashboardKPIs | null> {
  try {
    const res = await fetch(`${INTERNAL_API_URL}/api/v1/dashboard/kpis`, {
      headers: {
        "Cookie": `access_token=${token}`,
        "Content-Type": "application/json",
      },
      next: { revalidate: 0 } // Don't cache for real-time dashboard
    });

    if (!res.ok) return null;
    return await res.json();
  } catch (error) {
    console.error("[SERVER-FETCH] Failed to fetch KPIs:", error);
    return null;
  }
}
