import { NextResponse, type NextRequest } from "next/server";

/**
 * Role-based routing:
 * - Public pages: "/", "/calendar", "/journal", "/trades", "/reports", "/login"
 * - Public APIs (GET read-only): "/api/auth", "/api/webhooks/*", "/api/trades*", "/api/stats",
 *   "/api/performance-trends", "/api/analysis", "/api/calendar", "/api/journal*",
 *   "/api/attachments*", "/api/accounts", "/api/playbooks", "/api/adherence",
 *   "/api/trade-explorer", "/api/eas"
 * - All other pages (e.g. /accounts, /settings, /import, /prop-firms, /notebook,
 *   /playbooks, /progress, /missed) require valid admin session cookie, else redirect to /login.
 * - All other APIs (and mutations POST/PATCH/DELETE) require valid admin session, else return 401.
 */
export const middleware = (request: NextRequest) => {
  if (!process.env.JOURNAL_PASSWORD) return NextResponse.next();
  const { pathname } = request.nextUrl;

  // Webhooks are always public (authenticated via their own secret)
  if (pathname.startsWith("/api/webhooks/")) return NextResponse.next();

  // Auth endpoint is public
  if (pathname === "/api/auth") return NextResponse.next();

  // Check if public page
  const isPublicPage =
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/calendar" ||
    pathname.startsWith("/calendar/") ||
    pathname === "/journal" ||
    pathname.startsWith("/journal/") ||
    pathname === "/trades" ||
    pathname.startsWith("/trades/") ||
    pathname === "/reports" ||
    pathname.startsWith("/reports/");

  if (isPublicPage) {
    return NextResponse.next();
  }

  // Check cookie for protected routes
  const cookie = request.cookies.get("journal_session")?.value;
  if (!cookie) {
    if (pathname.startsWith("/api/")) {
      // If it's a public GET API route, allow it so handler can process it
      const isPublicApi =
        request.method === "GET" &&
        (pathname.startsWith("/api/trades") ||
          pathname.startsWith("/api/stats") ||
          pathname.startsWith("/api/performance-trends") ||
          pathname.startsWith("/api/analysis") ||
          pathname.startsWith("/api/calendar") ||
          pathname.startsWith("/api/journal") ||
          pathname.startsWith("/api/attachments") ||
          pathname.startsWith("/api/accounts") ||
          pathname.startsWith("/api/playbooks") ||
          pathname.startsWith("/api/adherence") ||
          pathname.startsWith("/api/trade-explorer") ||
          pathname.startsWith("/api/eas"));

      if (isPublicApi) {
        return NextResponse.next();
      }

      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
};

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
