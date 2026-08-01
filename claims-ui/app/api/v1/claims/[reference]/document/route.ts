import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  emptyResponseWithSecurityHeaders,
  jsonWithSecurityHeaders,
  withSecurityHeaders,
} from "@/lib/server-security";

/**
 * API Route: GET /api/claims/{reference}/document
 *            HEAD /api/claims/{reference}/document
 *
 * Proxy endpoint to serve claim PDFs with authentication.
 *
 * Why needed:
 * - Backend endpoint requires JWT authentication
 * - <iframe> and <object> tags don't send auth headers
 * - This route runs server-side with access to httpOnly cookies
 * - Fetches PDF from backend with proper auth, streams to client
 */

/**
 * HEAD handler - Check if document exists without downloading it
 */
export async function HEAD(
  request: NextRequest,
  { params }: { params: Promise<{ reference: string }> }
) {
  try {
    const { reference } = await params;
    const apiUrl = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

    const cookieStore = await cookies();
    const authToken = cookieStore.get("access_token")?.value;

    if (!authToken) {
      return emptyResponseWithSecurityHeaders({ status: 401 });
    }

    // HEAD request to backend
    const backendUrl = `${apiUrl}/api/v1/claims/${encodeURIComponent(reference)}/document`;
    const response = await fetch(backendUrl, {
      method: "HEAD",
      headers: {
        Cookie: `access_token=${authToken}`,
      },
      redirect: "manual",
    });

    // Return same status code as backend
    return emptyResponseWithSecurityHeaders({ status: response.status });
  } catch (error) {
    console.error("[PDF-PROXY HEAD] Error:", error);
    return emptyResponseWithSecurityHeaders({ status: 500 });
  }
}

/**
 * GET handler - Download and stream the PDF
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ reference: string }> }
) {
  try {
    const { reference } = await params;
    const apiUrl = process.env.API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

    // Get authentication token from httpOnly cookie
    const cookieStore = await cookies();
    const authToken = cookieStore.get("access_token")?.value;

    if (!authToken) {
      return jsonWithSecurityHeaders(
        { error: "Authentication required" },
        { status: 401 }
      );
    }

    // Fetch PDF from backend API with authentication
    const backendUrl = `${apiUrl}/api/v1/claims/${encodeURIComponent(reference)}/document`;
    const response = await fetch(backendUrl, {
      headers: {
        Cookie: `access_token=${authToken}`,
      },
      // Don't follow redirects - pass through status codes
      redirect: "manual",
    });

    // Handle authentication failures
    if (response.status === 401 || response.status === 403) {
      return jsonWithSecurityHeaders(
        { error: "Unauthorized - please log in again" },
        { status: response.status }
      );
    }

    // Handle not found
    if (response.status === 404) {
      return jsonWithSecurityHeaders(
        { error: "Document not found for this claim" },
        { status: 404 }
      );
    }

    // Handle other errors
    if (!response.ok) {
      return jsonWithSecurityHeaders(
        { error: `Failed to fetch document: ${response.statusText}` },
        { status: response.status }
      );
    }

    // Get the PDF binary data
    const pdfBuffer = await response.arrayBuffer();

    // Return PDF with proper headers for inline viewing
    return withSecurityHeaders(new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${reference}.pdf"`,
        // Security headers for embedded content
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "SAMEORIGIN",
      },
    }));
  } catch (error) {
    console.error("[PDF-PROXY] Error fetching claim document:", error);
    return jsonWithSecurityHeaders(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
