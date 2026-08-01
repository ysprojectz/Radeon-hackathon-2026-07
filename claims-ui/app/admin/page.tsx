import { permanentRedirect } from "next/navigation";

// Admin Console now lives inside the unified Settings page
// (DESIGN_SYSTEM.md consolidation — see app/settings/SettingsWorkspace.tsx).
// Access control is enforced there, not here, matching the existing pattern
// used by app/admin/audit/page.tsx and its siblings.
export default function AdminPage() {
  permanentRedirect("/settings?section=admin-console");
}
