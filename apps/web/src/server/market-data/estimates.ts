import { createHash } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import type { AnnotatedTrade } from "@luxalgo/journal-core";
import { accounts, db, tradeExcursions, marketCsvDatasets, executions } from "@/db";
import type { ExcursionEstimate, TradeMarketResult } from "@/lib/market-data";
import { listExecutions } from "@/server/executions";

type FingerprintContext = {
  currencies: Map<string, string>;
  fills: Map<string, typeof executions.$inferSelect>;
};

const chunks = <T>(items: T[], size = 400): T[][] => {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
};

/** Invalidate derived values when fills, reconstruction, currency or multiplier change. */
export async function estimateFingerprint(trade: AnnotatedTrade, context?: FingerprintContext): Promise<string> {
  let currency: string | undefined;
  if (context) {
    currency = context.currencies.get(trade.accountId);
  } else {
    const acc = await db
      .select({ currency: accounts.currency })
      .from(accounts)
      .where(eq(accounts.id, trade.accountId))
      .get();
    currency = acc?.currency;
  }

  let rawFills: { id: string; side: string; quantity: number; price: number; executedAt: string }[] = [];
  if (trade.executionIds.length) {
    if (context) {
      rawFills = [...new Set(trade.executionIds)].flatMap((id) => {
        const fill = context.fills.get(id);
        return fill?.accountId === trade.accountId ? [fill] : [];
      });
    } else {
      rawFills = await listExecutions(trade.accountId, trade.executionIds);
    }
  }

  const fills = rawFills
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(({ id, side, quantity, price, executedAt }) => ({
      id,
      side,
      quantity,
      price,
      executedAt,
    }));

  return createHash("sha256")
    .update(
      JSON.stringify({
        version: 1,
        accountId: trade.accountId,
        symbol: trade.symbol,
        direction: trade.direction,
        openedAt: trade.openedAt,
        closedAt: trade.closedAt,
        assetClass: trade.assetClass,
        multiplier: trade.contractMultiplier ?? null,
        currency,
        fills,
      }),
    )
    .digest("hex");
}

export async function saveEstimate(
  trade: AnnotatedTrade,
  history: TradeMarketResult,
  fingerprint: string,
): Promise<void> {
  // A chart-only load must not erase a previously confirmed estimate.
  if (history.estimate.mae === null || history.estimate.mfe === null) return;
  if ((await estimateFingerprint(trade)) !== fingerprint) return;
  if (
    history.datasetId &&
    !(await db
      .select({ id: marketCsvDatasets.id })
      .from(marketCsvDatasets)
      .where(eq(marketCsvDatasets.id, history.datasetId))
      .get())
  )
    return;
  const values = {
    tradeKey: trade.key,
    fingerprint,
    provider: history.provider,
    symbol: history.symbol,
    resolution: history.resolution,
    fetchedAt: history.fetchedAt,
    estimateJson: JSON.stringify({ ...history.estimate, datasetId: history.datasetId }),
  };
  await db.insert(tradeExcursions)
    .values(values)
    .onConflictDoUpdate({ target: tradeExcursions.tradeKey, set: values })
    .run();
}

export async function savedEstimates(trades: AnnotatedTrade[]) {
  const storedRows: (typeof tradeExcursions.$inferSelect)[] = [];
  for (const keys of chunks(trades.map((trade) => trade.key))) {
    const batch = await db.select().from(tradeExcursions).where(inArray(tradeExcursions.tradeKey, keys)).all();
    storedRows.push(...batch);
  }
  const stored = new Map(storedRows.map((row) => [row.tradeKey, row]));

  const relevant = trades.filter((trade) => stored.has(trade.key));
  const accountIds = [...new Set(relevant.map((trade) => trade.accountId))];
  const executionIds = [...new Set(relevant.flatMap((trade) => trade.executionIds))];

  const currencyRows: { id: string; currency: string }[] = [];
  for (const ids of chunks(accountIds)) {
    const batch = await db
      .select({ id: accounts.id, currency: accounts.currency })
      .from(accounts)
      .where(inArray(accounts.id, ids))
      .all();
    currencyRows.push(...batch);
  }

  const fillRows: (typeof executions.$inferSelect)[] = [];
  for (const ids of chunks(executionIds)) {
    const batch = await db.select().from(executions).where(inArray(executions.id, ids)).all();
    fillRows.push(...batch);
  }

  const context: FingerprintContext = {
    currencies: new Map(currencyRows.map((row) => [row.id, row.currency])),
    fills: new Map(fillRows.map((row) => [row.id, row])),
  };

  const datasetIds = new Set(
    (await db
      .select({ id: marketCsvDatasets.id })
      .from(marketCsvDatasets)
      .all())
      .map((row) => row.id),
  );

  const results: [string, { estimate: ExcursionEstimate & { datasetId?: string }; provider: string; symbol: string; resolution: string; fetchedAt: string }][] = [];

  for (const trade of trades) {
    const row = stored.get(trade.key);
    if (!row) continue;
    const fp = await estimateFingerprint(trade, context);
    if (row.fingerprint !== fp) continue;
    const estimate = JSON.parse(row.estimateJson) as ExcursionEstimate & { datasetId?: string };
    if (estimate.datasetId && !datasetIds.has(estimate.datasetId)) continue;
    if (
      estimate.mae === null ||
      estimate.mfe === null ||
      !Number.isFinite(estimate.mae) ||
      !Number.isFinite(estimate.mfe)
    )
      continue;
    results.push([
      trade.key,
      {
        estimate,
        provider: row.provider,
        symbol: row.symbol,
        resolution: row.resolution,
        fetchedAt: row.fetchedAt,
      },
    ]);
  }

  return new Map(results);
}
