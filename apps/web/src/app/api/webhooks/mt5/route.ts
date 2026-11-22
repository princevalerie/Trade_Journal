import { and, eq } from "drizzle-orm";
import type { ImportedExecution } from "@luxalgo/journal-importers";
import { accounts, attachments, db, tradeExcursions, trades } from "@/db";
import { bad, handler, ok } from "@/server/api";
import { insertExecutions } from "@/server/executions";
import { newId, nowIso } from "@/server/ids";
import { estimateFingerprint } from "@/server/market-data/estimates";
import { rowToTrade } from "@/server/trades-query";

export interface Mt5OpenPosition {
  ticket: number | string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  openPrice: number;
  currentPrice: number;
  profit: number;
  stopLoss?: number;
  takeProfit?: number;
  openedAt?: string;
  comment?: string;
}

export interface Mt5CashFlow {
  type: "deposit" | "withdrawal" | "credit";
  amount: number;
  time: string;
  comment?: string;
}

export interface Mt5AccountPayload {
  login: number | string;
  name?: string;
  broker?: string;
  currency?: string;
  balance?: number;
  equity?: number;
  floatingProfit?: number;
  initialBalance?: number;
  tradeMode?: "real" | "demo" | "contest";
  leverage?: number;
  positions?: Mt5OpenPosition[];
  cashFlows?: Mt5CashFlow[];
}

export interface Mt5ExecutionPayload {
  ticket?: number | string;
  orderId?: number | string;
  positionId?: number | string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  price: number;
  fee?: number;
  profit?: number;
  commission?: number;
  swap?: number;
  executedAt: string;
  assetClass?: "forex" | "cfd" | "crypto" | "equity" | "option" | "futures" | "other";
  comment?: string;
  magic?: number;
  stopLoss?: number;
  takeProfit?: number;
  reason?: string; // TP, SL, CLIENT, EXPERT, SO
  orderType?: string; // BUY, SELL, BUY_LIMIT, etc.
  slippagePips?: number;
  mae?: number;
  mfe?: number;
  sampledBars?: number;
  screenshotBase64?: string;
  importMetadata?: {
    id: string;
    group?: string;
    order?: number;
    reportedGrossPnl?: number;
    preserveFee?: boolean;
  };
}

export interface Mt5WebhookBody {
  apiKey?: string;
  account: Mt5AccountPayload;
  executions?: Mt5ExecutionPayload[];
}

const mapReasonToTag = (reason?: string): string | null => {
  if (!reason) return null;
  const upper = reason.toUpperCase();
  if (upper.includes("TP")) return "Hit TP";
  if (upper.includes("SL")) return "Hit SL";
  if (upper.includes("CLIENT")) return "Manual Exit";
  if (upper.includes("EXPERT")) return "EA Exit";
  if (upper.includes("SO") || upper.includes("STOP_OUT")) return "Stop Out";
  return null;
};

const mapOrderTypeToTag = (orderType?: string): string | null => {
  if (!orderType) return null;
  const upper = orderType.toUpperCase();
  if (upper.includes("LIMIT")) return "Limit Order";
  if (upper.includes("STOP")) return "Stop Order";
  return "Market Order";
};

export const POST = handler(
  async (request: Request) => {
  const configuredSecret = process.env.MT_WEBHOOK_SECRET;
  const headerKey = request.headers.get("x-api-key");
  const body = (await request.json()) as Mt5WebhookBody;

  // Validate API key if configured in environment
  if (configuredSecret) {
    const providedKey = headerKey || body.apiKey;
    if (providedKey !== configuredSecret) {
      return bad("Unauthorized: Invalid API key", 401);
    }
  }

  if (!body.account || !body.account.login) {
    return bad("account.login is required");
  }

  const accountId = `mt5_${body.account.login}`;
  const now = nowIso();

  // Process Cash Flows (Deposits / Withdrawals)
  const cashFlows = body.account.cashFlows ?? [];
  let totalDeposits = 0;
  let totalWithdrawals = 0;
  for (const cf of cashFlows) {
    if (cf.amount > 0) totalDeposits += cf.amount;
    else totalWithdrawals += Math.abs(cf.amount);
  }

  const tradeModeLabel = body.account.tradeMode
    ? body.account.tradeMode.toUpperCase()
    : "REAL";
  const leverageText = body.account.leverage ? ` 1:${body.account.leverage}` : "";

  const currentSnapshot = {
    equity: body.account.equity ?? body.account.balance ?? 0,
    balance: body.account.balance ?? 0,
    floatingProfit: body.account.floatingProfit ?? 0,
    tradeMode: body.account.tradeMode ?? "real",
    leverage: body.account.leverage ?? 100,
    positions: body.account.positions ?? [],
    cashFlowSummary: {
      totalDeposits,
      totalWithdrawals,
      netCashFlow: totalDeposits - totalWithdrawals,
      cashFlowCount: cashFlows.length,
    },
    fetchedAt: now,
  };

  const initialDeposit =
    body.account.initialBalance && body.account.initialBalance > 0
      ? body.account.initialBalance
      : totalDeposits > 0
        ? totalDeposits
        : (body.account.balance ?? 0);

  // Find or auto-register account
  const existingAccount = await db
    .select()
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .get();

  if (!existingAccount) {
    const accountName =
      body.account.name?.trim() ||
      `[${tradeModeLabel}${leverageText}] ${body.account.broker ? body.account.broker + " " : ""}MT5 #${body.account.login}`;

    await db.insert(accounts)
      .values({
        id: accountId,
        name: accountName,
        broker: body.account.broker || "MetaTrader 5",
        kind: "sync",
        currency: body.account.currency || "USD",
        initialBalance: initialDeposit,
        profitCalcMethod: "fifo",
        autoSync: true,
        snapshotJson: JSON.stringify(currentSnapshot),
        lastSyncAt: now,
        createdAt: now,
      })
      .run();
  } else {
    // Update existing account snapshot
    const updateData: Record<string, unknown> = {
      lastSyncAt: now,
      snapshotJson: JSON.stringify(currentSnapshot),
    };

    if (body.account.name && body.account.name.trim() && body.account.name !== existingAccount.name) {
      updateData.name = body.account.name.trim();
    }

    if (
      existingAccount.initialBalance === 0 &&
      body.account.initialBalance &&
      body.account.initialBalance > 0
    ) {
      updateData.initialBalance = body.account.initialBalance;
    }

    await db.update(accounts)
      .set(updateData)
      .where(eq(accounts.id, accountId))
      .run();
  }

  // Insert executions if any
  let insertResult = null;
  if (Array.isArray(body.executions) && body.executions.length > 0) {
    const validRows: ImportedExecution[] = body.executions.map((row) => {
      const dealId = String(row.ticket ?? row.importMetadata?.id ?? newId());
      const positionGroupId = row.positionId
        ? `pos_${row.positionId}`
        : row.importMetadata?.group;

      const commFee =
        row.commission !== undefined
          ? Math.abs(Number(row.commission) || 0)
          : Math.abs(Number(row.fee) || 0);

      const reportedProfit =
        row.profit !== undefined
          ? Number(row.profit)
          : row.importMetadata?.reportedGrossPnl;

      return {
        symbol: (row.symbol || "").trim().toUpperCase(),
        side: row.side === "buy" ? "buy" : "sell",
        quantity: Math.abs(Number(row.quantity) || 0),
        price: Number(row.price) || 0,
        fee: commFee,
        executedAt: row.executedAt,
        assetClass: row.assetClass || "forex",
        source: "sync",
        importMetadata: {
          id: dealId,
          group: positionGroupId,
          order: row.importMetadata?.order ?? 0,
          reportedGrossPnl: reportedProfit,
          preserveFee: true,
        },
      };
    });

    insertResult = await insertExecutions(accountId, validRows, "sync");

    // Post-processing: Enrich materialized trades with SL, TP, Tags, Notes, Slippage, MAE/MFE & Screenshots
    const positionDataMap = new Map<string, {
      ticket?: number | string;
      stopLoss?: number;
      takeProfit?: number;
      tags: Set<string>;
      notes: string[];
      mae?: number;
      mfe?: number;
      sampledBars?: number;
      screenshotBase64?: string;
    }>();

    for (const exec of body.executions) {
      const groupKey = exec.positionId ? `pos_${exec.positionId}` : undefined;
      if (!groupKey) continue;

      let data = positionDataMap.get(groupKey);
      if (!data) {
        data = { tags: new Set(), notes: [] };
        positionDataMap.set(groupKey, data);
      }

      if (exec.ticket) data.ticket = exec.ticket;

      if (exec.stopLoss && exec.stopLoss > 0 && !data.stopLoss) {
        data.stopLoss = exec.stopLoss;
      }
      if (exec.takeProfit && exec.takeProfit > 0 && !data.takeProfit) {
        data.takeProfit = exec.takeProfit;
      }

      if (exec.mae !== undefined && data.mae === undefined) data.mae = exec.mae;
      if (exec.mfe !== undefined && data.mfe === undefined) data.mfe = exec.mfe;
      if (exec.sampledBars !== undefined) data.sampledBars = exec.sampledBars;
      if (exec.screenshotBase64 && !data.screenshotBase64) {
        data.screenshotBase64 = exec.screenshotBase64;
      }

      const reasonTag = mapReasonToTag(exec.reason);
      if (reasonTag) data.tags.add(reasonTag);

      const orderTypeTag = mapOrderTypeToTag(exec.orderType);
      if (orderTypeTag) data.tags.add(orderTypeTag);

      let execEaName: string | null = null;
      if (exec.comment && exec.comment.trim()) {
        const stripped = exec.comment.replace(/\[.*?\]/g, "").trim();
        if (stripped.length > 0 && !stripped.toLowerCase().startsWith("from ") && !stripped.toLowerCase().startsWith("to ")) {
          execEaName = stripped;
        }
      }

      if (execEaName) {
        data.tags.add("EA");
        data.tags.add(execEaName);
      }

      if (exec.magic !== undefined && exec.magic !== 0) {
        data.tags.add("EA");
        data.tags.add(`Magic:${exec.magic}`);
      } else if (!execEaName) {
        data.tags.add("Manual");
      }

      if (exec.slippagePips && Math.abs(exec.slippagePips) >= 0.1) {
        data.notes.push(
          `Slippage: ${exec.slippagePips > 0 ? "+" : ""}${exec.slippagePips.toFixed(1)} pips`
        );
      }

      if (exec.commission !== undefined || (exec.swap !== undefined && Number(exec.swap) !== 0)) {
        const commStr =
          exec.commission !== undefined && Number(exec.commission) !== 0
            ? `Comm: $${Number(exec.commission).toFixed(2)}`
            : "";
        const swapStr =
          exec.swap !== undefined && Number(exec.swap) !== 0
            ? `Swap: ${Number(exec.swap) > 0 ? "+" : ""}$${Number(exec.swap).toFixed(2)}`
            : "";
        const parts = [commStr, swapStr].filter(Boolean).join(" | ");
        if (parts) data.notes.push(parts);
      }

      if (exec.comment && exec.comment.trim()) {
        data.notes.push(`MT5: ${exec.comment.trim()}`);
      }
    }

    // Apply updates to trades, excursions, and attachments in DB
    if (positionDataMap.size > 0) {
      const existingTrades = await db
        .select()
        .from(trades)
        .where(eq(trades.accountId, accountId))
        .all();

      await db.transaction(async (tx) => {
        for (const trade of existingTrades) {
          for (const [groupKey, rich] of positionDataMap.entries()) {
            if (trade.key.includes(groupKey)) {
              const updates: Record<string, unknown> = {};

              if (rich.stopLoss && (trade.stopLoss === null || trade.stopLoss === undefined)) {
                updates.stopLoss = rich.stopLoss;
              }
              if (rich.takeProfit && (trade.profitTarget === null || trade.profitTarget === undefined)) {
                updates.profitTarget = rich.takeProfit;
              }

              // Merge tags
              let currentTags: string[] = [];
              try {
                if (trade.tagsJson) currentTags = JSON.parse(trade.tagsJson) as string[];
              } catch {
                currentTags = [];
              }
              if (rich.tags.has("EA")) {
                currentTags = currentTags.filter((t) => t.toLowerCase() !== "manual");
              }
              const mergedTags = Array.from(new Set([...currentTags, ...rich.tags]));
              if (mergedTags.length !== currentTags.length) {
                updates.tagsJson = JSON.stringify(mergedTags);
              }

              // Merge notes
              if (rich.notes.length > 0) {
                const noteBlock = rich.notes.join("\n");
                if (!trade.notes || !trade.notes.includes(noteBlock)) {
                  updates.notes = trade.notes ? `${trade.notes}\n\n${noteBlock}` : noteBlock;
                }
              }

              if (Object.keys(updates).length > 0) {
                await tx.update(trades).set(updates).where(eq(trades.key, trade.key)).run();
              }

              // Poin 1: Save MAE / MFE into tradeExcursions table
              if (rich.mae !== undefined && rich.mfe !== undefined) {
                const estimateJson = JSON.stringify({
                  mae: rich.mae,
                  mfe: rich.mfe,
                  sampledBars: rich.sampledBars ?? 0,
                  excludedBars: 0,
                  warnings: [],
                });

                const fp = await estimateFingerprint(rowToTrade(trade));
                await tx.insert(tradeExcursions)
                  .values({
                    tradeKey: trade.key,
                    fingerprint: fp,
                    provider: "mt5",
                    symbol: trade.symbol,
                    resolution: "1m",
                    fetchedAt: now,
                    estimateJson,
                  })
                  .onConflictDoUpdate({
                    target: tradeExcursions.tradeKey,
                    set: {
                      fingerprint: fp,
                      estimateJson,
                      fetchedAt: now,
                    },
                  })
                  .run();
              }

              // Poin 5: Save Chart Screenshot into attachments table
              if (rich.screenshotBase64) {
                try {
                  const imgBuffer = Buffer.from(rich.screenshotBase64, "base64");
                  if (imgBuffer.length > 0 && imgBuffer.length <= 8 * 1024 * 1024) {
                    await tx.insert(attachments)
                      .values({
                        id: newId(),
                        ownerType: "trade",
                        ownerId: trade.key,
                        name: `MT5_Chart_${rich.ticket || trade.symbol}.png`,
                        mime: "image/png",
                        size: imgBuffer.length,
                        data: imgBuffer,
                        createdAt: now,
                      })
                      .run();
                  }
                } catch (err) {
                  console.error("Failed to save MT5 chart screenshot:", err);
                }
              }
            }
          }
        }
      });
    }
  }

  return ok({
    success: true,
    accountId,
    result: insertResult,
    syncedAt: now,
  });
}, { public: true });
