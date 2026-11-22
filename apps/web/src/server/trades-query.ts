import { and, asc, eq, inArray } from "drizzle-orm";
import { matchesFilters, type AnalysisFilters, type AnnotatedTrade } from "@luxalgo/journal-core";
import { getTimeZone, getMultipliers, getJournalDefaults } from "./settings";
import { EMPTY_DEFAULTS, type JournalDefaults } from "@/lib/journal-defaults";
import { db, trades, accounts } from "@/db";

export type TradeFilters = AnalysisFilters & { accountIds?: string[] };

export type TradeRow = typeof trades.$inferSelect;

const parseJsonArray = (value: string | null): string[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
};

export const context = async () => ({
  multipliers: await getMultipliers(),
  defaults: await getJournalDefaults(),
});

export const rowToTrade = (
  row: TradeRow,
  config: { multipliers: Record<string, number>; defaults: JournalDefaults } = {
    multipliers: {},
    defaults: EMPTY_DEFAULTS,
  },
): AnnotatedTrade => {
  const multiplier = config.multipliers[row.symbol];
  const defaults = config.defaults;
  const missingMultiplier =
    multiplier == null && ["futures", "option", "forex", "cfd"].includes(row.assetClass ?? "");
  const notional = missingMultiplier
    ? 0
    : Math.abs(row.avgEntry * row.quantity * (multiplier ?? 1));
  const tolerance =
    defaults.breakevenMode === "percent"
      ? (notional * defaults.breakeven) / 100
      : defaults.breakeven;
  const status =
    row.status === "open"
      ? "open"
      : Math.abs(row.netPnl) <= Math.max(1e-9, tolerance)
        ? "breakeven"
        : row.netPnl > 0
          ? "win"
          : "loss";
  return {
    key: row.key,
    accountId: row.accountId,
    symbol: row.symbol,
    assetClass: (row.assetClass ?? undefined) as AnnotatedTrade["assetClass"],
    direction: row.direction,
    status,
    contractMultiplier: multiplier,
    openedAt: row.openedAt,
    closedAt: row.closedAt ?? undefined,
    quantity: row.quantity,
    openQuantity: row.openQuantity,
    avgEntry: row.avgEntry,
    avgExit: row.avgExit ?? undefined,
    grossPnl: row.grossPnl,
    fees: row.fees,
    netPnl: row.netPnl,
    executionCount: row.executionCount,
    executionIds: parseJsonArray(row.executionIdsJson),
    exits: JSON.parse(row.exitsJson) as AnnotatedTrade["exits"],
    durationMs: row.durationMs ?? undefined,
    annotations: {
      tags: parseJsonArray(row.tagsJson),
      mistakes: parseJsonArray(row.mistakesJson),
      playbook: row.playbookId ?? undefined,
      rating: row.rating ?? undefined,
      stopLoss: row.stopLoss ?? undefined,
      profitTarget: row.profitTarget ?? undefined,
      reviewed: row.reviewedAt !== null,
    },
  };
};

/**
 * Narrow indexed identity fields before decoding rows. The core predicate
 * remains authoritative for timezone, risk and breakeven semantics.
 */
export const queryTrades = async (
  filters: TradeFilters = {},
): Promise<{ rows: TradeRow[]; trades: AnnotatedTrade[] }> => {
  const effective = { ...filters, accounts: filters.accounts ?? filters.accountIds?.join(",") };
  const accountIds = effective.accounts
    ?.split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const all = await db
    .select()
    .from(trades)
    .where(
      and(
        accountIds?.length ? inArray(trades.accountId, accountIds) : undefined,
        effective.playbookId ? eq(trades.playbookId, effective.playbookId) : undefined,
        effective.direction
          ? eq(trades.direction, effective.direction as "long" | "short")
          : undefined,
        effective.assetClass ? eq(trades.assetClass, effective.assetClass) : undefined,
      ),
    )
    .orderBy(asc(trades.openedAt))
    .all();

  // For open trades, overlay latest floating P&L and current price from accounts snapshot
  const hasOpenTrades = all.some((r) => r.status === "open");
  if (hasOpenTrades) {
    const accRows = await db
      .select({ id: accounts.id, snapshotJson: accounts.snapshotJson })
      .from(accounts)
      .all();
    const posMap = new Map<string, { ticket?: number | string; symbol: string; side: string; profit: number; currentPrice?: number }[]>();
    for (const a of accRows) {
      if (!a.snapshotJson) continue;
      try {
        const snap = JSON.parse(a.snapshotJson);
        if (Array.isArray(snap.positions)) {
          posMap.set(a.id, snap.positions);
        }
      } catch {}
    }

    for (const row of all) {
      if (row.status === "open") {
        const positions = posMap.get(row.accountId);
        if (positions && positions.length > 0) {
          const match = positions.find((p) => {
            const ticketMatch = p.ticket && row.executionIdsJson && row.executionIdsJson.includes(String(p.ticket));
            const symbolMatch = p.symbol && row.symbol.toUpperCase() === p.symbol.toUpperCase();
            const sideMatch = (row.direction === "long" && p.side === "buy") || (row.direction === "short" && p.side === "sell");
            return ticketMatch || (symbolMatch && sideMatch);
          });
          if (match && typeof match.profit === "number") {
            row.grossPnl = match.profit;
            row.netPnl = match.profit - row.fees;
            if (typeof match.currentPrice === "number") {
              row.avgExit = match.currentPrice;
            }
          }
        }
      }
    }
  }

  const timeZone = await getTimeZone();
  const config = await context();
  const pairs = all
    .map((row) => ({ row, trade: rowToTrade(row, config) }))
    .filter(({ trade }) => matchesFilters(trade, effective, timeZone));
  return {
    rows: pairs.map(({ row, trade }) => ({ ...row, status: trade.status })),
    trades: pairs.map((p) => p.trade),
  };
};

export const getTradeByKey = async (key: string): Promise<TradeRow | undefined> =>
  await db.select().from(trades).where(eq(trades.key, key)).get();
