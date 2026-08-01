import { NextRequest, NextResponse } from "next/server";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
  "Pragma": "no-cache",
  "Expires": "0",
  "X-Content-Type-Options": "nosniff",
} as const;

function responseWithSecurityHeaders(response: NextResponse): NextResponse {
  for (const [key, value] of Object.entries(NO_STORE_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

export function jsonWithSecurityHeaders(
  body: unknown,
  init?: ResponseInit & { status?: number },
): NextResponse {
  return responseWithSecurityHeaders(NextResponse.json(body, init));
}

export function emptyResponseWithSecurityHeaders(init?: ResponseInit): NextResponse {
  return responseWithSecurityHeaders(new NextResponse(null, init));
}

export function sameOriginGuard(req: NextRequest): NextResponse | null {
  const originHeader = req.headers.get("origin");

  // No Origin header = same-origin browser fetch; browsers omit it on same-origin requests.
  if (!originHeader) return null;

  let sourceOrigin: string;
  try {
    sourceOrigin = new URL(originHeader).origin;
  } catch {
    return jsonWithSecurityHeaders({ error: "Invalid origin header" }, { status: 403 });
  }

  // Behind a reverse proxy the internal Next.js origin differs from the public domain.
  // Reconstruct the public origin from forwarded headers set by nginx.
  // When x-forwarded-proto is absent there is no reverse proxy in front, so fall
  // back to the actual protocol Next.js is serving on (req.nextUrl.protocol strips
  // the trailing colon, e.g. "http" or "https").
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const fallbackProto = (() => {
    const requestProtocol = req.nextUrl.protocol?.replace(/:$/, "");
    if (requestProtocol) return requestProtocol;
    try {
      return new URL(req.nextUrl.origin).protocol.replace(/:$/, "");
    } catch {
      return "http";
    }
  })();
  const proto = req.headers.get("x-forwarded-proto") ?? fallbackProto;
  const serverOrigin = host ? `${proto}://${host}` : req.nextUrl.origin;

  if (sourceOrigin !== serverOrigin) {
    return jsonWithSecurityHeaders({ error: "Cross-origin request blocked" }, { status: 403 });
  }

  return null;
}

export function validateJsonRequest(req: NextRequest): NextResponse | null {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return jsonWithSecurityHeaders(
      { error: "Content-Type must be application/json" },
      { status: 415 },
    );
  }
  return null;
}

export function withSecurityHeaders(response: NextResponse): NextResponse {
  return responseWithSecurityHeaders(response);
}
