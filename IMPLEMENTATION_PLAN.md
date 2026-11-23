# Implementation Plan: Fix Vercel Authentication Bug

> **Issue:** Authentication not working on Vercel deployment - users can access protected routes without login
> **Environment:** Vercel Production Deployment
> **Priority:** Critical - Security Issue

---

## 🎯 Problem Statement

**Current Behavior:**
- User sets `JOURNAL_PASSWORD` in Vercel Environment Variables
- User enters password on `/login` page
- After login, user still sees **public view** (unauthenticated)
- Protected routes (`/accounts`, `/settings`, `/import`, etc.) accessible without auth
- Sometimes "restart" or refresh fixes it temporarily

**Expected Behavior:**
- Login redirects to dashboard
- Protected routes require valid session cookie
- Session persists across refreshes
- Session invalidates when password changes

---

## 🔍 Root Cause Analysis

### 1. **Cookie `secure` Flag Issue on Vercel**
**File:** `apps/web/src/server/auth.ts` (lines 28-35)

```typescript
jar.set(AUTH_COOKIE, sessionToken(), {
  httpOnly: true,
  sameSite: "lax",
  secure: new URL(request.url).protocol === "https:",  // ← PROBLEM
  path: "/",
  maxAge: 60 * 60 * 24 * 30,
});
```

**Issue:** On Vercel, `request.url` in API routes may not reflect the actual protocol due to:
- Vercel's proxy/load balancer
- `x-forwarded-proto` header handling
- Edge middleware vs Node.js runtime differences

**Result:** Cookie `secure: true` set on HTTPS, but Vercel's edge network may not send it back properly.

### 2. **Middleware Cookie Reading Issue**
**File:** `apps/web/src/middleware.ts` (lines 60-65)

```typescript
const cookie = request.cookies.get("journal_session")?.value;
if (!cookie) {
  // Redirects to login or returns 401
}
```

**Issue:** Next.js middleware `request.cookies.get()` may not read cookies set by API routes due to:
- Different runtime (Edge vs Node.js)
- Cookie domain/path mismatch on Vercel's domain
- `secure` flag preventing cookie transmission

### 3. **Vercel Environment Variable Not Set**
**Issue:** `JOURNAL_PASSWORD` not configured in Vercel Dashboard → `passwordConfigured()` returns `false` → Auth disabled entirely.

### 4. **Cookie Domain/Path Mismatch on Vercel Domain**
**Issue:** Vercel deploys to `*.vercel.app` or custom domain. Cookie `path: "/"` should work, but `domain` attribute missing may cause issues on subdomains.

---

## 📋 Implementation Plan

### Phase 1: Diagnose & Verify (Immediate)

#### Task 1.1: Verify Vercel Environment Variables
- [ ] Check Vercel Dashboard → Project → Settings → Environment Variables
- [ ] Verify `JOURNAL_PASSWORD` is set for **Production**, **Preview**, and **Development**
- [ ] Verify `MT_WEBHOOK_SECRET` is set
- [ ] Redeploy after adding variables

#### Task 1.2: Add Debug Logging
- [ ] Add temporary logging to `/api/auth/route.ts` to verify `passwordConfigured()` and cookie setting
- [ ] Add logging to `middleware.ts` to verify cookie reading
- [ ] Deploy and check Vercel Function Logs

#### Task 1.3: Test Cookie Behavior
- [ ] Login on Vercel deployment
- [ ] Open DevTools → Application → Cookies
- [ ] Verify `journal_session` cookie exists with correct attributes:
  - `Secure: true` (on HTTPS)
  - `HttpOnly: true`
  - `SameSite: Lax`
  - `Path: /`
  - `Domain: .vercel.app` or custom domain

---

### Phase 2: Fix Cookie Configuration (Core Fix)

#### Task 2.1: Fix Cookie `secure` Flag Logic
**File:** `apps/web/src/server/auth.ts`

**Current Code (Lines 28-35):**
```typescript
jar.set(AUTH_COOKIE, sessionToken(), {
  httpOnly: true,
  sameSite: "lax",
  secure: new URL(request.url).protocol === "https:",
  path: "/",
  maxAge: 60 * 60 * 24 * 30,
});
```

**Fixed Version:**
```typescript
// apps/web/src/server/auth.ts
import { cookies } from "next/headers";

// Helper to determine if we're on HTTPS (considering Vercel proxy headers)
const isSecureRequest = (request: Request): boolean => {
  const url = new URL(request.url);
  // Check protocol directly
  if (url.protocol === "https:") return true;
  // Check Vercel proxy headers
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedProto === "https") return true;
  // Check for Vercel-specific headers
  const vercelEnv = process.env.VERCEL;
  if (vercelEnv === "1" && url.hostname.includes(".vercel.app")) return true;
  return false;
}

export const setAuthCookie = async (request: Request, token: string) => {
  const jar = await cookies();
  const isSecure = isSecureRequest(request);
  
  jar.set(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecure,  // Use robust detection
    path: "/",
    // domain: process.env.COOKIE_DOMAIN, // Optional: set for custom domains
    maxAge: 60 * 60 * 24 * 30,
  });
};

// Update POST handler to use setAuthCookie
export const POST = handler(
  async (request: Request) => {
    if (!passwordConfigured()) return ok({ authenticated: true });
    const { password } = (await request.json()) as { password?: string };
    if (typeof password !== "string" || !password || !verifyPassword(password))
      return bad("Wrong password", 401);
    
    const token = sessionToken();
    await setAuthCookie(request, token);  // Use new helper
    return ok({ authenticated: true });
  },
  { public: true },
);
```

#### Task 2.2: Fix Middleware Cookie Reading
**File:** `apps/web/src/middleware.ts`

**Current Issue:** `request.cookies.get()` may not work reliably on Vercel Edge runtime.

**Fixed Version:**
```typescript
// apps/web/src/middleware.ts
import { NextResponse, type NextRequest } from "next/server";
import { verifySession } from "@/server/auth";

export const middleware = (request: NextRequest) => {
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
  
  // Read cookie - use request.headers for Edge compatibility
  const cookieHeader = request.headers.get("cookie") || "";
  const sessionMatch = cookieHeader.match(/journal_session=([^;]+)/);
  const token = sessionMatch?.[1];
  
  const isValid = verifySession(token);
  
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
```

---

### Phase 3: Vercel-Specific Configuration

#### Task 3.1: Add `vercel.json` for Cookie/Headers
**File:** `vercel.json` (update existing)

```json
{
  "headers": [
    {
      "source": "/api/auth/(.*)",
      "headers": [
        { "key": "Set-Cookie", "value": "journal_session=; Path=/; HttpOnly; SameSite=Lax; Secure" }
      ]
    }
  ],
  "rewrites": [
    { "source": "/login", "destination": "/login" }
  ]
}
```

#### Task 3.2: Set Cookie Domain for Vercel
**File:** `apps/web/src/server/auth.ts` (add to `setAuthCookie`)

```typescript
const cookieDomain = process.env.COOKIE_DOMAIN 
  || (process.env.VERCEL === "1" ? ".vercel.app" : undefined);

jar.set(AUTH_COOKIE, token, {
  // ... other options
  ...(cookieDomain && { domain: cookieDomain }),
});
```

Set in Vercel Dashboard: `COOKIE_DOMAIN = .yourdomain.com` (for custom domains) or leave unset for `vercel.app`.

---

### Phase 4: Testing & Validation

#### Task 4.1: Local Testing with Vercel CLI
```bash
pnpm i -g vercel
vercel dev  # Test locally with Vercel-like environment
```

#### Task 4.2: Deployment Checklist
- [ ] Push changes to GitHub
- [ ] Vercel auto-deploys
- [ ] Verify Environment Variables in Vercel Dashboard
- [ ] Test login flow on deployed URL
- [ ] Test protected routes (`/accounts`, `/settings`)
- [ ] Test session persistence (refresh, close/open browser)
- [ ] Test logout (`DELETE /api/auth`)
- [ ] Test password change invalidates sessions

#### Task 4.3: Edge Cases
- [ ] Test on `vercel.app` subdomain
- [ ] Test on custom domain (if configured)
- [ ] Test with `vercel.app` and `www.yourdomain.com` simultaneously
- [ ] Test password rotation invalidates existing sessions

---

## 📁 Files to Modify

| File | Priority | Changes |
|------|----------|---------|
| `apps/web/src/server/auth.ts` | **Critical** | Fix `secure` flag logic, add `isSecureRequest()` helper, add cookie domain support |
| `apps/web/src/middleware.ts` | **Critical** | Fix cookie reading for Edge runtime, use `request.headers.get("cookie")` |
| `vercel.json` | **High** | Add cookie headers, security headers |
| `.env.example` | **Medium** | Document `COOKIE_DOMAIN` variable |
| `apps/web/src/app/api/auth/route.ts` | **Low** | Use new `setAuthCookie` helper |

---

## ✅ Acceptance Criteria

| Test Case | Expected Result |
|-----------|-----------------|
| Login with correct password on Vercel | Redirects to dashboard, cookie set |
| Access `/accounts` after login | Shows accounts page (not login) |
| Refresh page after login | Still authenticated |
| Access `/settings` without login | Redirects to `/login` |
| Logout via UI | Cookie deleted, redirects to login |
| Change `JOURNAL_PASSWORD` in Vercel | Existing sessions invalidated |
| Access `/api/trades` without auth | Returns data (public GET) |
| Access `/api/accounts` without auth | Returns 401 |

---

## 🚀 Deployment Steps

```bash
# 1. Make changes
git add .
git commit -m "fix: Vercel authentication cookie handling"

# 2. Push to trigger Vercel deploy
git push origin main

# 3. In Vercel Dashboard:
#    - Add JOURNAL_PASSWORD to Environment Variables (Production, Preview, Development)
#    - Add MT_WEBHOOK_SECRET
#    - Optional: Add COOKIE_DOMAIN for custom domains

# 4. Wait for deploy, then test
```

---

## 🔄 Rollback Plan

If issues persist:
1. Revert `middleware.ts` and `auth.ts` to previous version
2. Redeploy
3. Investigate with Vercel Function Logs

---

## 📝 Notes for AI Agent

1. **Read files first** - Always read the current file before modifying
2. **Test locally first** - Use `vercel dev` before deploying
3. **Check Vercel Function Logs** - For debugging middleware/API issues
4. **Cookie debugging** - Use `console.log` in API routes, check Vercel logs
5. **Vercel Edge vs Node.js** - Middleware runs on Edge, API routes on Node.js
6. **Environment variables** - Must be set in Vercel Dashboard, not just `.env`

---

*Generated for Trade Journal Vercel Authentication Fix*
*Last Updated: 2025*