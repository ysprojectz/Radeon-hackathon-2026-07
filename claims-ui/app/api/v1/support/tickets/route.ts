import { NextRequest } from "next/server";
import { jsonWithSecurityHeaders, sameOriginGuard } from "@/lib/server-security";

const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export async function GET(req: NextRequest) {
  const cookie = req.headers.get("cookie") ?? "";
  const upstream = await fetch(`${API_URL}/api/v1/support/tickets`, {
    headers: { Cookie: cookie },
  });
  const data = await upstream.json().catch(() => []);
  return jsonWithSecurityHeaders(data, { status: upstream.status });
}

export async function POST(req: NextRequest) {
  const blockedForOrigin = sameOriginGuard(req);
  if (blockedForOrigin) return blockedForOrigin;

  const contentType = req.headers.get("content-type") ?? "";
  const cookie = req.headers.get("cookie") ?? "";

  // ── Multipart path (ticket with attachments) ──────────────────────────────
  if (contentType.toLowerCase().includes("multipart/form-data")) {
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return jsonWithSecurityHeaders({ error: "Invalid multipart body" }, { status: 400 });
    }

    // Client-side validation: type and size (backend validates too, but fail fast)
    const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "application/pdf"]);
    const MAX_BYTES = 5 * 1024 * 1024;

    for (const entry of formData.getAll("attachments")) {
      if (!(entry instanceof File)) continue;
      if (entry.size === 0) continue; // skip empty slots
      if (!ALLOWED_TYPES.has(entry.type)) {
        return jsonWithSecurityHeaders(
          { error: `Attachment type not allowed: ${entry.type}. Accepted: PNG, JPG, PDF.` },
          { status: 415 },
        );
      }
      if (entry.size > MAX_BYTES) {
        return jsonWithSecurityHeaders(
          { error: `Attachment "${entry.name}" exceeds the 5 MB limit.` },
          { status: 413 },
        );
      }
    }

    // Forward the form as-is — browser sets the correct multipart boundary
    const upstream = await fetch(`${API_URL}/api/v1/support/tickets`, {
      method: "POST",
      headers: { Cookie: cookie },
      body: formData as unknown as BodyInit,
      duplex: "half",
    } as RequestInit);
    const data = await upstream.json().catch(() => ({}));
    return jsonWithSecurityHeaders(data, { status: upstream.status });
  }

  // ── JSON path (ticket without attachments) ────────────────────────────────
  // Convert JSON body to form fields so the backend's Form-based endpoint
  // accepts it consistently.
  const contentTypeLower = contentType.toLowerCase();
  if (contentTypeLower.includes("application/json")) {
    let parsed: Record<string, string>;
    try {
      parsed = await req.json();
    } catch {
      return jsonWithSecurityHeaders({ error: "Invalid JSON body" }, { status: 400 });
    }

    const form = new FormData();
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") form.append(key, value);
    }

    const upstream = await fetch(`${API_URL}/api/v1/support/tickets`, {
      method: "POST",
      headers: { Cookie: cookie },
      body: form as unknown as BodyInit,
      duplex: "half",
    } as RequestInit);
    const data = await upstream.json().catch(() => ({}));
    return jsonWithSecurityHeaders(data, { status: upstream.status });
  }

  return jsonWithSecurityHeaders(
    { error: "Content-Type must be application/json or multipart/form-data" },
    { status: 415 },
  );
}
