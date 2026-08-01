import { permanentRedirect } from "next/navigation";

export default function AdminFlowsPage() {
  permanentRedirect("/settings?section=admin-console#integrations-flows");
}
