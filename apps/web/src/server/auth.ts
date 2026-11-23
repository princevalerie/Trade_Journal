/**
 * Single-user auth, optional by design: it'"'"'s your journal on your box. Set
 * JOURNAL_PASSWORD to require a login; the session cookie is an HMAC of the
 * password so rotating the password invalidates sessions.
 */
export const AUTH_COOKIE = "journal_session";

export const passwordConfigured = (): boolean => Boolean(process.env.JOURNAL_PASSWORD);

/**
 * Generates a session token using Web Crypto API (compatible with Edge runtime)
 */
export const sessionToken = async (): Promise<string> => {
  const password = process.env.JOURNAL_PASSWORD ?? "";
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("session-v1"));
  return Array.from(new Uint8Array(signature))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
};

/**
 * Verifies password using Web Crypto API (timing-safe comparison)
 */
export const verifyPassword = async (candidate: string): Promise<boolean> => {
  const expected = process.env.JOURNAL_PASSWORD ?? "";
  const expectedBuffer = new TextEncoder().encode(expected);
  const givenBuffer = new TextEncoder().encode(candidate);
  
  if (expectedBuffer.length !== givenBuffer.length) return false;
  
  // Timing-safe comparison
  let result = 0;
  for (let i = 0; i < expectedBuffer.length; i++) {
    result |= expectedBuffer[i]! ^ givenBuffer[i]!;
  }
  return result === 0;
};

/**
 * Verifies session token using Web Crypto API
 */
export const verifySession = async (token: string | undefined): Promise<boolean> => {
  if (!passwordConfigured()) return true;
  if (!token) return false;
  
  const expectedToken = await sessionToken();
  const expectedBuffer = new TextEncoder().encode(expectedToken);
  const givenBuffer = new TextEncoder().encode(token);
  
  if (expectedBuffer.length !== givenBuffer.length) return false;
  
  // Timing-safe comparison
  let result = 0;
  for (let i = 0; i < expectedBuffer.length; i++) {
    result |= expectedBuffer[i]! ^ givenBuffer[i]!;
  }
  return result === 0;
};

/**
 * Determines if the request is secure (HTTPS) - robust for Vercel deployments
 * where request.url might not reflect the actual protocol due to proxy/load balancer.
 */
export const isSecureRequest = (request: Request): boolean => {
  const url = new URL(request.url);
  
  // Direct protocol check
  if (url.protocol === "https:") return true;
  
  // Check Vercel proxy headers (x-forwarded-proto)
  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedProto === "https") return true;
  
  // Check Vercel-specific environment and hostname
  if (process.env.VERCEL === "1" && url.hostname.includes(".vercel.app")) return true;
  
  // Check for other common proxy headers
  const forwardedSsl = request.headers.get("x-forwarded-ssl");
  if (forwardedSsl === "on") return true;
  
  const forwardScheme = request.headers.get("x-forwarded-scheme");
  if (forwardScheme === "https") return true;
  
  return false;
};

/**
 * Gets the cookie domain for the current deployment.
 * Returns undefined for localhost, or the configured domain for production.
 */
export const getCookieDomain = (request: Request): string | undefined => {
  const url = new URL(request.url);
  const hostname = url.hostname;
  
  // Don'"'"'t set domain for localhost/127.0.0.1
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return undefined;
  }
  
  // Use explicit COOKIE_DOMAIN if configured
  if (process.env.COOKIE_DOMAIN) {
    return process.env.COOKIE_DOMAIN;
  }
  
  // vercel.app is on the Public Suffix List — browsers reject
  // domain=.vercel.app, so omit the attribute and let the browser
  // scope the cookie to the exact deployment hostname.
  if (process.env.VERCEL === "1" && hostname.endsWith(".vercel.app")) {
    return undefined;
  }
  
  // For custom domains, extract the root domain (e.g., example.com from app.example.com)
  // Only set if it's a proper domain (has at least one dot and not an IP)
  const parts = hostname.split(".");
  if (parts.length >= 2 && !/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    // Return root domain with leading dot for subdomain sharing
    return "." + parts.slice(-2).join(".");
  }
  
  return undefined;
};

/**
 * Sets the authentication cookie with proper configuration for the current deployment.
 */
export const setAuthCookie = async (request: Request, token: string): Promise<void> => {
  const { cookies } = await import("next/headers");
  const jar = await cookies();
  
  const isSecure = isSecureRequest(request);
  const cookieDomain = getCookieDomain(request);
  
  jar.set(AUTH_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isSecure,
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
    ...(cookieDomain && { domain: cookieDomain }),
  });
};

/**
 * Clears the authentication cookie.
 */
export const clearAuthCookie = async (request: Request): Promise<void> => {
  const { cookies } = await import("next/headers");
  const jar = await cookies();
  
  const cookieDomain = getCookieDomain(request);
  
  jar.set(AUTH_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: 0, // Expire immediately
    ...(cookieDomain && { domain: cookieDomain }),
  });
};
