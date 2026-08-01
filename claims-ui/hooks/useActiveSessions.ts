/**
 * Hook for managing active sessions / devices
 */
import { useState, useCallback, useEffect } from "react";
import { listActiveSessions, revokeSession } from "@/lib/api";
import type { Session } from "@/lib/types";
import { ApiError } from "@/lib/api";

export interface UseActiveSessionsState {
  sessions: Session[];
  isLoading: boolean;
  error: string | null;
  totalSessions: number;
}

export function useActiveSessions() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalSessions, setTotalSessions] = useState(0);

  // Fetch all active sessions
  const fetchSessions = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const res = await listActiveSessions();
      setSessions(res.sessions);
      setTotalSessions(res.total);
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.detail : "Failed to load sessions";
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Revoke a specific session
  const revoke = useCallback(
    async (sessionId: string) => {
      try {
        setError(null);
        await revokeSession(sessionId);
        // Remove from local state
        setSessions((prev) => prev.filter((s) => s.id !== sessionId));
        setTotalSessions((prev) => Math.max(0, prev - 1));
      } catch (err: unknown) {
        const msg = err instanceof ApiError ? err.detail : "Failed to revoke session";
        setError(msg);
        throw err;
      }
    },
    []
  );

  // Load sessions on mount
  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  return {
    sessions,
    isLoading,
    error,
    totalSessions,
    fetchSessions,
    revoke,
  };
}
