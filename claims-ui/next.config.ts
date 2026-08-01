import type { NextConfig } from "next";

// Security headers on all Next.js-served pages. Keep CSP compatible with
// Next.js hydration and the Cashfree sandbox SDK used from gateway settings.
// Pages remain protected from framing by X-Frame-Options: DENY; the CSP uses
// frame-ancestors 'self' so the authenticated PDF proxy can render in-app.
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://sdk.cashfree.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' https://api.stripe.com https://sandbox.cashfree.com https://api.cashfree.com",
  "frame-src 'self' https://sandbox.cashfree.com https://api.cashfree.com",
  "frame-ancestors 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,

  // @react-pdf/renderer is incompatible with React 18 Strict Mode double-invocation.
  // Strict Mode causes the PDF reconciler to throw during its simulated remount,
  // which triggers a Fast Refresh full reload loop in development.
  reactStrictMode: false,

  // Never expose source maps in production builds (hides application logic)
  productionBrowserSourceMaps: false,

  // Allow the preview tool (127.0.0.1) and localhost (any port) to access _next/* RSC resources
  allowedDevOrigins: [
    "localhost",
    "localhost:3000",
    "localhost:3001",
    "localhost:3002",
    "127.0.0.1",
    "127.0.0.1:3000",
    "127.0.0.1:3001",
  ],

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "X-Frame-Options",        value: "DENY" },
          { key: "X-Content-Type-Options",  value: "nosniff" },
          { key: "Referrer-Policy",         value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy",      value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
          { key: "X-Permitted-Cross-Domain-Policies", value: "none" },
          { key: "Origin-Agent-Cluster", value: "?1" },
        ],
      },
      {
        source: "/api/v1/claims/:reference/document",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
};

export default nextConfig;
