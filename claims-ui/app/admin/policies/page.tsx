import { permanentRedirect } from "next/navigation";

export default function AdminPoliciesPage() {
  permanentRedirect("/settings?section=admin-console#policies");
}
