import { permanentRedirect } from "next/navigation";

export default function AdminConfigurationPage() {
  permanentRedirect("/settings?section=master-settings");
}
