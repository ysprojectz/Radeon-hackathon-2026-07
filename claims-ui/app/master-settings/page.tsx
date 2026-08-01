import { permanentRedirect } from "next/navigation";

// Master Settings now lives inside the unified Settings page
// (DESIGN_SYSTEM.md consolidation — see app/settings/SettingsWorkspace.tsx).
// Access control is enforced there, not here, matching the existing pattern
// used by app/admin/audit/page.tsx and its siblings.
export default function MasterSettingsPage() {
  permanentRedirect("/settings?section=master-settings");
}
