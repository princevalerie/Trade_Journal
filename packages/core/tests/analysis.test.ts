import { describe, it, expect } from "vitest";
import {
  matchesFilters,
  analyzeGroups,
  tradeR,
  plannedR,
  tradeRisk,
  summarizeGroup,
  dimensionKeys,
} from "../src/analysis";
import { computeMetrics } from "../src/metrics";
import { buildRoundTrips } from "../src/round-trips";
import type { AnnotatedTrade } from "../src/types";
import { fill } from "./helpers";
const sample = (): AnnotatedTrade => ({
  ...buildRoundTrips(
    [
      fill("ES", "buy", 2, 5000, "2026-03-09T03:30:00Z"),
      fill("ES", "sell", 2, 5010, "2026-03-09T04:30:00Z"),
    ],
    { multipliers: { ES: 50 } },
  )[0]!,
  assetClass: "futures",
  contractMultiplier: 50,
  annotations: {
    stopLoss: 4995,
    profitTarget: 5015,
    tags: ["A+", "trend"],
    rating: 4,
    reviewed: true,
    playbook: "orb",
  },
});
describe("risk and filtering preserve the meaning of trade data", () => {
  it("uses point value for futures R and rejects missing or invalid risk", () => {
    const t = sample();
    expect(tradeRisk(t)).toBe(500);
    expect(tradeR(t)).toBe(2);
    expect(plannedR(t)).toBe(3);
    expect(tradeR({ ...t, contractMultiplier: undefined })).toBeNull();
    expect(tradeRisk({ ...t, annotations: { stopLoss: 5001 } })).toBeNull();
    expect(tradeR({ ...t, status: "open" })).toBeNull();
  });
  it("handles short risk and reward direction", () => {
    const t = {
      ...sample(),
      direction: "short" as const,
      annotations: { stopLoss: 5005, profitTarget: 4985 },
    };
    expect(tradeR(t)).toBe(2);
    expect(plannedR(t)).toBe(3);
    expect(plannedR({ ...t, annotations: { stopLoss: 5005, profitTarget: 5010 } })).toBeNull();
  });
  it("uses close date and local entry weekday across DST", () => {
    const t = sample();
    expect(
      matchesFilters(
        t,
        {
          from: "2026-03-09",
          to: "2026-03-09",
          weekdays: "0",
          entryAfter: "23:00",
          entryBefore: "01:00",
        },
        "America/New_York",
      ),
    ).toBe(true);
    expect(matchesFilters(t, { weekdays: "1" }, "America/New_York")).toBe(false);
    expect(matchesFilters(t, { to: "2026-03-08" }, "America/New_York")).toBe(false);
    expect(dimensionKeys(t, "entryHour", "America/New_York")).toEqual(["23:00"]);
  });
  it("combines annotations and numeric bounds without treating missing values as zero", () => {
    const t = sample();
    expect(
      matchesFilters(t, {
        symbol: "es",
        tag: "A+,trend",
        playbookId: "orb",
        reviewed: "yes",
        quantityMin: "2",
        quantityMax: "2",
        rMin: "2",
        plannedRMin: "3",
        ratingMin: "4",
        durationMin: "60",
      }),
    ).toBe(true);
    expect(matchesFilters(t, { excludeSymbol: "ES" })).toBe(false);
    expect(matchesFilters({ ...t, annotations: {} }, { ratingMin: "0" })).toBe(false);
    expect(matchesFilters(t, { quantityMin: "garbage" })).toBe(false);
    expect(matchesFilters(t, { reviewed: "no" })).toBe(false);
  });
  it("a value that is not a number lands in the Unspecified band, not the top band", () => {
    expect(dimensionKeys({ ...sample(), netPnl: Number.NaN }, "realizedR", "UTC")).toEqual([
      "Unspecified",
    ]);
    expect(dimensionKeys({ ...sample(), quantity: Number.NaN }, "quantity", "UTC")).toEqual([
      "Unspecified",
    ]);
    expect(dimensionKeys(sample(), "realizedR", "UTC")).toEqual(["2–3R"]);
  });
  it("does not count open positions in closed-trade reports", () => {
    expect(summarizeGroup([{ ...sample(), status: "open" }]).trades).toBe(0);
  });
  it("cross-table cells sum to totals for single-valued dimensions", () => {
    const ts = [
      sample(),
      { ...sample(), key: "other", symbol: "NQ", netPnl: -250, status: "loss" as const },
    ];
    const groups = analyzeGroups(ts, "symbol", "weekday", "UTC");
    expect(groups.reduce((s, g) => s + g.trades, 0)).toBe(2);
    expect(groups.reduce((s, g) => s + g.netPnl, 0)).toBe(750);
  });
  it("deduplicates repeated tags within a group and allows explicit cross-group overlap", () => {
    const t = { ...sample(), annotations: { tags: ["trend", "trend", "A+"] } };
    const groups = analyzeGroups([t], "tag");
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.trades === 1)).toBe(true);
  });
  it("breakeven classification does not erase monetary gains from profit factor or P&L", () => {
    const ts = [
      { ...sample(), netPnl: 5, status: "breakeven" as const },
      { ...sample(), key: "loss", netPnl: -10, status: "loss" as const },
    ];
    const m = computeMetrics(ts);
    expect(m.profitFactor).toBe(0.5);
    expect(m.netPnl).toBe(-5);
    expect(m.breakevens).toBe(1);
    expect(m.winRate).toBe(0);
  });
  it("filters EA trades by magic number, bracket label, and comments across different trades of the same EA", () => {
    const tradeBuy = {
      ...sample(),
      key: "t1",
      annotations: { tags: ["EA", "Magic:12345", "Scalp_Buy"] },
    };
    const tradeSell = {
      ...sample(),
      key: "t2",
      annotations: { tags: ["EA", "Magic:12345", "Scalp_Sell"] },
    };
    const tradeOtherEa = {
      ...sample(),
      key: "t3",
      annotations: { tags: ["EA", "Magic:99999", "GridBot"] },
    };
    const tradeManual = {
      ...sample(),
      key: "t4",
      annotations: { tags: ["Manual"] },
    };

    // Filter by magic:12345 matches both Scalp_Buy and Scalp_Sell trades of the same EA
    expect(matchesFilters(tradeBuy, { ea: "magic:12345" })).toBe(true);
    expect(matchesFilters(tradeSell, { ea: "magic:12345" })).toBe(true);
    expect(matchesFilters(tradeOtherEa, { ea: "magic:12345" })).toBe(false);
    expect(matchesFilters(tradeManual, { ea: "magic:12345" })).toBe(false);

    // Filter by raw magic number
    expect(matchesFilters(tradeBuy, { ea: "12345" })).toBe(true);
    expect(matchesFilters(tradeSell, { ea: "12345" })).toBe(true);
    expect(matchesFilters(tradeOtherEa, { ea: "12345" })).toBe(false);

    // Filter by consolidated bracket format [12345] Scalp_Buy & Scalp_Sell
    expect(matchesFilters(tradeBuy, { ea: "[12345] Scalp_Buy & Scalp_Sell" })).toBe(true);
    expect(matchesFilters(tradeSell, { ea: "[12345] Scalp_Buy & Scalp_Sell" })).toBe(true);
    expect(matchesFilters(tradeOtherEa, { ea: "[12345] Scalp_Buy & Scalp_Sell" })).toBe(false);

    // Filter by MagicNumber#comment1#comment2 format (Magic number only matching)
    expect(matchesFilters(tradeBuy, { ea: "12345#Scalp_Buy#Scalp_Sell" })).toBe(true);
    expect(matchesFilters(tradeSell, { ea: "12345#Scalp_Buy#Scalp_Sell" })).toBe(true);
    expect(matchesFilters(tradeOtherEa, { ea: "12345#Scalp_Buy#Scalp_Sell" })).toBe(false);
    expect(matchesFilters(tradeManual, { ea: "12345#Scalp_Buy#Scalp_Sell" })).toBe(false);

    // Trade with same magic but totally different new comment also matches as same EA unit!
    const tradeDifferentComment = {
      ...sample(),
      key: "t5",
      annotations: { tags: ["EA", "Magic:12345", "Completely_New_Comment_V3"] },
    };
    expect(matchesFilters(tradeDifferentComment, { ea: "12345#Scalp_Buy#Scalp_Sell" })).toBe(true);
    expect(matchesFilters(tradeDifferentComment, { ea: "magic:12345" })).toBe(true);
    expect(matchesFilters(tradeDifferentComment, { ea: "12345" })).toBe(true);

    // Filter by executionType
    expect(matchesFilters(tradeBuy, { executionType: "ea" })).toBe(true);
    expect(matchesFilters(tradeManual, { executionType: "ea" })).toBe(false);
    expect(matchesFilters(tradeManual, { executionType: "manual" })).toBe(true);
    expect(matchesFilters(tradeBuy, { executionType: "manual" })).toBe(false);
  });
});

