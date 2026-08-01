import { NextRequest } from "next/server";
import {
  emptyResponseWithSecurityHeaders,
  jsonWithSecurityHeaders,
  sameOriginGuard,
} from "@/lib/server-security";

const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const blockedForOrigin = sameOriginGuard(req);
  if (blockedForOrigin) return blockedForOrigin;

  const { id } = await params;
  const cookie = req.headers.get("cookie") ?? "";
  const upstream = await fetch(`${API_URL}/api/v1/calendar/${id}`, {
    method: "DELETE",
    headers: { "Cookie": cookie },
  });
  if (upstream.status === 204) {
    return emptyResponseWithSecurityHeaders({ status: 204 });
  }
  const data = await upstream.json().catch(() => ({}));
  return jsonWithSecurityHeaders(data, { status: upstream.status });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const blockedForOrigin = sameOriginGuard(req);
  if (blockedForOrigin) return blockedForOrigin;

  const { id } = await params;
  const body = await req.text();
  const cookie = req.headers.get("cookie") ?? "";
  const upstream = await fetch(`${API_URL}/api/v1/calendar/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", "Cookie": cookie },
    body,
  });
  const data = await upstream.json().catch(() => ({}));
  return jsonWithSecurityHeaders(data, { status: upstream.status });
}
