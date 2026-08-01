/**
 * Hook for MFA setup and verification
 */
import { useState, useCallback } from "react";
import { totpSetup, totpHasSetup, totpLogin, TotpLoginResponse } from "@/lib/api";
import { ApiError } from "@/lib/api";
import type { TotpSetupResponseWithBackupCodes } from "@/lib/types";

export interface UseMFAState {
  setupResponse: TotpSetupResponseWithBackupCodes | null;
  isSetupConfigured: boolean;
  isVerifying: boolean;
  setupError: string | null;
  verifyError: string | null;
}

export function useMFA() {
  const [setupResponse, setSetupResponse] = useState<TotpSetupResponseWithBackupCodes | null>(null);
  const [isSetupConfigured, setIsSetupConfigured] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  // Check if TOTP is already configured for an email
  const checkIfConfigured = useCallback(async (email: string) => {
    try {
      const res = await totpHasSetup(email);
      setIsSetupConfigured(res.configured);
      return res.configured;
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.detail : "Failed to check TOTP status";
      setSetupError(msg);
      return false;
    }
  }, []);

  // Load or generate TOTP setup (QR code)
  const loadSetup = useCallback(async (email: string) => {
    try {
      setSetupError(null);
      const res = await totpSetup(email) as TotpSetupResponseWithBackupCodes;
      setSetupResponse(res);
      return res;
    } catch (err: unknown) {
      const msg = err instanceof ApiError ? err.detail : "Failed to load TOTP setup";
      setSetupError(msg);
      throw err;
    }
  }, []);

  // Verify TOTP code
  const verifyCode = useCallback(
    async (email: string, code: string, mfaPendingToken?: string): Promise<TotpLoginResponse> => {
      try {
        setIsVerifying(true);
        setVerifyError(null);
        const res = await totpLogin(email, code, mfaPendingToken);
        return res;
      } catch (err: unknown) {
        let msg = "Verification failed";
        if (err instanceof ApiError) {
          msg = err.detail;
          if (msg.includes("429") || msg.includes("Too many")) {
            msg = "Too many failed attempts. Try again in 10 minutes.";
          }
        }
        setVerifyError(msg);
        throw err;
      } finally {
        setIsVerifying(false);
      }
    },
    []
  );

  return {
    setupResponse,
    isSetupConfigured,
    isVerifying,
    setupError,
    verifyError,
    checkIfConfigured,
    loadSetup,
    verifyCode,
  };
}
