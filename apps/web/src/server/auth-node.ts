import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Server-side only crypto utilities.
 * This file should only be imported in server-side code (API routes, server actions).
 * Do not import in components or edge runtime code.
 */

/**
 * Creates an HMAC-SHA256 signature using Node.js crypto (server-side only).
 */
export const createHmacSha256 = (key: string, data: string): string => {
  return createHmac("sha256", key).update(data).digest("hex");
};

/**
 * Timing-safe comparison using Node.js crypto (server-side only).
 */
export const timingSafeEqualBuffers = (a: Buffer, b: Buffer): boolean => {
  return timingSafeEqual(a, b);
};

/**
 * Creates session token using Node.js crypto (server-side only).
 */
export const createSessionToken = (): string => {
  const password = process.env.JOURNAL_PASSWORD ?? "";
  return createHmac("sha256", password).update("session-v1").digest("hex");
};

/**
 * Timing-safe password verification using Node.js crypto (server-side only).
 */
export const verifyPasswordNode = (candidate: string): boolean => {
  const expected = Buffer.from(process.env.JOURNAL_PASSWORD ?? "", "utf8");
  const given = Buffer.from(candidate, "utf8");
  return expected.length === given.length && timingSafeEqual(expected, given);
};

/**
 * Verifies session token using Node.js crypto (server-side only).
 */
export const verifySessionNode = (token: string | undefined): boolean => {
  if (!process.env.JOURNAL_PASSWORD) return true;
  if (!token) return false;
  const expected = Buffer.from(createHmac("sha256", process.env.JOURNAL_PASSWORD ?? "").update("session-v1").digest("hex"), "utf8");
  const given = Buffer.from(token, "utf8");
  return expected.length === given.length && timingSafeEqual(expected, given);
};

export const passwordConfigured = (): boolean => Boolean(process.env.JOURNAL_PASSWORD);
