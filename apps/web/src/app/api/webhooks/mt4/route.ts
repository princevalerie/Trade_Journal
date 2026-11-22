import { and, eq } from "drizzle-orm";
import type { ImportedExecution } from "@luxalgo/journal-importers";
import { accounts, attachments, db, tradeExcursions, trades } from "@/db";
import { bad, handler, ok } from "@/server/api";
import { insertExecutions } from "@/server/executions";
import { newId, nowIso } from "@/server/ids";
import { estimateFingerprint } from "@/server/market-data/estimates";
import { rowToTrade } from "@/server/trades-query";

export interface Mt4OpenPosition {
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
  magic?: number;
}

export interface Mt4CashFlow {
  type: "deposit" | "withdrawal" | "credit";
  amount: number;
  time: string;
  comment?: string;
}

export interface Mt4AccountPayload {
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
  positions?: Mt4OpenPosition[];
  cashFlows?: Mt4CashFlow[];
}

export interface Mt4TradePayload {
  ticket: number | string;
  symbol: string;
  type: "buy" | "sell";
  lots: number;
  openPrice: number;
  closePrice: number;
  openTime: string;
  closeTime: string;
  stopLoss?: number;
  takeProfit?: number;
  commission?: number;
  swap?: number;
  profit: number;
  comment?: string;
  magic?: number;
  reason?: string; // TP, SL, CLIENT, EXPERT, SO
  orderType?: string;
  mae?: number;
  mfe?: number;
  sampledBars?: number;
  screenshotBase64?: string;
}

export interface Mt4WebhookBody {
  apiKey?: string;
  account: Mt4AccountPayload;
  trades?: Mt4TradePayload[];
  executions?: {
    symbol: string;
    side: "buy" | "sell";
    quantity: number;
    price: number;
    fee?: number;
    executedAt: string;
    ticket?: number | string;
    positionId?: number | string;
    profit?: number;
    stopLoss?: number;
    takeProfit?: number;
    reason?: string;
    magic?: number;
    comment?: string;
    mae?: number;
    mfe?: number;
    sampledBars?: number;
    screenshotBase64?: string;
  }[];
}

const detectAssetClass = (sym: string): "crypto" | "cfd" | "forex" => {
  const upper = sym.toUpperCase();
  if (
    upper.includes("BTC") ||
    upper.includes("ETH") ||
    upper.includes("SOL") ||
    upper.includes("CRYPTO")
  ) {
    return "crypto";
  }
  if (
    upper.includes("US500") ||
    upper.includes("US30") ||
    upper.includes("NAS") ||
    upper.includes("GER") ||
    upper.includes("XAU") ||
    upper.includes("GOLD") ||
    upper.includes("OIL")
  ) {
    return "cfd";
  }
  return "forex";
};

const mapReasonToTag = (reason?: string, comment?: string): string | null => {
  const r = (reason || "").toUpperCase();
  const c = (comment || "").toLowerCase();

  if (r.includes("TP") || c.includes("[tp]")) return "Hit TP";
  if (r.includes("SL") || c.includes("[sl]")) return "Hit SL";
  if (r.includes("SO") || c.includes("[so]")) return "Stop Out";
  if (r.includes("CLIENT")) return "Manual Exit";
  if (r.includes("EXPERT")) return "EA Exit";
  return null;
};

export const POST = handler(
  async (request: Request) => {
  const configuredSecret = process.env.MT_WEBHOOK_SECRET;
  const headerKey = request.headers.get("x-api-key");
  const body = (await request.json()) as Mt4WebhookBody;

  console.log(`📥 [MT4 Webhook] Received from #${body?.account?.login}: trades=${body?.trades?.length ?? 0}, executions=${body?.executions?.length ?? 0}`);
  if (body.trades && body.trades.length > 0) {
    console.log("📥 [MT4 Webhook Sample Trade]:", JSON.stringify(body.trades[0]));
  }

  // Validate API key
  if (configuredSecret) {
    const providedKey = headerKey || body.apiKey;
    if (providedKey !== configuredSecret) {
      return bad("Unauthorized: Invalid API key", 401);
    }
  }

  if (!body.account || !body.account.login) {
    return bad("account.login is required");
  }

  const accountId = `mt4_${body.account.login}`;
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
      `[${tradeModeLabel}${leverageText}] ${body.account.broker ? body.account.broker + " " : ""}MT4 #${body.account.login}`;

    await db.insert(accounts)
      .values({
        id: accountId,
        name: accountName,
        broker: body.account.broker || "MetaTrader 4",
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

  // Decompose MT4 Trades into Execution pairs (Leg 1 Entry & Leg 2 Exit)
  const validRows: ImportedExecution[] = [];
  const positionDataMap = new Map<string, {
    ticket: number | string;
    stopLoss?: number;
    takeProfit?: number;
    tags: Set<string>;
    notes: string[];
    mae?: number;
    mfe?: number;
    sampledBars?: number;
    screenshotBase64?: string;
  }>();

  // If trades array provided (standard MT4 order format)
  if (Array.isArray(body.trades) && body.trades.length > 0) {
    for (const trade of body.trades) {
      const posGroupId = `pos_${trade.ticket}`;
      const assetClass = detectAssetClass(trade.symbol);
      const commFee = Math.abs(Number(trade.commission) || 0);
      const swapAmount = Number(trade.swap) || 0;
      const reportedProfit = (Number(trade.profit) || 0) + swapAmount;

      // Leg 1: Entry fill
      validRows.push({
        symbol: trade.symbol.trim().toUpperCase(),
        side: trade.type === "buy" ? "buy" : "sell",
        quantity: Math.abs(Number(trade.lots) || 0),
        price: Number(trade.openPrice) || 0,
        fee: 0,
        executedAt: trade.openTime,
        assetClass,
        importMetadata: {
          id: `${trade.ticket}_in`,
          group: posGroupId,
          order: 0,
          preserveFee: true,
        },
      });

      // Leg 2: Exit fill
      validRows.push({
        symbol: trade.symbol.trim().toUpperCase(),
        side: trade.type === "buy" ? "sell" : "buy",
        quantity: Math.abs(Number(trade.lots) || 0),
        price: Number(trade.closePrice) || 0,
        fee: commFee,
        executedAt: trade.closeTime,
        assetClass,
        importMetadata: {
          id: `${trade.ticket}_out`,
          group: posGroupId,
          order: 1,
          reportedGrossPnl: reportedProfit,
          preserveFee: true,
        },
      });

      // Prepare rich annotations
      const tags = new Set<string>();
      const reasonTag = mapReasonToTag(trade.reason, trade.comment);
      if (reasonTag) tags.add(reasonTag);

      // Extract EA identity from comment (e.g. 'SuperScalperV1[sl]' -> 'SuperScalperV1')
      let eaName: string | null = null;
      if (trade.comment && trade.comment.trim()) {
        const stripped = trade.comment.replace(/\[.*?\]/g, "").trim();
        const isIpOrNumeric = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(stripped) || /^\d+$/.test(stripped);
        if (
          stripped.length > 0 &&
          !isIpOrNumeric &&
          !stripped.toLowerCase().startsWith("from ") &&
          !stripped.toLowerCase().startsWith("to ") &&
          !stripped.toLowerCase().startsWith("deposit") &&
          !stripped.toLowerCase().startsWith("withdrawal")
        ) {
          eaName = stripped;
        }
      }

      if (eaName) {
        tags.add("EA");
        tags.add(eaName);
      }

      if (trade.magic !== undefined && trade.magic !== 0) {
        tags.add("EA");
        tags.add(`Magic:${trade.magic}`);
      } else if (!eaName) {
        tags.add("Manual");
      }

      console.log(`🔍 [MT4 Trade #${trade.ticket}] Comment: "${trade.comment || ''}" | Magic: ${trade.magic} | Tags: ${Array.from(tags).join(', ')}`);

      const notes: string[] = [];
      if (trade.commission || (trade.swap && Number(trade.swap) !== 0)) {
        const commStr =
          trade.commission !== undefined && Number(trade.commission) !== 0
            ? `Comm: $${Number(trade.commission).toFixed(2)}`
            : "";
        const swapStr =
          trade.swap !== undefined && Number(trade.swap) !== 0
            ? `Swap: ${Number(trade.swap) > 0 ? "+" : ""}$${Number(trade.swap).toFixed(2)}`
            : "";
        const parts = [commStr, swapStr].filter(Boolean).join(" | ");
        if (parts) notes.push(parts);
      }
      if (trade.comment && trade.comment.trim()) {
        notes.push(`MT4: ${trade.comment.trim()}`);
      }

      positionDataMap.set(posGroupId, {
        ticket: trade.ticket,
        stopLoss: trade.stopLoss && trade.stopLoss > 0 ? trade.stopLoss : undefined,
        takeProfit: trade.takeProfit && trade.takeProfit > 0 ? trade.takeProfit : undefined,
        tags,
        notes,
        mae: trade.mae,
        mfe: trade.mfe,
        sampledBars: trade.sampledBars,
        screenshotBase64: trade.screenshotBase64,
      });
    }
  }

  // If raw executions array provided
  if (Array.isArray(body.executions) && body.executions.length > 0) {
    for (const exec of body.executions) {
      const posGroupId = exec.positionId ? `pos_${exec.positionId}` : undefined;
      const dealId = String(exec.ticket ?? newId());

      validRows.push({
        symbol: (exec.symbol || "").trim().toUpperCase(),
        side: exec.side === "buy" ? "buy" : "sell",
        quantity: Math.abs(Number(exec.quantity) || 0),
        price: Number(exec.price) || 0,
        fee: Math.abs(Number(exec.fee) || 0),
        executedAt: exec.executedAt,
        assetClass: detectAssetClass(exec.symbol),
        importMetadata: {
          id: dealId,
          group: posGroupId,
          order: 0,
          reportedGrossPnl: exec.profit,
          preserveFee: true,
        },
      });

      if (posGroupId) {
        let data = positionDataMap.get(posGroupId);
        if (!data) {
          data = { ticket: exec.ticket ?? "", tags: new Set(), notes: [] };
          positionDataMap.set(posGroupId, data);
        }
        if (exec.stopLoss && exec.stopLoss > 0) data.stopLoss = exec.stopLoss;
        if (exec.takeProfit && exec.takeProfit > 0) data.takeProfit = exec.takeProfit;
        if (exec.mae !== undefined) data.mae = exec.mae;
        if (exec.mfe !== undefined) data.mfe = exec.mfe;
        if (exec.sampledBars !== undefined) data.sampledBars = exec.sampledBars;
        if (exec.screenshotBase64) data.screenshotBase64 = exec.screenshotBase64;

        const reasonTag = mapReasonToTag(exec.reason, exec.comment);
        if (reasonTag) data.tags.add(reasonTag);

        let execEaName: string | null = null;
        if (exec.comment && exec.comment.trim()) {
          const stripped = exec.comment.replace(/\[.*?\]/g, "").trim();
          const isIpOrNumeric = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(stripped) || /^\d+$/.test(stripped);
          if (
            stripped.length > 0 &&
            !isIpOrNumeric &&
            !stripped.toLowerCase().startsWith("from ") &&
            !stripped.toLowerCase().startsWith("to ")
          ) {
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

        if (exec.comment && exec.comment.trim()) {
          data.notes.push(`MT4: ${exec.comment.trim()}`);
        }
      }
    }
  }

  // Insert executions and rebuild
  let insertResult = null;
  if (validRows.length > 0) {
    insertResult = await insertExecutions(accountId, validRows, "sync");

    // Post-processing: Enrich materialized trades with SL, TP, Tags, Notes, MAE/MFE & Screenshots
    if (positionDataMap.size > 0) {
      const existingTrades = await db
        .select()
        .from(trades)
        .where(eq(trades.accountId, accountId))
        .all();

      await db.transaction(async (tx) => {
        for (const trade of existingTrades) {
          for (const [groupKey, rich] of positionDataMap.entries()) {
            const matchesGroup = trade.key.includes(groupKey);
            const matchesTicket =
              rich.ticket !== undefined &&
              trade.executionIdsJson !== null &&
              trade.executionIdsJson.includes(String(rich.ticket));

            if (matchesGroup || matchesTicket) {
              const updates: Record<string, unknown> = {};

              // Selalu perbarui/overwrite Stop Loss jika ada nilai valid (> 0)
              if (rich.stopLoss !== undefined && rich.stopLoss > 0) {
                updates.stopLoss = rich.stopLoss;
              }

              // Selalu perbarui/overwrite Take Profit jika ada nilai valid (> 0)
              if (rich.takeProfit !== undefined && rich.takeProfit > 0) {
                updates.profitTarget = rich.takeProfit;
              }

              // Merge dan perbarui tags
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
              if (
                mergedTags.length !== currentTags.length ||
                JSON.stringify(mergedTags) !== trade.tagsJson
              ) {
                updates.tagsJson = JSON.stringify(mergedTags);
              }

              // Selalu perbarui/overwrite komentar & catatan dari MT4, tanpa menghapus catatan manual user
              if (rich.notes.length > 0) {
                const newMetaLines = rich.notes;
                if (!trade.notes) {
                  updates.notes = newMetaLines.join("\n");
                } else {
                  const oldLines = trade.notes.split("\n");
                  const userManualLines = oldLines.filter((line) => {
                    const trimmed = line.trim();
                    return (
                      !trimmed.startsWith("MT5:") &&
                      !trimmed.startsWith("MT4:") &&
                      !trimmed.startsWith("Slippage:") &&
                      !trimmed.startsWith("Comm:") &&
                      !trimmed.startsWith("Swap:") &&
                      !trimmed.includes("Comm: $")
                    );
                  });
                  const cleanUserPart = userManualLines.join("\n").trim();
                  const combined = cleanUserPart
                    ? `${cleanUserPart}\n\n${newMetaLines.join("\n")}`
                    : newMetaLines.join("\n");
                  if (combined !== trade.notes) {
                    updates.notes = combined;
                  }
                }
              }

              if (Object.keys(updates).length > 0) {
                await tx.update(trades).set(updates).where(eq(trades.key, trade.key)).run();
              }

              // Save MAE & MFE into tradeExcursions
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
                    provider: "mt4",
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

              // Save Chart Screenshot into attachments
              if (rich.screenshotBase64) {
                try {
                  const imgBuffer = Buffer.from(rich.screenshotBase64, "base64");
                  if (imgBuffer.length > 0 && imgBuffer.length <= 8 * 1024 * 1024) {
                    await tx.insert(attachments)
                      .values({
                        id: newId(),
                        ownerType: "trade",
                        ownerId: trade.key,
                        name: `MT4_Chart_${rich.ticket || trade.symbol}.png`,
                        mime: "image/png",
                        size: imgBuffer.length,
                        data: imgBuffer,
                        createdAt: now,
                      })
                      .run();
                  }
                } catch (err) {
                  console.error("Failed to save MT4 chart screenshot:", err);
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
