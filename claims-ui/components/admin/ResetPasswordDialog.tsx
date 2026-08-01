"use client";
import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { adminResetPassword } from "@/lib/api";
import type { AdminUser } from "@/lib/types";

interface Props {
  open:         boolean;
  user:         AdminUser | null;
  onOpenChange: (o: boolean) => void;
  onSuccess:    () => void;
}

export function ResetPasswordDialog({ open, user, onOpenChange, onSuccess }: Props) {
  const [password,  setPassword]  = useState("");
  const [confirm,   setConfirm]   = useState("");
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) { setError("Passwords do not match"); return; }
    if (password.length < 8)  { setError("Minimum 8 characters");   return; }
    setLoading(true);
    try {
      await adminResetPassword(user!.email, password);
      toast.success(`Password reset for ${user!.email}`);
      setPassword(""); setConfirm("");
      onSuccess();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset password");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { setPassword(""); setConfirm(""); setError(null); } onOpenChange(o); }}>
      <DialogContent className="sm:max-w-sm" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Reset Password</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground -mt-1">
          Setting new password for <span className="font-medium text-foreground">{user?.email}</span>
        </p>
        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <div className="space-y-1.5">
            <Label htmlFor="rp-pwd">New Password</Label>
            <Input id="rp-pwd" type="password" required value={password}
              onChange={(e) => setPassword(e.target.value)} placeholder="Min. 8 characters" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rp-confirm">Confirm Password</Label>
            <Input id="rp-confirm" type="password" required value={confirm}
              onChange={(e) => setConfirm(e.target.value)} placeholder="Repeat password" />
          </div>
          {error && (
            <p className="text-sm text-rose-500 bg-rose-500/10 rounded-md px-3 py-2">{error}</p>
          )}
          <div className="flex gap-2 pt-1">
            <Button type="submit" disabled={loading} className="flex-1">
              {loading ? "Resetting…" : "Reset Password"}
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
