/**
 * General API Proxy Route
 * 
 * This catch-all route proxies ALL requests from /api/proxy/** to the backend API Gateway.
 * It serves as the main proxy for all API calls from the frontend to the backend.
 * 
 * Routes handled:
 *   - POST /api/proxy/auth/login → POST http://localhost:8000/api/v1/auth/login
 *   - GET  /api/proxy/auth/me → GET http://localhost:8000/api/v1/auth/me
 *   - POST /api/proxy/auth/totp/* → POST http://localhost:8000/api/v1/auth/totp/*
 *   - All other /api/proxy/** paths
 */

import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { sameOriginGuard } from "@/lib/server-security";

const API_URL = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// Methods that may have a request body
const BODY_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Headers to forward from client to backend
const FORWARD_HEADERS = new Set([
  "content-type",
  "authorization",
  "x-api-key",
  "x-request-id",
  "accept",
  "accept-language",
  "user-agent",
]);

export async function GET(request: NextRequest) {
  return handleProxyRequest(request);
}

export async function POST(request: NextRequest) {
  return handleProxyRequest(request);
}

export async function PUT(request: NextRequest) {
  return handleProxyRequest(request);
}

export async function DELETE(request: NextRequest) {
  return handleProxyRequest(request);
}

export async function PATCH(request: NextRequest) {
  return handleProxyRequest(request);
}

export async function HEAD(request: NextRequest) {
  return handleProxyRequest(request, { skipBody: true });
}

export async function OPTIONS(request: NextRequest) {
  return handleProxyRequest(request, { skipBody: true });
}

interface ProxyOptions {
  skipBody?: boolean;
}

async function handleProxyRequest(request: NextRequest, options: ProxyOptions = {}) {
  const { skipBody = false } = options;
  const blockedForOrigin = sameOriginGuard(request);
  if (blockedForOrigin) return blockedForOrigin;

  const { pathname, search } = request.nextUrl;
  
  // Extract the path after /api/v1/proxy
  // Example: /api/v1/proxy/auth/login → /auth/login → target: API_URL/api/v1/auth/login
  const pathAfterProxy = pathname.replace(/^\/api\/v1\/proxy/, "");
  const targetUrl = `${API_URL}/api/v1${pathAfterProxy}${search}`;
  
  try {
    // Get all cookies from the request
    const cookieStore = await cookies();
    const cookieHeader = cookieStore.getAll()
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
    
    // Build headers for the backend request
    const backendHeaders: Record<string, string> = {};
    
    // Forward selected headers
    for (const headerName of FORWARD_HEADERS) {
      const headerValue = request.headers.get(headerName);
      if (headerValue) {
        backendHeaders[headerName] = headerValue;
      }
    }
    
    // Always forward cookies for authentication
    if (cookieHeader) {
      backendHeaders["Cookie"] = cookieHeader;
    }
    
    // Handle request body for methods that can have one
    let body: BodyInit | undefined;
    if (!skipBody && BODY_METHODS.has(request.method)) {
      // For form data, stream it directly
      const contentType = request.headers.get("content-type") ?? "";
      if (contentType.includes("multipart/form-data")) {
        body = request.body ?? undefined;
      } else {
        // For JSON, try to get array buffer
        try {
          const arrayBuffer = await request.arrayBuffer();
          if (arrayBuffer.byteLength > 0) {
            body = arrayBuffer;
          }
        } catch {
          // If we can't read the body, just pass the request body as-is
          body = request.body ?? undefined;
        }
      }
    }
    
    // Make the request to the backend
    const requestInit: RequestInit & { duplex?: "half" } = {
      method: request.method,
      headers: Object.keys(backendHeaders).length > 0 ? backendHeaders : undefined,
      body,
      redirect: "manual",
      // Don't use credentials - we're manually passing cookies
      credentials: "omit",
    };

    if (body !== undefined && body === request.body) {
      requestInit.duplex = "half";
    }

    const backendResponse = await fetch(targetUrl, requestInit);
    
    // Handle redirect responses - convert backend redirects to frontend-relative
    if ([301, 302, 303, 307, 308].includes(backendResponse.status)) {
      const location = backendResponse.headers.get("location");
      if (location) {
        const newLocation = location.replace(/^\/api\/v1/, "/api/proxy");
        return NextResponse.redirect(newLocation, {
          status: backendResponse.status,
        });
      }
    }
    
    // Get response body and headers
    const contentType = backendResponse.headers.get("content-type") ?? "";
    const isJson = contentType.includes("application/json");
    const isText = contentType.includes("text/");
    
    let responseBody: BodyInit | null = null;
    
    if (isJson) {
      const json = await backendResponse.json().catch(() => null);
      responseBody = json === null ? null : JSON.stringify(json);
    } else if (isText) {
      responseBody = await backendResponse.text().catch(() => null);
    } else {
      // Binary data (PDFs, images, etc.)
      responseBody = await backendResponse.arrayBuffer().catch(() => null);
    }
    
    // Build response headers for the client
    const clientHeaders = new Headers();
    
    // Forward all response headers except the ones we handle specially
    for (const [headerName, headerValue] of backendResponse.headers.entries()) {
      const lowerHeaderName = headerName.toLowerCase();
      // We handle set-cookie separately below. Hop-by-hop and body framing
      // headers must be recalculated by NextResponse after the proxy has read
      // and recreated the upstream body; forwarding them can make browsers see
      // a successful API response as a truncated network load.
      if (
        lowerHeaderName !== "set-cookie" &&
        lowerHeaderName !== "content-length" &&
        lowerHeaderName !== "transfer-encoding" &&
        lowerHeaderName !== "content-encoding" &&
        lowerHeaderName !== "connection"
      ) {
        clientHeaders.set(headerName, headerValue);
      }
    }
    
    // Forward ALL Set-Cookie headers from the backend to the browser
    // This is crucial for authentication (access_token, refresh_token cookies)
    const setCookieHeaders = backendResponse.headers.getSetCookie();
    if (setCookieHeaders && setCookieHeaders.length > 0) {
      for (const cookie of setCookieHeaders) {
        clientHeaders.append("Set-Cookie", cookie);
      }
    }
    
    // Set security headers
    clientHeaders.set("X-Content-Type-Options", "nosniff");
    clientHeaders.set("X-Frame-Options", "DENY");
    clientHeaders.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
    clientHeaders.set("Pragma", "no-cache");
    clientHeaders.set("Expires", "0");
    
    // Return the response
    return new NextResponse(responseBody, {
      status: backendResponse.status,
      statusText: backendResponse.statusText,
      headers: clientHeaders,
    });
  } catch (error) {
    console.error("[API Proxy] Error:", error);
    
    return new NextResponse(
      JSON.stringify({
        error: "Service unavailable",
        message: "The backend service is unavailable. Please try again.",
      }),
      {
        status: 503,
        headers: {
          "Content-Type": "application/json",
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-store",
        },
      }
    );
  }
}
