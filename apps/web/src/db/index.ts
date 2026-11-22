import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

export const dataDir = (): string => process.env.JOURNAL_DATA_DIR ?? "data";

const globalForDb = globalThis as unknown as { __journalDb?: ReturnType<typeof createDb> };

const createDb = () => {
  const url = process.env.TURSO_DATABASE_URL || "file:data/journal.db";
  const authToken = process.env.TURSO_AUTH_TOKEN;

  const client = createClient({
    url,
    authToken,
  });

  return drizzle(client, { schema });
};

/** Singleton across Next dev hot reloads. */
export const db = globalForDb.__journalDb ?? (globalForDb.__journalDb = createDb());

export * from "./schema";
