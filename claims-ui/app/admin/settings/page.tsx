import { permanentRedirect } from "next/navigation";

export default function AdminSettingsPage() {
  permanentRedirect("/settings?section=master-settings");
}
