"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string | React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  confirmVariant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
  onConfirm: () => void | Promise<void>;
  disabled?: boolean;
}

/**
 * ConfirmationDialog - A reusable dialog for confirmation actions
 * 
 * Features:
 * - Customizable title, description, and button text
 * - Supports async confirmation actions
 * - Loading state during async operations
 * - Multiple variant options for styling
 * - Accessible with proper focus management
 * 
 * @example
 * ```tsx
 * const [dialogOpen, setDialogOpen] = useState(false);
 * 
 * <ConfirmationDialog
 *   open={dialogOpen}
 *   onOpenChange={setDialogOpen}
 *   title="Confirm Deletion"
 *   description="Are you sure you want to delete this item? This action cannot be undone."
 *   confirmText="Delete"
 *   variant="destructive"
 *   onConfirm={async () => {
 *     await deleteItem(id);
 *   }}
 * />
 * ```
 */
export function ConfirmationDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText = "Confirm",
  cancelText = "Cancel",
  confirmVariant = "default",
  onConfirm,
  disabled = false,
}: ConfirmationDialogProps) {
  const [isLoading, setIsLoading] = useState(false);

  async function handleConfirm() {
    setIsLoading(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setIsLoading(false);
    }
  }

  function handleCancel() {
    if (!isLoading) {
      onOpenChange(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleCancel}>
      <DialogContent className="glass-card border-0 sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle className="text-white/90">{title}</DialogTitle>
          {description && (
            <DialogDescription className="text-white/50">
              {description}
            </DialogDescription>
          )}
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={handleCancel}
            disabled={isLoading}
            className="dark:border-white/20 dark:text-white/70 dark:hover:bg-white/10"
          >
            {cancelText}
          </Button>
          <Button
            variant={confirmVariant}
            onClick={handleConfirm}
            disabled={disabled || isLoading}
            loading={isLoading}
          >
            {isLoading ? "Processing..." : confirmText}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
