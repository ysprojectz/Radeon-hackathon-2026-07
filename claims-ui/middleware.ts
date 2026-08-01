import { NextRequest, NextResponse } from "next/server";

const PUBLIC_PATHS = new Set(["/landing", "/login", "/title-preview"]);
const PROTECTED_ROOT = "/";
const NO_CACHE_VALUE =
  "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0";

function applySecurityHeaders(response: NextResponse) {
  response.headers.set("X-Robots-Tag", "noindex, nofollow, noarchive, nosnippet");
  response.headers.set("Cache-Control", NO_CACHE_VALUE);
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  return response;
}

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const hasSession = Boolean(request.cookies.get("access_token")?.value);

  if (!PUBLIC_PATHS.has(pathname) && !hasSession) {
    const url = request.nextUrl.clone();

    if (pathname === PROTECTED_ROOT) {
      url.pathname = "/landing";
      url.search = "";
    } else {
      url.pathname = "/login";
      url.search = `?next=${encodeURIComponent(`${pathname}${search}`)}`;
    }

    return applySecurityHeaders(NextResponse.redirect(url));
  }

  return applySecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: [
    /*
     * Apply to app pages only. Exclude APIs, Next internals, and static asset files.
     */
    "/((?!api|_next/static|_next/image|favicon.ico|icon.png|icon.svg|apple-icon.png|robots.txt|.*\\.[a-zA-Z0-9]+$).*)",
  ],
};
