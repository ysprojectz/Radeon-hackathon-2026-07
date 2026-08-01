import { permanentRedirect } from "next/navigation";

export default function AdminDashboardPage() {
  permanentRedirect("/settings?section=admin-console#settings");
}
