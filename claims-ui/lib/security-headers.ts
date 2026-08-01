import { NextResponse } from "next/server";

/**
 * Forward security headers from a backend response to a Next.js response.
 * This ensures that security headers set by the backend are inherited by the API route response.
 */
export function forwardSecurityHeadersFromBackend(
  backendResponse: Response,
  nextResponse: NextResponse
): NextResponse {
  const securityHeaders = [
    'set-cookie',
    'content-security-policy',
    'x-frame-options',
    'x-xss-protection',
    'strict-transport-security',
    'referrer-policy',
    'permissions-policy',
    'x-content-type-options',
  ];

  for (const header of securityHeaders) {
    const value = backendResponse.headers.get(header);
    if (value) {
      nextResponse.headers.set(header, value);
    }
  }

  return nextResponse;
}

/**
 * Get common security headers for Next.js API responses.
 * These are applied to all API routes for baseline security.
 */
export function getCommonSecurityHeaders(): HeadersInit {
  return {
    // Prevent MIME type sniffing
    'X-Content-Type-Options': 'nosniff',
    // Enable XSS protection (legacy but still useful)
    'X-XSS-Protection': '1; mode=block',
    // Control referrer information
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    // Prevent clickjacking
    'X-Frame-Options': 'SAMEORIGIN',
  };
}