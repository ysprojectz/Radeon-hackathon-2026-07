import { NextRequest } from "next/server";
import {
  jsonWithSecurityHeaders,
  sameOriginGuard,
  validateJsonRequest,
} from "@/lib/server-security";

const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const blockedForOrigin = sameOriginGuard(req);
  if (blockedForOrigin) return blockedForOrigin;

  const blockedForContentType = validateJsonRequest(req);
  if (blockedForContentType) return blockedForContentType;

  const { id } = await params;
  const body = await req.text();
  const cookie = req.headers.get("cookie") ?? "";
  const upstream = await fetch(`${API_URL}/api/v1/support/tickets/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "Cookie": cookie },
    body,
  });
  const data = await upstream.json().catch(() => ({}));
  return jsonWithSecurityHeaders(data, { status: upstream.status });
}
