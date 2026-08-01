import { permanentRedirect } from "next/navigation";

export default function AdminGatewayPage() {
  permanentRedirect("/settings?section=admin-console#integrations-gateway");
}
