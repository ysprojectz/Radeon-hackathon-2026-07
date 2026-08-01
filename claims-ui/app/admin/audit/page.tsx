import { permanentRedirect } from "next/navigation";

export default function AdminAuditPage() {
  permanentRedirect("/settings?section=admin-console#audit");
}
