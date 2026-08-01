"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  Copy,
  Globe2,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  UserRoundCheck,
  UsersRound,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { adminUpdateConfig } from "@/lib/api";
import { useAdminUsers } from "@/lib/hooks/useAdminUsers";
import type { AccessGroupPolicy, AdminUser, SystemConfig } from "@/lib/types";
import {
  ALL_MARKETS,
  ALL_ROLES,
  ALL_SCREEN_IDS,
  GCC_MARKETS,
  MARKET_OPTIONS,
  ROLE_OPTIONS,
  SCREEN_CATALOG,
  canonicalMarket,
  getDefaultGroups,
  groupMatchesUser,
  normalizeGroups,
} from "@/lib/screen-access";
import { cn } from "@/lib/utils";
import {
  adminActionButtonClass,
  adminEyebrowClass,
  adminInputClass,
  adminMetricCardClass,
  adminOutlineButtonClass,
  adminPanelClass,
  adminSectionCopyClass,
  adminSectionTitleClass,
} from "./admin-theme";

const ROLE_KEYS = new Set<string>(ALL_ROLES);
const MARKET_KEYS = new Set<string>(ALL_MARKETS);

function formatRole(value: string) {
  return ROLE_OPTIONS.find((role) => role.key === value)?.label ?? value.replace(/_/g, " ");
}

function formatMarket(value: string) {
  return MARKET_OPTIONS.find((market) => market.key === value)?.label ?? value;
}

function formatScope(values: string[], fallback: string, formatter = (value: string) => value) {
  if (!values.length) return fallback;
  if (values.length === ALL_MARKETS.length && values.every((value) => MARKET_KEYS.has(value))) return "All markets";
  if (values.length === ALL_ROLES.length && values.every((value) => ROLE_KEYS.has(value))) return "All roles";
  if (values.length > 3) return `${values.slice(0, 3).map(formatter).join(", ")} +${values.length - 3}`;
  return values.map(formatter).join(", ");
}

function countCoverage(groups: AccessGroupPolicy[], users: AdminUser[]) {
  return new Set(
    users
      .filter((user) => user.is_active && groups.some((group) => groupMatchesUser(group, user)))
      .map((user) => user.email)
  ).size;
}

function sameGroups(left: AccessGroupPolicy[], right: AccessGroupPolicy[]) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function UserGroupsTab({ config, onSaved }: { config?: SystemConfig | null; onSaved?: () => void }) {
  const { users, isLoading } = useAdminUsers();
  const [groups, setGroups] = useState<AccessGroupPolicy[]>(() => getDefaultGroups());
  const [savedGroups, setSavedGroups] = useState<AccessGroupPolicy[]>(() => getDefaultGroups());
  const [selectedGroupId, setSelectedGroupId] = useState(getDefaultGroups()[0].id);
  const [searchQuery, setSearchQuery] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!config) return;
    const hydrated = normalizeGroups(config.access_groups);
    setGroups(hydrated);
    setSavedGroups(hydrated);
    setSelectedGroupId((current) => hydrated.some((group) => group.id === current) ? current : hydrated[0]?.id ?? "");
  }, [config]);

  const dirty = !sameGroups(groups, savedGroups);
  const selectedGroup = groups.find((group) => group.id === selectedGroupId) ?? groups[0];

  const groupCounts = useMemo(() => {
    return new Map(groups.map((group) => [group.id, users.filter((user) => groupMatchesUser(group, user)).length] as const));
  }, [groups, users]);

  const selectedUsers = useMemo(() => {
    if (!selectedGroup) return [];
    return users.filter((user) => groupMatchesUser(selectedGroup, user));
  }, [selectedGroup, users]);

  const filteredGroups = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return groups;
    return groups.filter((group) => (
      group.name.toLowerCase().includes(query)
      || group.description.toLowerCase().includes(query)
      || group.roleScope.some((role) => formatRole(role).toLowerCase().includes(query))
      || group.marketScope.some((market) => formatMarket(market).toLowerCase().includes(query))
    ));
  }, [groups, searchQuery]);

  const activeGroups = groups.filter((group) => group.isActive).length;
  const assignedUsers = countCoverage(groups, users);
  const uncoveredUsers = users.filter((user) => user.is_active && !groups.some((group) => groupMatchesUser(group, user))).length;

  const persistGroups = async (nextGroups: AccessGroupPolicy[], message = "Access groups saved") => {
    setSaving(true);
    try {
      await adminUpdateConfig({ access_groups: nextGroups });
      setGroups(nextGroups);
      setSavedGroups(nextGroups);
      onSaved?.();
      window.dispatchEvent(new Event("acos-screen-access-updated"));
      toast.success(message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save access groups");
    } finally {
      setSaving(false);
    }
    if (!nextGroups.some((group) => group.id === selectedGroupId)) {
      setSelectedGroupId(nextGroups[0]?.id ?? "");
    }
  };

  const updateGroup = (id: string, patch: Partial<AccessGroupPolicy>) => {
    setGroups((current) => current.map((group) => group.id === id ? { ...group, ...patch } : group));
  };

  const toggleScope = (id: string, key: "roleScope" | "marketScope" | "screenAccess", value: string) => {
    setGroups((current) => current.map((group) => {
      if (group.id !== id) return group;
      const selected = group[key].includes(value);
      return {
        ...group,
        [key]: selected ? group[key].filter((item) => item !== value) : [...group[key], value],
      };
    }));
  };

  const setRolePreset = (id: string, roleScope: string[]) => updateGroup(id, { roleScope });
  const setMarketPreset = (id: string, marketScope: string[]) => updateGroup(id, { marketScope });
  const setScreenPreset = (id: string, screenAccess: string[]) => updateGroup(id, { screenAccess });

  const addGroup = () => {
    const nextGroup: AccessGroupPolicy = {
      id: `custom-${Date.now()}`,
      name: "New Access Group",
      description: "Set the roles and markets this group can operate in.",
      roleScope: ["ADJUSTER"],
      marketScope: ["UAE"],
      screenAccess: ["dashboard", "claims", "submit", "settings"],
      isActive: true,
    };
    setGroups((current) => [nextGroup, ...current]);
    setSelectedGroupId(nextGroup.id);
    toast.success("New access group ready to configure");
  };

  const duplicateGroup = () => {
    if (!selectedGroup) return;
    const nextGroup: AccessGroupPolicy = {
      ...selectedGroup,
      id: `copy-${selectedGroup.id}-${Date.now()}`,
      name: `${selectedGroup.name} Copy`,
      roleScope: [...selectedGroup.roleScope],
      marketScope: [...selectedGroup.marketScope],
      screenAccess: [...selectedGroup.screenAccess],
    };
    setGroups((current) => [nextGroup, ...current]);
    setSelectedGroupId(nextGroup.id);
    toast.success("Group copied");
  };

  const deleteGroup = () => {
    if (!selectedGroup) return;
    if (groups.length <= 1) {
      toast.error("At least one access group is required");
      return;
    }
    const nextGroups = groups.filter((group) => group.id !== selectedGroup.id);
    setGroups(nextGroups);
    setSelectedGroupId(nextGroups[0]?.id ?? "");
    toast.success("Access group removed");
  };

  const resetGroups = () => {
    const defaults = getDefaultGroups();
    persistGroups(defaults, "Default access groups restored");
    setSelectedGroupId(defaults[0].id);
  };

  const discardChanges = () => {
    setGroups(savedGroups.map((group) => ({ ...group, roleScope: [...group.roleScope], marketScope: [...group.marketScope], screenAccess: [...group.screenAccess] })));
    setSelectedGroupId(savedGroups[0]?.id ?? "");
    toast.message("Unsaved changes discarded");
  };

  return (
    <div className="space-y-5">
      <div className={cn(adminPanelClass, "overflow-hidden px-5 py-5")}>
        <div className="dashboard-panel-accent bg-gradient-to-r from-cyan-300/0 via-cyan-300/42 to-transparent" />
        <div className="relative flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className={adminEyebrowClass}>User Groups</p>
            <h3 className="mt-2 text-[1.1rem] font-bold text-white">Access groups, roles, and market coverage</h3>
            <p className="mt-1 text-xs leading-5 text-white/42">
              Select one group, define who belongs to it, then enable the screens that group can access.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={addGroup} className={adminActionButtonClass}>
              <Plus className="h-3.5 w-3.5" />
              New Group
            </Button>
            <Button size="sm" variant="outline" onClick={duplicateGroup} className={adminOutlineButtonClass} disabled={!selectedGroup}>
              <Copy className="h-3.5 w-3.5" />
              Copy
            </Button>
            <Button size="sm" variant="outline" onClick={discardChanges} className={adminOutlineButtonClass} disabled={!dirty}>
              <RefreshCw className="h-3.5 w-3.5" />
              Discard
            </Button>
            <Button size="sm" onClick={() => persistGroups(groups)} className={adminActionButtonClass} disabled={!dirty || saving}>
              <Save className="h-3.5 w-3.5" />
              {saving ? "Saving..." : dirty ? "Save Changes" : "Saved"}
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className={adminMetricCardClass}>
          <p className={adminEyebrowClass}>Total Groups</p>
          <p className="mt-2 text-2xl font-black text-white">{groups.length}</p>
          <p className="mt-1 text-xs text-white/42">Configured access sets.</p>
        </div>
        <div className={adminMetricCardClass}>
          <p className={adminEyebrowClass}>Active Groups</p>
          <p className="mt-2 text-2xl font-black text-white">{activeGroups}</p>
          <p className="mt-1 text-xs text-white/42">Enabled for user coverage.</p>
        </div>
        <div className={adminMetricCardClass}>
          <p className={adminEyebrowClass}>Covered Users</p>
          <p className="mt-2 text-2xl font-black text-white">{isLoading ? "..." : assignedUsers}</p>
          <p className="mt-1 text-xs text-white/42">Active users matched by role and market.</p>
        </div>
        <div className={adminMetricCardClass}>
          <p className={adminEyebrowClass}>Needs Assignment</p>
          <p className="mt-2 text-2xl font-black text-white">{isLoading ? "..." : uncoveredUsers}</p>
          <p className="mt-1 text-xs text-white/42">Active users outside enabled groups.</p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)] min-[1800px]:grid-cols-[320px_minmax(0,1fr)_360px]">
        <section className={cn(adminPanelClass, "overflow-hidden p-4")}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className={adminSectionTitleClass}>Access Groups</p>
              <p className={adminSectionCopyClass}>Choose a group to configure</p>
            </div>
            <Button size="icon-xs" variant="outline" onClick={resetGroups} className="border-white/10 bg-white/[0.03] text-white/70" title="Restore default groups">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>

          <div className="relative mt-4">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/30" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search groups, roles, markets"
              className={cn(adminInputClass, "h-10 pl-9 text-xs")}
            />
          </div>

          <div className="custom-scrollbar mt-4 max-h-[620px] space-y-2 overflow-y-auto pr-1">
            {filteredGroups.map((group) => {
              const selected = group.id === selectedGroup?.id;
              const memberCount = groupCounts.get(group.id) ?? 0;
              return (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => setSelectedGroupId(group.id)}
                  className={cn(
                    "w-full rounded-2xl border px-3 py-3 text-left transition-all",
                    selected
                      ? "border-cyan-300/28 bg-cyan-300/[0.10] shadow-[0_0_0_1px_rgba(34,211,238,0.08)_inset]"
                      : "border-white/8 bg-white/[0.025] hover:border-white/14 hover:bg-white/[0.045]"
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-white">{group.name}</p>
                      <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-white/42">{group.description}</p>
                    </div>
                    <span className={cn(
                      "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-black",
                      group.isActive
                        ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-200"
                        : "border-rose-300/20 bg-rose-300/10 text-rose-200"
                    )}>
                      {group.isActive ? "Active" : "Paused"}
                    </span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px] font-semibold text-white/38">
                    <span className="rounded-full border border-white/8 bg-black/18 px-2 py-1">
                      {memberCount} member{memberCount === 1 ? "" : "s"}
                    </span>
                    <span className="rounded-full border border-white/8 bg-black/18 px-2 py-1">
                      {formatScope(group.marketScope, "All markets", formatMarket)}
                    </span>
                    <span className="rounded-full border border-white/8 bg-black/18 px-2 py-1">
                      {group.screenAccess.length} screen{group.screenAccess.length === 1 ? "" : "s"}
                    </span>
                  </div>
                </button>
              );
            })}

            {filteredGroups.length === 0 && (
              <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center">
                <p className="text-sm font-semibold text-white/70">No group found</p>
                <p className="mt-1 text-xs text-white/38">Adjust the search text or create a new access group.</p>
              </div>
            )}
          </div>
        </section>

        {selectedGroup && (
          <section className={cn(adminPanelClass, "overflow-hidden p-5")}>
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-black",
                    selectedGroup.isActive
                      ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-200"
                      : "border-rose-300/20 bg-rose-300/10 text-rose-200"
                  )}>
                    {selectedGroup.isActive ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                    {selectedGroup.isActive ? "Active" : "Paused"}
                  </span>
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-cyan-300/14 bg-cyan-300/[0.07] px-2.5 py-1 text-[11px] font-black text-cyan-100/82">
                    <UsersRound className="h-3.5 w-3.5" />
                    {selectedUsers.length} covered
                  </span>
                </div>

                <div className="mt-4 grid gap-3">
                  <Input
                    value={selectedGroup.name}
                    onChange={(event) => updateGroup(selectedGroup.id, { name: event.target.value })}
                    className={cn(adminInputClass, "h-11 text-base font-black text-white")}
                    aria-label={`${selectedGroup.name} group name`}
                  />
                  <Textarea
                    value={selectedGroup.description}
                    onChange={(event) => updateGroup(selectedGroup.id, { description: event.target.value })}
                    className={cn(adminInputClass, "min-h-20 resize-none text-xs leading-5 text-white/66")}
                    aria-label={`${selectedGroup.name} group description`}
                  />
                </div>
              </div>

              <div className="flex min-w-[210px] items-center justify-between gap-3 rounded-2xl border border-white/8 bg-white/[0.035] px-4 py-3">
                <div>
                  <p className={adminSectionTitleClass}>Group Status</p>
                  <p className={adminSectionCopyClass}>{selectedGroup.isActive ? "Available to users" : "Temporarily disabled"}</p>
                </div>
                <Switch
                  checked={selectedGroup.isActive}
                  onCheckedChange={(checked) => updateGroup(selectedGroup.id, { isActive: checked })}
                  aria-label={`Set ${selectedGroup.name} active`}
                />
              </div>
            </div>

            <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.15fr)_minmax(0,0.95fr)]">
              <div className="rounded-[1.25rem] border border-white/8 bg-black/15 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className={adminSectionTitleClass}>Role Access</p>
                    <p className={adminSectionCopyClass}>{formatScope(selectedGroup.roleScope, "All roles", formatRole)}</p>
                  </div>
                  <div className="flex gap-1.5">
                    <Button size="xs" variant="outline" className="border-white/10 bg-white/[0.03] text-white/60" onClick={() => setRolePreset(selectedGroup.id, ALL_ROLES)}>
                      All
                    </Button>
                    <Button size="xs" variant="outline" className="border-white/10 bg-white/[0.03] text-white/60" onClick={() => setRolePreset(selectedGroup.id, [])}>
                      Clear
                    </Button>
                  </div>
                </div>
                <div className="grid gap-2">
                  {ROLE_OPTIONS.map((role) => {
                    const active = selectedGroup.roleScope.includes(role.key);
                    return (
                      <button
                        key={role.key}
                        type="button"
                        onClick={() => toggleScope(selectedGroup.id, "roleScope", role.key)}
                        className={cn(
                          "flex min-h-14 items-center justify-between gap-3 rounded-2xl border px-3 py-2 text-left transition-colors",
                          active
                            ? "border-cyan-300/24 bg-cyan-300/12 text-cyan-100"
                            : "border-white/8 bg-white/[0.025] text-white/50 hover:border-white/14 hover:text-white/76"
                        )}
                      >
                        <span>
                          <span className="block text-xs font-black">{role.label}</span>
                          <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-normal text-white/32">{role.family} · {role.help}</span>
                        </span>
                        <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", active ? "bg-cyan-300" : "bg-white/18")} />
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="rounded-[1.25rem] border border-white/8 bg-black/15 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className={adminSectionTitleClass}>Screen Access</p>
                    <p className={adminSectionCopyClass}>{selectedGroup.screenAccess.length} enabled for this group</p>
                  </div>
                  <div className="flex gap-1.5">
                    <Button size="xs" variant="outline" className="border-white/10 bg-white/[0.03] text-white/60" onClick={() => setScreenPreset(selectedGroup.id, ALL_SCREEN_IDS)}>
                      All
                    </Button>
                    <Button size="xs" variant="outline" className="border-white/10 bg-white/[0.03] text-white/60" onClick={() => setScreenPreset(selectedGroup.id, [])}>
                      Clear
                    </Button>
                  </div>
                </div>

                <div className="custom-scrollbar max-h-[520px] space-y-3 overflow-y-auto pr-1">
                  {Array.from(new Set(SCREEN_CATALOG.map((screen) => screen.section))).map((section) => (
                    <div key={section} className="rounded-2xl border border-white/7 bg-white/[0.018] p-3">
                      <p className="mb-2 text-[10px] font-black uppercase tracking-[0.16em] text-white/34">{section}</p>
                      <div className="grid gap-1.5">
                        {SCREEN_CATALOG.filter((screen) => screen.section === section).map((screen) => {
                          const active = selectedGroup.screenAccess.includes(screen.id);
                          return (
                            <button
                              key={screen.id}
                              type="button"
                              onClick={() => toggleScope(selectedGroup.id, "screenAccess", screen.id)}
                              className={cn(
                                "flex min-h-10 items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition-colors",
                                active
                                  ? "border-emerald-300/24 bg-emerald-300/12 text-emerald-100"
                                  : "border-white/8 bg-white/[0.025] text-white/50 hover:border-white/14 hover:text-white/76"
                              )}
                            >
                              <span className="min-w-0">
                                <span className="block truncate text-[11px] font-black">{screen.label}</span>
                                <span className="mt-0.5 block truncate text-[9px] font-semibold text-white/30">{screen.href}</span>
                              </span>
                              <span className={cn(
                                "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                                active ? "border-emerald-200/50 bg-emerald-300 text-slate-950" : "border-white/16 bg-black/25"
                              )}>
                                {active && <CheckCircle2 className="h-3 w-3" />}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-[1.25rem] border border-white/8 bg-black/15 p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div>
                    <p className={adminSectionTitleClass}>Market Access</p>
                    <p className={adminSectionCopyClass}>{formatScope(selectedGroup.marketScope, "All markets", formatMarket)}</p>
                  </div>
                  <Globe2 className="h-4 w-4 text-violet-100/55" />
                </div>

                <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    { label: "All", values: ALL_MARKETS },
                    { label: "GCC", values: GCC_MARKETS },
                    { label: "UAE + KSA", values: ["UAE", "KSA"] },
                    { label: "India", values: ["INDIA"] },
                  ].map((preset) => (
                    <button
                      key={preset.label}
                      type="button"
                      onClick={() => setMarketPreset(selectedGroup.id, preset.values)}
                      className="min-h-9 rounded-xl border border-white/8 bg-white/[0.03] px-2 text-[11px] font-black text-white/58 transition-colors hover:border-violet-300/20 hover:bg-violet-300/10 hover:text-violet-100"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  {MARKET_OPTIONS.map((market) => {
                    const active = selectedGroup.marketScope.includes(market.key);
                    return (
                      <button
                        key={market.key}
                        type="button"
                        onClick={() => toggleScope(selectedGroup.id, "marketScope", market.key)}
                        className={cn(
                          "flex min-h-12 items-center justify-between gap-3 rounded-2xl border px-3 py-2 text-left transition-colors",
                          active
                            ? "border-violet-300/24 bg-violet-300/12 text-violet-100"
                            : "border-white/8 bg-white/[0.025] text-white/50 hover:border-white/14 hover:text-white/76"
                        )}
                      >
                        <span>
                          <span className="block text-xs font-black">{market.label}</span>
                          <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-normal text-white/32">{market.region}</span>
                        </span>
                        <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", active ? "bg-violet-300" : "bg-white/18")} />
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-4">
              <div className="flex items-center gap-2 text-xs text-white/42">
                <ShieldCheck className="h-4 w-4 text-cyan-100/45" />
                <span>{dirty ? "Unsaved changes are staged" : "Workspace policy is saved"}</span>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="gap-1.5 border-rose-300/16 bg-rose-300/[0.06] text-rose-100/80 hover:bg-rose-300/[0.10]" onClick={deleteGroup}>
                  <Trash2 className="h-3.5 w-3.5" />
                  Remove Group
                </Button>
                <Button size="sm" onClick={() => persistGroups(groups)} className={adminActionButtonClass} disabled={!dirty || saving}>
                  <Save className="h-3.5 w-3.5" />
                  {saving ? "Saving..." : "Save Access Policy"}
                </Button>
              </div>
            </div>
          </section>
        )}

        <aside className={cn(adminPanelClass, "overflow-hidden p-4 xl:col-span-2 min-[1800px]:col-span-1")}>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-cyan-300/14 bg-cyan-300/[0.07] text-cyan-100">
              <UserRoundCheck className="h-4 w-4" />
            </div>
            <div>
              <p className={adminSectionTitleClass}>Covered Users</p>
              <p className={adminSectionCopyClass}>Preview for selected group</p>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <div className="rounded-2xl border border-white/8 bg-white/[0.025] px-3 py-3">
              <p className={adminEyebrowClass}>Members</p>
              <p className="mt-1 text-xl font-black text-white">{isLoading ? "..." : selectedUsers.length}</p>
            </div>
            <div className="rounded-2xl border border-white/8 bg-white/[0.025] px-3 py-3">
              <p className={adminEyebrowClass}>Markets</p>
              <p className="mt-1 text-xl font-black text-white">{selectedGroup?.marketScope.length || "All"}</p>
            </div>
          </div>

          <div className="custom-scrollbar mt-4 max-h-[495px] space-y-2 overflow-y-auto pr-1">
            {isLoading ? (
              <div className="flex items-center justify-center gap-2 rounded-2xl border border-white/8 bg-white/[0.025] px-4 py-8 text-xs text-white/45">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading users
              </div>
            ) : selectedUsers.length > 0 ? (
              selectedUsers.slice(0, 12).map((user) => (
                <div key={user.email} className="rounded-2xl border border-white/8 bg-white/[0.025] px-3 py-3">
                  <p className="truncate text-sm font-bold text-white">{user.full_name || user.email}</p>
                  <p className="mt-0.5 truncate text-[11px] text-white/38">{user.email}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="rounded-full border border-cyan-300/14 bg-cyan-300/[0.07] px-2 py-0.5 text-[10px] font-black text-cyan-100/75">
                      {formatRole(user.role)}
                    </span>
                    <span className="rounded-full border border-violet-300/14 bg-violet-300/[0.07] px-2 py-0.5 text-[10px] font-black text-violet-100/75">
                      {formatMarket(canonicalMarket(user.market_region))}
                    </span>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center">
                <p className="text-sm font-semibold text-white/70">No users covered</p>
                <p className="mt-1 text-xs leading-5 text-white/38">Adjust role or market access to include active users.</p>
              </div>
            )}
            {selectedUsers.length > 12 && (
              <p className="px-2 text-[11px] font-semibold text-white/34">+{selectedUsers.length - 12} more users covered</p>
            )}
          </div>
        </aside>
      </div>

      <div className={cn(adminPanelClass, "flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between")}>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl border border-white/8 bg-white/[0.04] text-cyan-100/70">
            <SlidersHorizontal className="h-4 w-4" />
          </div>
          <div>
            <p className={adminSectionTitleClass}>Access rule</p>
            <p className={adminSectionCopyClass}>A user is covered when their role and market match an active group.</p>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={resetGroups} className={adminOutlineButtonClass}>
          <RefreshCw className="h-3.5 w-3.5" />
          Restore Standard Setup
        </Button>
      </div>
    </div>
  );
}
