import { NextResponse, type NextRequest } from "next/server";
import { verifySession } from "@/server/auth";

export const middleware = async (request: NextRequest) => {
  if (!process.env.JOURNAL_PASSWORD) return NextResponse.next();
  
  const { pathname } = request.nextUrl;
  
  // Webhooks are always public
  if (pathname.startsWith("/api/webhooks/")) return NextResponse.next();
  if (pathname === "/api/auth") return NextResponse.next();
  
  // Public pages
  const isPublicPage = [
    "/", "/login", "/calendar", "/journal", "/trades", "/reports"
  ].some(p => pathname === p || pathname.startsWith(p + "/"));
  
  if (isPublicPage) return NextResponse.next();
  
  // Read cookie via headers (compatible with Edge runtime on Vercel)
  const cookieHeader = request.headers.get("cookie") || "";
  const sessionMatch = cookieHeader.match(/journal_session=([^;]+)/);
  const token = sessionMatch?.[1];
  
  const isValid = await verifySession(token);
  
  if (!isValid) {
    if (pathname.startsWith("/api/")) {
      // Public API check
      const isPublicApi = 
        (request.method === "GET" && [
          "/api/trades", "/api/stats", "/api/performance-trends",
          "/api/analysis", "/api/calendar", "/api/journal",
          "/api/attachments", "/api/accounts", "/api/playbooks",
          "/api/adherence", "/api/trade-explorer", "/api/eas"
        ].some(p => pathname.startsWith(p))) ||
        (request.method === "POST" && pathname === "/api/ai/ask");
      
      if (isPublicApi) return NextResponse.next();
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }
  
  return NextResponse.next();
};

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.png$).*)"],
};
