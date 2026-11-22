import { createClient } from "@libsql/client";
import { handler, ok } from "@/server/api";

export const POST = handler(async () => {
  const url = process.env.TURSO_DATABASE_URL || "file:data/journal.db";
  const authToken = process.env.TURSO_AUTH_TOKEN;

  const client = createClient({
    url,
    authToken,
  });

  const statements = [
    "DELETE FROM trade_excursions",
    "DELETE FROM trade_rule_checks",
    "DELETE FROM trades",
    "DELETE FROM executions",
    "DELETE FROM attachments",
    "DELETE FROM notes",
    "DELETE FROM note_templates",
    "DELETE FROM journal_days",
    "DELETE FROM missed_trades",
    "DELETE FROM progress_checks",
    "DELETE FROM progress_rules",
    "DELETE FROM playbooks",
    "DELETE FROM market_csv_datasets",
    "DELETE FROM prop_receipts",
    "DELETE FROM prop_entries",
    "DELETE FROM prop_audit",
    "DELETE FROM prop_accounts",
    "DELETE FROM accounts",
    "DELETE FROM settings",
    "DELETE FROM folders",
    "INSERT OR IGNORE INTO folders (id, name, kind, created_at) VALUES ('all', 'All notes', 'system', '2026-01-01T00:00:00Z'), ('trade-notes', 'Trade notes', 'system', '2026-01-01T00:00:00Z'), ('daily-journal', 'Daily journal', 'system', '2026-01-01T00:00:00Z'), ('session-recaps', 'Session recaps', 'system', '2026-01-01T00:00:00Z'), ('my-notes', 'My notes', 'system', '2026-01-01T00:00:00Z')",
  ];

  await client.batch(statements, "write");

  return ok({ reset: true, message: "Database reset successfully." });
});
