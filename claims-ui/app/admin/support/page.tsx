import { permanentRedirect } from "next/navigation";

export default function AdminSupportPage() {
  permanentRedirect("/settings?section=admin-console#operations-support");
}
