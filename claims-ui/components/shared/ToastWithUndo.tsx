"use client";

import { useEffect, useCallback } from "react";
import { toast, Toaster } from "sonner";

interface ToastWithUndoProps {
  message: string;
  undoText?: string;
  onUndo: () => void | Promise<void>;
  duration?: number;
}

/**
 * ToastWithUndo - A toast notification with undo functionality
 * 
 * Features:
 * - Displays a success/error message
 * - Includes an undo button that remains visible
 * - Auto-dismisses after duration unless hovered
 * - Prevents undo after delay expires
 * 
 * @example
 * ```tsx
 * toast.success(
 *   <ToastWithUndo
 *     message="Claims approved successfully"
 *     undoText="UNDO"
 *     onUndo={async () => {
 *       await undoBulkApprove();
 *       toast.success("Approval undone");
 *     }}
 *   />
 * );
 * ```
 */
export function ToastWithUndo({
  message,
  undoText = "UNDO",
  onUndo,
  duration = 5000,
}: ToastWithUndoProps) {
  const toastId = `toast-${Date.now()}`;

  // Handle the undo action - memoized to avoid useEffect dependency issues
  const handleUndo = useCallback(() => {
    // Dismiss the toast immediately
    toast.dismiss(toastId);
    // Execute the undo action
    void onUndo();
  }, [toastId, onUndo]);

  // Show the initial toast
  useEffect(() => {
    toast.success(message, {
      id: toastId,
      duration,
      action: {
        label: undoText,
        onClick: handleUndo,
      },
      actionButtonStyle: {
        background: "rgba(239, 68, 68, 0.2)",
        color: "#ef4444",
        border: "1px solid rgba(239, 68, 68, 0.3)",
        padding: "4px 12px",
        borderRadius: "6px",
        fontWeight: "600",
        fontSize: "12px",
      },
      closeButton: false,
      style: {
        background: "rgba(16, 185, 129, 0.1)",
        border: "1px solid rgba(16, 185, 129, 0.3)",
        color: "#e2e8f0",
      },
    });
  }, [message, undoText, duration, toastId, handleUndo]);

  return null;
}

/**
 * showUndoToast - Helper function to display a toast with undo
 * 
 * @example
 * ```tsx
 * showUndoToast({
 *   message: "Claims approved",
 *   onUndo: () => undoAction(),
 * });
 * ```
 */
export function showUndoToast({
  message,
  undoText = "UNDO",
  onUndo,
  duration = 5000,
}: Omit<ToastWithUndoProps, "actionText">) {
  const id = `undo-${Date.now()}`;

  toast.success(message, {
    id,
    duration,
    action: {
      label: undoText,
      onClick: () => {
        toast.dismiss(id);
        void onUndo();
      },
    },
    actionButtonStyle: {
      background: "rgba(239, 68, 68, 0.2)",
      color: "#ef4444",
      border: "1px solid rgba(239, 68, 68, 0.3)",
      padding: "4px 12px",
      borderRadius: "6px",
      fontWeight: "600",
      fontSize: "12px",
    },
    closeButton: false,
    style: {
      background: "rgba(16, 185, 129, 0.1)",
      border: "1px solid rgba(16, 185, 129, 0.3)",
      color: "#e2e8f0",
    },
  });
}

/**
 * UndoToastProvider - Wraps the application with toast provider
 * Place this in your root layout
 * 
 * @example
 * ```tsx
 * // In app/layout.tsx
 * export default function RootLayout({ children }) {
 *   return (
 *     <>
 *       <UndoToastProvider />
 *       {children}
 *     </>
 *   );
 * }
 * ```
 */
export function UndoToastProvider() {
  return <Toaster position="top-right" richColors closeButton />;
}
