"use client";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { adminCreateUser, adminUpdateUser } from "@/lib/api";
import type { AdminUser } from "@/lib/types";

const ROLES = [
  "ADMIN", "ADJUSTER", "SENIOR_ADJUSTER",
  "MEDICAL_DIRECTOR", "COMPLIANCE_OFFICER", "API_CONSUMER",
];
const REGIONS = ["UAE", "INDIA", "SAUDI", "BAHRAIN", "OMAN", "QATAR", "KUWAIT"];

interface Props {
  open:         boolean;
  onOpenChange: (o: boolean) => void;
  editUser:     AdminUser | null;
  onSuccess:    () => void;
}

export function UserFormDialog({ open, onOpenChange, editUser, onSuccess }: Props) {
  const isEdit = !!editUser;

  const [email,    setEmail]    = useState("");
  const [name,     setName]     = useState("");
  const [role,     setRole]     = useState("ADJUSTER");
  const [region,   setRegion]   = useState("UAE");
  const [active,   setActive]   = useState(true);
  const [password, setPassword] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setError(null);
      setPassword("");
      if (editUser) {
        setEmail(editUser.email);
        setName(editUser.full_name);
        setRole(editUser.role);
        setRegion(editUser.market_region);
        setActive(editUser.is_active);
      } else {
        setEmail(""); setName(""); setRole("ADJUSTER"); setRegion("UAE"); setActive(true);
      }
    }
  }, [open, editUser]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (isEdit) {
        await adminUpdateUser(editUser!.email, {
          full_name: name, role, market_region: region, is_active: active,
        });
        toast.success(`User ${editUser!.email} updated`);
      } else {
        await adminCreateUser({ email, full_name: name, role, market_region: region, password });
        toast.success(`User ${email} created`);
      }
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Operation failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit User" : "Create New User"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="uf-email">Email</Label>
            <Input id="uf-email" type="email" required value={email}
              disabled={isEdit}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@claims-engine.local" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="uf-name">Full Name</Label>
            <Input id="uf-name" required value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="John Smith" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>{r.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Market Region</Label>
              <Select value={region} onValueChange={setRegion}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {REGIONS.map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {isEdit && (
            <div className="flex items-center justify-between rounded-lg border px-3 py-2.5">
              <div>
                <p className="text-sm font-medium">Account Active</p>
                <p className="text-xs text-muted-foreground">Disabled users cannot log in</p>
              </div>
              <Switch checked={active} onCheckedChange={setActive} />
            </div>
          )}

          {!isEdit && (
            <div className="space-y-1.5">
              <Label htmlFor="uf-pwd">Initial Password</Label>
              <Input id="uf-pwd" type="password" required minLength={8}
                value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="Min. 8 characters" />
            </div>
          )}

          {error && (
            <p className="text-sm text-rose-500 bg-rose-500/10 rounded-md px-3 py-2">{error}</p>
          )}

          <div className="flex gap-2 pt-1">
            <Button type="submit" disabled={loading} className="flex-1">
              {loading ? "Saving…" : isEdit ? "Save Changes" : "Create User"}
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
