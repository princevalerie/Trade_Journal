import { cookies } from "next/headers";
import {
  AUTH_COOKIE,
  passwordConfigured,
  sessionToken,
  verifyPassword,
  verifySession,
  setAuthCookie,
  clearAuthCookie,
} from "@/server/auth";
import { verifyPasswordNode, verifySessionNode, createSessionToken } from "@/server/auth-node";
import { bad, handler, ok } from "@/server/api";

export const GET = handler(
  async (request: Request) => {
    if (!passwordConfigured()) return ok({ authenticated: true, configured: false });
    const jar = await cookies();
    const token = jar.get(AUTH_COOKIE)?.value;
    const isValid = await verifySession(token);
    return ok({ authenticated: isValid, configured: true });
  },
  { public: true },
);

export const POST = handler(
  async (request: Request) => {
    if (!passwordConfigured()) return ok({ authenticated: true });
    const { password } = (await request.json()) as { password?: string };
    if (typeof password !== "string" || !password || !verifyPasswordNode(password))
      return bad("Wrong password", 401);
    
    const token = createSessionToken();
    await setAuthCookie(request, token);
    return ok({ authenticated: true });
  },
  { public: true },
);

export const DELETE = handler(
  async (request: Request) => {
    await clearAuthCookie(request);
    return ok({ authenticated: false });
  },
  { public: true },
);
