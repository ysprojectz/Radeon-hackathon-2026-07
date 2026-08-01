import { permanentRedirect } from "next/navigation";

export default function AdminSalesPage() {
  permanentRedirect("/settings?section=admin-console#operations-sales");
}
