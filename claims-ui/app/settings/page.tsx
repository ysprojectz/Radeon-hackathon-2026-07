import { cookies } from "next/headers";
import { PageHeader } from "@/components/shared/PageHeader";
import { getDashboardKPIsServer, getMeServer } from "@/lib/api-server";
import { SettingsWorkspace } from "./SettingsWorkspace";

// Unified settings entry point (DESIGN_SYSTEM.md consolidation):
//   - Personal section: available to every signed-in user (auth already
//     enforced by middleware.ts for this route — no extra redirect needed).
//   - Master Settings / Admin Console sections: only rendered (and only
//     fetched) when the signed-in user is ADMIN — mirrors the exact role
//     check that used to live in app/admin/page.tsx and
//     app/master-settings/page.tsx before those became redirect shims here.
export default async function SettingsPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get("access_token");

  const user = token ? await getMeServer(token.value) : null;
  const isAdmin = user?.role === "ADMIN";

  const initialKPIs = isAdmin && token ? await getDashboardKPIsServer(token.value) : null;

  return (
    <div className="acos-page">
      <PageHeader title="Settings" />
      <SettingsWorkspace isAdmin={isAdmin} initialKPIs={initialKPIs} />
    </div>
  );
}
