import { cookies } from "next/headers";
import {
  AUTH_COOKIE,
  passwordConfigured,
  sessionToken,
  verifyPassword,
  verifySession,
} from "@/server/auth";
import { bad, handler, ok } from "@/server/api";

export const GET = handler(
  async () => {
    if (!passwordConfigured()) return ok({ authenticated: true, configured: false });
    const jar = await cookies();
    const token = jar.get(AUTH_COOKIE)?.value;
    const isValid = verifySession(token);
    return ok({ authenticated: isValid, configured: true });
  },
  { public: true },
);

export const POST = handler(
  async (request: Request) => {
    if (!passwordConfigured()) return ok({ authenticated: true });
    const { password } = (await request.json()) as { password?: string };
    if (typeof password !== "string" || !password || !verifyPassword(password))
      return bad("Wrong password", 401);
    const jar = await cookies();
    jar.set(AUTH_COOKIE, sessionToken(), {
      httpOnly: true,
      sameSite: "lax",
      secure: new URL(request.url).protocol === "https:",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return ok({ authenticated: true });
  },
  { public: true },
);

export const DELETE = handler(
  async () => {
    const jar = await cookies();
    jar.delete(AUTH_COOKIE);
    return ok({ authenticated: false });
  },
  { public: true },
);
