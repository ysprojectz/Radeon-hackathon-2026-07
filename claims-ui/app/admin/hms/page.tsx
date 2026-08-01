import { permanentRedirect } from "next/navigation";

export default function AdminHMSPage() {
  permanentRedirect("/settings?section=admin-console#integrations-hms");
}
