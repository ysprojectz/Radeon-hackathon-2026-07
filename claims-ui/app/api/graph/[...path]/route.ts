import { NextRequest, NextResponse } from "next/server";
import {
  emptyResponseWithSecurityHeaders,
  jsonWithSecurityHeaders,
  sameOriginGuard,
  withSecurityHeaders,
} from "@/lib/server-security";

export const dynamic = "force-dynamic";

const FORWARD_HEADERS = new Set(["accept", "content-type", "x-request-id"]);
const BODY_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function graphServiceBase(): string {
  const configured =
    process.env.GRAPH_SERVICE_URL ??
    process.env.NEXT_PUBLIC_GRAPH_SERVICE_URL ??
    "http://localhost:8010";

  return configured.replace(/\/event\/?$/, "").replace(/\/$/, "");
}

async function proxyGraphRequest(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
  options: { skipBody?: boolean } = {},
) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    const blockedForOrigin = sameOriginGuard(request);
    if (blockedForOrigin) return blockedForOrigin;
  }

  const { path } = await params;
  const firstSegment = path[0];
  if (!["event", "graph", "query"].includes(firstSegment)) {
    return jsonWithSecurityHeaders(
      { error: "Unsupported graph service route" },
      { status: 404 },
    );
  }

  const targetPath = path.map((segment) => encodeURIComponent(segment)).join("/");
  const targetUrl = `${graphServiceBase()}/${targetPath}${request.nextUrl.search}`;

  try {
    const headers: Record<string, string> = {};
    for (const headerName of FORWARD_HEADERS) {
      const headerValue = request.headers.get(headerName);
      if (headerValue) headers[headerName] = headerValue;
    }

    let body: BodyInit | undefined;
    if (!options.skipBody && BODY_METHODS.has(request.method)) {
      const payload = await request.arrayBuffer();
      if (payload.byteLength > 0) body = payload;
    }

    const upstream = await fetch(targetUrl, {
      method: request.method,
      headers,
      body,
      redirect: "manual",
      cache: "no-store",
    });

    if (request.method === "HEAD") {
      return emptyResponseWithSecurityHeaders({ status: upstream.status });
    }

    const contentType = upstream.headers.get("content-type") ?? "";
    const responseHeaders = new Headers();
    if (contentType) responseHeaders.set("Content-Type", contentType);

    const responseBody = await upstream.arrayBuffer().catch(() => null);
    return withSecurityHeaders(
      new NextResponse(responseBody, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: responseHeaders,
      }),
    );
  } catch (error) {
    console.error("[Graph Proxy] Error:", error);
    return jsonWithSecurityHeaders(
      {
        error: "Graph service unavailable",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 503 },
    );
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  return proxyGraphRequest(request, context);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  return proxyGraphRequest(request, context);
}

export async function HEAD(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  return proxyGraphRequest(request, context, { skipBody: true });
}
