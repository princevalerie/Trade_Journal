"use client";
import { OptionSelect } from "@/components/ui/option-select";
import { Checkbox } from "@/components/ui/checkbox";

import type { AnalysisFilters, FilterKey } from "@luxalgo/journal-core";
import { useApi } from "@/lib/use-api";
import { MonetaryField } from "./privacy";
import { ChevronDown, CircleHelp } from "lucide-react";
import { HoverHint } from "./ui/tooltip";
import { DatePicker } from "./ui/date-picker";
const FIELD_HINTS: Record<string, string> = {
  From: "First included date. Closed trades use their closing day; open trades use their opening day.",
  To: "Last included date. Dates follow the journal time zone.",
  Strategy: "Include trades assigned to this playbook. All includes trades without a playbook.",
  "Symbols (comma-separated)":
    "Include these symbols. Separate multiple symbols with commas, for example AAPL, NVDA.",
  "Exclude symbols": "Hide these symbols from the results. Separate multiple symbols with commas.",
  "Required tags (comma-separated)":
    "Filter by tags recorded on your trades. Separate multiple tags with commas.",
  "Required mistakes":
    "Filter by recorded trading mistakes. Separate multiple mistakes with commas.",
  "Review status": "Find trades you have marked reviewed, or those still awaiting review.",
  "Realized R": "Trade profit or loss expressed as a multiple of the trade's initial risk.",
  "Planned R": "The planned reward relative to the trade's initial risk.",
  "Minutes held": "Time between opening and closing a trade, measured in minutes.",
};
export const fieldClass = "h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm";
export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="journal-filter-field grid min-w-0 gap-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        {label}
        {FIELD_HINTS[label.split(" · ")[0]!] && (
          <HoverHint heading={label} content={FIELD_HINTS[label.split(" · ")[0]!]}>
            <span
              tabIndex={0}
              aria-label={`About ${label}`}
              className="inline-flex cursor-help rounded-sm text-muted-foreground/70 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <CircleHelp aria-hidden="true" className="h-3 w-3" />
            </span>
          </HoverHint>
        )}
      </span>
      {children}
    </label>
  );
}
export function FilterFields({
  value,
  onChange,
}: {
  value: AnalysisFilters;
  onChange: (v: AnalysisFilters) => void;
}) {
  const { data: accounts } = useApi<{
    accounts: { id: string; name: string; archivedAt: string | null }[];
  }>("/api/accounts");
  const { data: playbooks } = useApi<{ playbooks: { id: string; name: string }[] }>(
    "/api/playbooks",
  );
  const eaEndpoint = value.accounts ? `/api/eas?accounts=${encodeURIComponent(value.accounts)}` : "/api/eas";
  const { data: easData } = useApi<{
    eas: { id: string; name: string; magic?: number | null; comments?: string[]; count: number }[];
    totalManual: number;
    totalEa: number;
    totalTrades: number;
  }>(eaEndpoint);
  const set = (key: FilterKey, v: string) => onChange({ ...value, [key]: v });
  const input = (key: FilterKey, label: string, type = "text") => (
    <Field key={key} label={label}>
      <MonetaryField sensitive={/^(entry|exit|pnl)(Min|Max)$/.test(key)}>
        {type === "date" ? (
          <DatePicker
            value={value[key] ?? ""}
            onValueChange={(next) => set(key, next)}
            label={label}
          />
        ) : (
          <input
            className={fieldClass}
            aria-label={label}
            type={type}
            step={type === "number" ? "any" : undefined}
            value={value[key] ?? ""}
            onChange={(e) => set(key, e.target.value)}
          />
        )}
      </MonetaryField>
    </Field>
  );
  const select = (key: FilterKey, label: string, choices: [string, string][]) => (
    <Field key={key} label={label}>
      <span className="journal-filter-select relative block min-w-0">
        <OptionSelect
          className={fieldClass}
          value={value[key] ?? ""}
          onValueChange={(next) => set(key, next)}
        >
          <option value="">All</option>
          {choices.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </OptionSelect>
      </span>
    </Field>
  );
  return (
    <div className="journal-filter-fields space-y-5">
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-3">
        {input("from", "From", "date")}
        {input("to", "To", "date")}
        {select(
          "playbookId",
          "Strategy",
          (playbooks?.playbooks ?? []).map((p) => [p.id, p.name]),
        )}
        {input("symbol", "Symbols (comma-separated)")}
        {input("excludeSymbol", "Exclude symbols")}
        {input("tag", "Required tags (comma-separated)")}
        {input("mistake", "Required mistakes")}
        {select("direction", "Direction", [
          ["long", "Long"],
          ["short", "Short"],
        ])}
        {select("status", "Outcome", [
          ["closed", "All closed"],
          ["open", "Open"],
          ["win", "Win"],
          ["loss", "Loss"],
          ["breakeven", "Breakeven"],
        ])}
        {select("reviewed", "Review status", [
          ["yes", "Reviewed"],
          ["no", "Unreviewed"],
        ])}
        {select(
          "assetClass",
          "Asset class",
          ["equity", "futures", "forex", "option", "crypto", "cfd", "other"].map((v) => [v, v]),
        )}
      </div>

      {/* Execution Source & EA Multi-Select Drilldown */}
      <fieldset className="journal-filter-execution rounded-lg border p-3.5 space-y-3 bg-muted/20">
        <legend className="px-1 text-xs font-semibold text-foreground flex items-center gap-1.5">
          <span>🤖 Execution Source & EA Drilldown</span>
        </legend>

        {/* Toggle Mode: All / Manual Only / EA Only */}
        <div className="flex flex-wrap items-center gap-2">
          {[
            { id: "all", label: `All Trades (${easData?.totalTrades ?? 0})` },
            { id: "manual", label: `Manual Only (${easData?.totalManual ?? 0})` },
            { id: "ea", label: `EA Robots Only (${easData?.totalEa ?? 0})` },
          ].map((mode) => {
            const active = (value.executionType || "all") === mode.id;
            return (
              <button
                type="button"
                key={mode.id}
                onClick={() => {
                  set("executionType", mode.id === "all" ? "" : mode.id);
                  if (mode.id === "manual") set("ea", "");
                }}
                className={`px-3 py-1 text-xs font-medium rounded-full transition-all border ${
                  active
                    ? "bg-primary text-primary-foreground border-primary shadow-sm"
                    : "bg-background text-muted-foreground hover:text-foreground border-border"
                }`}
              >
                {mode.label}
              </button>
            );
          })}
        </div>

        {/* Multi-EA Selection Pills */}
        {easData?.eas && easData.eas.length > 0 && (
          <div className="space-y-1.5 pt-1">
            <div className="text-[11px] text-muted-foreground flex items-center justify-between">
              <span>Pilih Robot / EA (Bisa pilih 1 EA atau multi EA sekaligus):</span>
              {value.ea && (
                <button
                  type="button"
                  onClick={() => set("ea", "")}
                  className="text-primary text-[11px] hover:underline"
                >
                  Clear EA selection
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {easData.eas.map((eaItem) => {
                const selectedEas = (value.ea ?? "")
                  .split(",")
                  .map((s) => s.trim().toLowerCase())
                  .filter(Boolean);
                const filterKey = (eaItem.id || eaItem.name).toLowerCase();
                const magicKey = eaItem.magic ? String(eaItem.magic).toLowerCase() : null;
                const isChecked = selectedEas.some((s) => {
                  if (magicKey) {
                    if (s === magicKey || s === `magic:${magicKey}`) return true;
                    if (s.startsWith(`${magicKey}#`)) return true;
                    const bracket = s.match(/^\[(\d+)\]/)?.[1];
                    if (bracket === magicKey) return true;
                  }
                  return s === filterKey || s === eaItem.name.toLowerCase();
                });

                return (
                  <label
                    key={eaItem.id || eaItem.name}
                    className={`cursor-pointer inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs border transition-colors ${
                      isChecked
                        ? "bg-emerald-500/15 border-emerald-500/50 text-emerald-400 font-medium"
                        : "bg-background border-border text-muted-foreground hover:border-border/80"
                    }`}
                  >
                    <Checkbox
                      checked={isChecked}
                      onCheckedChange={(checked) => {
                        const targetId = magicKey ? magicKey : (eaItem.id || eaItem.name);
                        const currentList = (value.ea ?? "")
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean);

                        let nextList: string[];
                        if (checked === true) {
                          const exists = currentList.some((s) => {
                            const sLower = s.toLowerCase();
                            if (magicKey) {
                              if (sLower === magicKey || sLower === `magic:${magicKey}`) return true;
                              if (sLower.startsWith(`${magicKey}#`)) return true;
                              const bracket = sLower.match(/^\[(\d+)\]/)?.[1];
                              if (bracket === magicKey) return true;
                            }
                            return sLower === filterKey || sLower === eaItem.name.toLowerCase();
                          });
                          nextList = exists ? currentList : [...currentList, targetId];
                          set("executionType", "ea");
                        } else {
                          nextList = currentList.filter((s) => {
                            const sLower = s.toLowerCase();
                            if (magicKey) {
                              if (sLower === magicKey || sLower === `magic:${magicKey}`) return false;
                              if (sLower.startsWith(`${magicKey}#`)) return false;
                              const bracket = sLower.match(/^\[(\d+)\]/)?.[1];
                              if (bracket === magicKey) return false;
                            }
                            return sLower !== filterKey && sLower !== eaItem.name.toLowerCase();
                          });
                        }
                        set("ea", nextList.join(","));
                      }}
                    />
                    <span className="font-mono text-xs font-semibold">{eaItem.name}</span>
                    <span className="text-[10px] opacity-70 bg-muted px-1.5 py-0.5 rounded-full font-sans">
                      {eaItem.count} trade{eaItem.count > 1 ? "s" : ""}
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        )}
      </fieldset>

      <fieldset className="journal-filter-accounts rounded-lg border p-3">
        <legend className="px-1 text-xs text-muted-foreground">
          Accounts · none selected means all
        </legend>
        <div className="flex flex-wrap gap-3">
          {accounts?.accounts
            .filter((a) => !a.archivedAt)
            .map((a) => (
              <label key={a.id} className="journal-filter-choice flex items-center gap-2 text-xs">
                <Checkbox
                  checked={(value.accounts ?? "").split(",").includes(a.id)}
                  onCheckedChange={(checked) => {
                    const ids = new Set((value.accounts ?? "").split(",").filter(Boolean));
                    if (checked === true) ids.add(a.id);
                    else ids.delete(a.id);
                    set("accounts", [...ids].join(","));
                  }}
                />
                {a.name}
              </label>
            ))}
        </div>
      </fieldset>
      <details className="journal-filter-advanced">
        <summary className="flex cursor-pointer items-center justify-between gap-3 text-sm">
          <span>Size, price, risk and time</span>
          <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-muted-foreground" />
        </summary>
        <div className="journal-filter-advanced-grid mt-3 grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 md:grid-cols-4">
          {(
            [
              ["quantity", "Total entry quantity"],
              ["entry", "Entry price"],
              ["exit", "Exit price"],
              ["duration", "Minutes held"],
              ["r", "Realized R"],
              ["plannedR", "Planned R"],
              ["pnl", "Net P&L"],
              ["rating", "Rating"],
            ] as const
          ).flatMap(([k, l]) => [
            input(`${k}Min` as FilterKey, `${l} · min`, "number"),
            input(`${k}Max` as FilterKey, `${l} · max`, "number"),
          ])}
          {input("entryAfter", "Entry after", "time")}
          {input("entryBefore", "Entry before", "time")}
          {input("exitAfter", "Exit after", "time")}
          {input("exitBefore", "Exit before", "time")}
        </div>
        <div className="journal-filter-weekdays mt-3 flex flex-wrap gap-2">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day, i) => (
            <label key={day} className="journal-filter-choice flex items-center gap-2 text-xs">
              <Checkbox
                checked={(value.weekdays ?? "").split(",").includes(String(i))}
                onCheckedChange={(checked) => {
                  const days = new Set((value.weekdays ?? "").split(",").filter(Boolean));
                  if (checked === true) days.add(String(i));
                  else days.delete(String(i));
                  set("weekdays", [...days].join(","));
                }}
              />
              {day}
            </label>
          ))}
        </div>
      </details>
    </div>
  );
}
