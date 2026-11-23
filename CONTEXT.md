# Trade Journal - Comprehensive Project Context

> **Version:** 3.0.0 | **Last Updated:** 2025 | **Status:** Production Ready
> **Repository:** https://github.com/princevalerie/Trade_Journal

---

## 🎯 Project Overview

**Trade Journal** is an open-source, self-hosted trading journal platform designed for professional traders. It provides:
- **Real-time & Historical Sync** with MetaTrader 4/5 via Expert Advisors (EAs)
- **Deep Analytics**: Round-trip matching (FIFO/LIFO/WAVG), Edge Score v2, MAE/MFE, Equity Curves
- **Daily Journaling**: Markdown notes, trade tagging, playbooks, progress tracking
- **AI-Native Reflection**: AI-powered trade critique, recap generation, and Q&A
- **Multi-Broker Support**: MT4/MT5 webhook sync, CSV imports (TradeZella, TraderVue, 10+ brokers)
- **Desktop App**: Electron + Next.js standalone (Windows/macOS)
- **Self-Hosted**: Runs locally or on VPS, data never leaves your machine

---

## 🏗️ Architecture Overview

### Monorepo Structure (pnpm Workspaces)

```
trade-journal/
├── apps/
│   ├── web/          # Next.js 15 (App Router, React 19, Turbopack)
│   └── desktop/      # Electron 34 + Next.js Standalone
├── packages/
│   ├── core/         # @luxalgo/journal-core - Pure domain engine (no IO)
│   └── importers/    # @luxalgo/journal-importers - CSV/HTML importers
├── scripts/
│   ├── mt4/          # TradeJournalSync.mq4 (MT4 EA)
│   ├── mt5/          # TradeJournalSync.mq5 (MT5 EA)
│   ├── mt4-proxy.js  # Port 80 -> 3000 proxy for MT4
│   └── setup-sqlite.cjs  # Native binary fixer for better-sqlite3
├── packages/core/src/       # Domain logic (round-trips, metrics, Edge Score)
├── packages/importers/src/  # Broker statement parsers
└── apps/web/src/            # Next.js App Router (pages, API, components)
```

### Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | Next.js 15 (App Router), React 19, TailwindCSS 4, Radix UI, TanStack Table |
| **Backend** | Next.js API Routes, Drizzle ORM, better-sqlite3 (SQLite) |
| **Desktop** | Electron 34, Electron Builder, Next.js Standalone Output |
| **MT4/MT5** | MQL4/MQL5 Expert Advisors (WebRequest, ChartScreenShot) |
| **Core Engine** | TypeScript (ESM), Pure functions, Zero dependencies |
| **Testing** | Vitest, 300+ unit/integration tests |
| **Package Manager** | pnpm 11 (workspace protocol) |

---

## 🔄 Data Flow Architecture

```
┌─────────────────┐     Webhook (HTTP POST)      ┌──────────────────┐
│  MetaTrader 4/5 │ ────────────────────────────► │  Next.js API     │
│  (MT4/MT5 EA)   │  JSON: account, trades,       │  /api/webhooks/  │
│                 │  executions, screenshots      │  mt4 | mt5       │
└─────────────────┘                               └────────┬─────────┘
                                                            │
                                              ┌─────────────▼─────────────┐
                                              │  insertExecutions()       │
                                              │  - Validate & deduplicate │
                                              │  - contentHash (SHA256)   │
                                              │  - Insert executions      │
                                              │  - rebuildAccount()       │
                                              └─────────────┬─────────────┘
                                                            │
                                              ┌─────────────▼─────────────┐
                                              │  buildRoundTrips()        │
                                              │  (packages/core)          │
                                              │  - FIFO/LIFO/WAVG matching│
                                              │  - P&L, fees, R-multiples │
                                              │  - MAE/MFE, Edge Score    │
                                              └─────────────┬─────────────┘
                                                            │
                                              ┌─────────────▼─────────────┐
                                              │  Materialized `trades`    │
                                              │  Table (SQLite)           │
                                              │  - annotations preserved  │
                                              │  - rebuilt on every sync  │
                                              └───────────────────────────┘
```

---

## 🗄️ Database Schema (SQLite + Drizzle ORM)

### Core Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `accounts` | Broker/platform accounts | `id`, `kind` (sync/import/manual), `broker`, `currency`, `profitCalcMethod` |
| `executions` | Raw fills (legs) | `id`, `accountId`, `symbol`, `side`, `quantity`, `price`, `fee`, `executedAt`, `contentHash` (UNIQUE per account), `importMetadataJson` |
| `trades` | Materialized round-trips | `key` (PK), `accountId`, `symbol`, `direction`, `status`, `avgEntry`, `avgExit`, `grossPnl`, `netPnl`, `executionCount`, `tagsJson`, `notes` |
| `journalDays` | Daily notes | `date` (PK), `note`, `updatedAt` |
| `tradeExcursions` | MAE/MFE estimates | `tradeKey` (FK), `provider`, `estimateJson` (MAE/MFE/bars) |
| `attachments` | Chart screenshots | `ownerType`, `ownerId`, `data` (BLOB), `mime` |
| `folders`/`notes` | Notebook system | Hierarchical folders, markdown notes |
| `playbooks` | Trading checklists | `rulesJson` (JSON array) |
| `propAccounts`/`propEntries` | Prop firm tracking | Cash flows, payouts, audit trail |

### Key Design Decisions

1. **`executions.contentHash`** - SHA256 deduplication key. Uses `meta_id` strategy when `importMetadata.id` exists (MT ticket), else content-based hash.
2. **`trades.key`** - Rebuild-stable key: `${accountId}|${symbol}|${direction}|${openedAt}|import:${groupId}`
3. **Annotation Preservation** - `notes`, `tagsJson`, `mistakesJson`, `rating`, `reviewedAt` survive rebuilds via `onConflictDoUpdate`.
4. **`tradeExcursions`** - Separate table for MAE/MFE estimates (from M1 data), keyed by `tradeKey`.

---

## 🔌 API Routes (Next.js App Router)

### Public Webhooks (MT4/MT5)

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/webhooks/mt4` | POST | `x-api-key` / body `apiKey` | MT4 trade history + realtime sync |
| `/api/webhooks/mt5` | POST | `x-api-key` / body `apiKey` | MT5 deal history + realtime sync |

**Request Body (MT4):**
```json
{
  "apiKey": "secret",
  "account": { "login": 12345, "broker": "Valbury", "balance": 10000, ... },
  "trades": [{ "ticket": 123, "symbol": "XAUUSD", "type": "buy", "lots": 0.5, ... }]
}
```

**Response:**
```json
{ "success": true, "accountId": "mt4_12345", "result": { "inserted": 10, "duplicates": 0 }, "syncedAt": "..." }
```

### Journal API

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/journal` | GET | List all days with trades/notes (chronology) |
| `/api/journal/[date]` | GET | Single day details (trades, metrics, intraday curve, note) |
| `/api/journal/[date]` | PUT | Save/update daily note |

### Other Key APIs

| Endpoint | Purpose |
|----------|---------|
| `/api/accounts` | CRUD for accounts (sync/import/manual) |
| `/api/accounts/[id]/actions` | `sync`, `rebuild`, `archive`, `clear`, `transfer` |
| `/api/eas` | List EA/Robot names with trade counts (per account filter) |
| `/api/stats` | Aggregated stats (PnL, win rate, expectancy, drawdown) |
| `/api/analysis` | Deep analytics (Edge Score, expectancy, distributions) |
| `/api/trades` | Trade list with filtering, pagination |
| `/api/calendar` | Calendar heatmap data |
| `/api/ai/ask` | AI Q&A over journal context |
| `/api/ai/critique` | AI trade critique |
| `/api/ai/recap` | AI daily/weekly recap |

---

## 🤖 MT4/MT5 Expert Advisors (EAs)

### File Locations
- **MT4:** `scripts/mt4/TradeJournalSync.mq4` (compiled: `.ex4`)
- **MT5:** `scripts/mt5/TradeJournalSync.mq5` (compiled: `.ex5`)

### Key Features

| Feature | MT4 | MT5 |
|---------|-----|-----|
| **History Sync** | Orders (batches of 100) | Deals (batches of 100) |
| **Realtime Detection** | `OnTick` + ticket tracking | `OnTradeTransaction` |
| **Heartbeat** | Every `InpHeartbeatSec` (default 5s) | Every `InpHeartbeatSec` |
| **Chart Screenshots** | `ChartScreenShot()` per trade | `ChartScreenShot()` per deal |
| **MAE/MFE Calculation** | M1 bars between open/close | M1 bars per position |
| **Magic Number Support** | ✅ | ✅ |
| **Comment Parsing** | EA name extraction | ✅ |
| **Force Resync** | Server `FORCE_RESYNC` command | Server `FORCE_RESYNC` command |

### EA Input Parameters

```mql4
// Connection
InpApiUrl          = "https://your-domain.com/api/webhooks/mt4"
InpApiKey          = "your-secret-key"  // MT_WEBHOOK_SECRET
InpAccountName     = ""

// History Scope
InpSyncScope       = SYNC_ALL_HISTORY | SYNC_PAST_DAYS | SYNC_FROM_DATE
InpSyncDays        = 365
InpSyncStartDate   = D'2020.01.01'
InpBatchSize       = 100

// Monitoring
InpHeartbeatSec    = 5
InpShowDashboard   = true

// Visuals
InpAutoScreenshot  = true
InpScreenshotWidth = 800
InpScreenshotHeight= 450
```

### MT4/MT5 Setup Requirements

1. **Allow WebRequest URLs** (Tools → Options → Expert Advisors):
   - `http://127.0.0.1:3000` (local)
   - `http://localhost:3000` (local)
   - `https://your-domain.com` (production)
   - ⚠️ **NO PATHS** - only base URLs!

2. **Account History** → Right-click → **"All History"** (required for full sync)

3. **AutoTrading** button must be ON (green)

---

## 🖥️ Desktop Application (Electron)

### Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Electron Main Process (main.ts)                        │
│  - Single instance lock                                 │
│  - Spawns Next.js standalone server (server-runner.ts)  │
│  - Auto-starts MT4 proxy on port 80 → 3000             │
│  - Creates BrowserWindow loading http://127.0.0.1:PORT  │
└─────────────────────────────────────────────────────────┘
```

### Key Files

| File | Purpose |
|------|---------|
| `apps/desktop/src/main.ts` | Electron entry, window management, server lifecycle |
| `apps/desktop/src/server-runner.ts` | Spawns Next.js standalone server, finds free port, MT4 proxy on port 80 |
| `apps/desktop/scripts/prepare-standalone.js` | Copies `.next/standalone` + static assets to `apps/desktop/standalone/` |

### Build Commands

```bash
# Windows
pnpm desktop:build:win    # Creates NSIS installer + portable .exe

# macOS (requires macOS host)
pnpm desktop:build:mac    # Creates .dmg + .zip (universal/arm64/x64)

# Development
pnpm desktop:dev          # Build TS + run Electron
```

### Packaging (electron-builder.yml)

```yaml
appId: com.tradejournal.desktop
productName: Trade Journal
electronVersion: 34.3.0
win:
  target: [nsis, portable]
  icon: resources/icon.ico
mac:
  target: [dmg, zip]
  icon: resources/icon.icns
  category: public.app-category.finance
```

### Data Persistence

- **Windows:** `%APPDATA%\TradeJournal\data`
- **macOS:** `~/Library/Application Support/TradeJournal/data`
- Contains: SQLite database (`journal.db`), attachments, settings

---

## 🧠 Core Domain Engine (@luxalgo/journal-core)

### Location: `packages/core/src/`

### Key Modules

| File | Exports | Purpose |
|------|---------|---------|
| `round-trips.ts` | `buildRoundTrips()` | FIFO/LIFO/WAVG matching, P&L, R-multiples |
| `metrics.ts` | `computeMetrics()` | Win rate, expectancy, Sharpe, max DD, Edge Score |
| `analysis.ts` | `analyzeTrades()` | Distributions, streaks, time analysis |
| `types.ts` | Types | `Execution`, `RoundTrip`, `TradeMetrics`, `EdgeScoreInput` |

### Round-Trip Matching Algorithm

1. **Group by symbol** → Sort executions by time
2. **Iterate fills** → Maintain open position stack
3. **Match entry→exit** using configured method (FIFO/LIFO/WAVG)
4. **Calculate**:
   - Average entry/exit prices (volume-weighted)
   - Gross PnL = Σ(exitNotional - entryNotional)
   - Fees = Σ fill fees (pro-rata on crossing)
   - Net PnL = Gross - Fees
   - R-multiple = Net PnL / Initial Risk (if SL known)
   - MAE/MFE (if excursions provided)

### Edge Score v2

Composite score (0-100) based on:
- **Consistency** (win rate × trade count)
- **Risk Management** (R-multiple avg, max DD)
- **Expectancy** (mathematical edge)
- **Sample Size** (statistical significance)

---

## 📥 Importers (@luxalgo/journal-importers)

### Location: `packages/importers/src/`

### Supported Formats

| Format | Parser | Features |
|--------|--------|----------|
| **TradeZella** | CSV/JSON | Full migration (trades, notes, tags, screenshots) |
| **TraderVue** | JSON/CSV | Trades, notes, tags |
| **Generic CSV** | Flexible column mapping | Auto-detect columns |
| **MetaTrader HTML** | HTML report parser | History + open positions |
| **Broker CSVs** | 10+ brokers | Interactive Brokers, TD, Schwab, etc. |

### Pipeline

```
Raw File → Parse → Normalize → ImportedExecution[] → insertExecutions() → rebuildAccount()
```

---

## 🔐 Authentication & Security

### Admin Session (Cookie-based)

- **Environment:** `JOURNAL_PASSWORD` (optional, enables auth)
- **Cookie:** `journal_session` (HTTP-only, SameSite=Lax)
- **Login:** `/api/auth` (POST with password)
- **Middleware:** `middleware.ts` protects routes

### Webhook Authentication

- **Header:** `x-api-key: <secret>`
- **Body:** `apiKey: "<secret>"` (fallback)
- **Environment:** `MT_WEBHOOK_SECRET`
- **Validation:** Exact string match (constant-time comparison recommended)

### Public vs Protected Routes

| Type | Examples |
|------|----------|
| **Public Pages** | `/`, `/calendar`, `/journal`, `/trades`, `/reports`, `/login` |
| **Protected Pages** | `/accounts`, `/settings`, `/import`, `/prop-firms`, `/notebook`, `/playbooks`, `/progress`, `/missed` |
| **Public APIs (GET)** | `/api/trades*`, `/api/stats`, `/api/analysis`, `/api/calendar`, `/api/journal*`, `/api/accounts`, `/api/eas`, `/api/webhooks/*` |
| **Protected APIs** | All mutations (POST/PATCH/DELETE), `/api/accounts/[id]/actions` |

---

## ⚙️ Configuration Files

### Root Configuration

| File | Purpose |
|------|---------|
| `package.json` | Root scripts, devDependencies (prettier, typescript, vitest) |
| `pnpm-workspace.yaml` | Workspace packages: `apps/*`, `packages/*` |
| `tsconfig.base.json` | Base TypeScript config (strict, ESM, paths) |
| `.env` | Runtime secrets (`JOURNAL_PASSWORD`, `MT_WEBHOOK_SECRET`, `JOURNAL_DATA_DIR`) |
| `vitest.config.ts` | Test config (globals, environment: node) |
| `vercel.json` | Vercel deployment config (if deploying web) |

### Desktop Packaging

| File | Purpose |
|------|---------|
| `apps/desktop/electron-builder.yml` | electron-builder config (targets, icons, signing) |
| `apps/desktop/scripts/prepare-standalone.js` | Copies Next.js standalone output |

---

## 🧪 Testing

### Test Structure

```
apps/web/tests/
├── ai-settings.test.ts
├── market-data.test.ts
├── market-data-connections.test.ts
├── prop-firms.test.ts
├── trades-query.test.ts
├── ... (30+ test files)
packages/core/tests/
├── metrics.test.ts
├── round-trips.test.ts
└── analysis.test.ts
packages/importers/tests/
├── history.test.ts
└── importers.test.ts
```

### Run Commands

```bash
pnpm test              # All tests (vitest run)
pnpm test:watch        # Watch mode
pnpm typecheck         # TypeScript across all packages
```

---

## 🚀 Deployment

### Local Development

```bash
# Install
pnpm install

# Dev server (Next.js + Turbopack)
pnpm dev                    # http://localhost:3000

# Desktop dev
pnpm desktop:dev

# Build web for production
pnpm build

# Build desktop installers
pnpm desktop:build:win
pnpm desktop:build:mac      # Requires macOS
```

### Production (VPS/Self-Hosted)

1. **Clone & Build**
   ```bash
   git clone https://github.com/princevalerie/Trade_Journal.git
   cd Trade_Journal
   pnpm install
   pnpm build
   pnpm desktop:build:win  # or :build:mac
   ```

2. **Run Desktop App** (headless via PM2/systemd)
   ```bash
   # Or run web only
   NODE_ENV=production PORT=3000 pnpm start
   ```

3. **Reverse Proxy (Nginx)** - for web access
   ```nginx
   server {
     listen 80;
     server_name journal.yourdomain.com;
     
     location / {
       proxy_pass http://127.0.0.1:3000;
       proxy_http_version 1.1;
       proxy_set_header Upgrade $http_upgrade;
       proxy_set_header Connection 'upgrade';
       proxy_set_header Host $host;
       proxy_cache_bypass $http_upgrade;
     }
   }
   ```

4. **Environment Variables** (`.env`)
   ```env
   JOURNAL_PASSWORD=your-admin-password
   MT_WEBHOOK_SECRET=your-webhook-secret
   JOURNAL_DATA_DIR=/path/to/data  # optional
   ```

---

## 🐛 Common Issues & Fixes

| Issue | Cause | Fix |
|-------|-------|-----|
| `ERR_DLOPEN_FAILED` (better-sqlite3) | Native binary ABI mismatch (Node 22 = ABI 127) | Run `pnpm setup:sqlite` to download correct prebuild |
| MT4/MT5 Error 4060/5203 | URL not in whitelist | Tools → Options → Expert Advisors → Add base URL only |
| "Unexpected token <" | API returns HTML (404/login) | Check auth, route existence, MT_WEBHOOK_SECRET |
| Net P&L mismatch MT4 | Filter set to 7D/30D, not "All" | Click "All" in dashboard filter |
| Database locked | Multiple processes | Ensure single instance lock (Electron handles) |
| Chart screenshots blank | Chart not open | EA opens temp chart if needed (M15) |

---

## 📚 Key File Reference Map

### Web App (Next.js)

```
apps/web/src/
├── app/
│   ├── api/
│   │   ├── webhooks/mt4/route.ts     # MT4 webhook handler
│   │   ├── webhooks/mt5/route.ts     # MT5 webhook handler
│   │   ├── journal/route.ts           # Journal chronology
│   │   ├── journal/[date]/route.ts    # Day details + note CRUD
│   │   ├── accounts/route.ts          # Account CRUD
│   │   ├── accounts/[id]/actions/route.ts  # sync/rebuild/archive
│   │   ├── eas/route.ts               # EA/Robot filter list
│   │   ├── stats/route.ts             # Aggregated stats
│   │   ├── trades/route.ts            # Trade list + filters
│   │   ├── calendar/route.ts          # Calendar heatmap
│   │   ├── analysis/route.ts          # Deep analytics
│   │   └── ai/ask|critique|recap      # AI endpoints
│   ├── accounts/page.tsx              # Accounts management UI
│   ├── trades/page.tsx                # Trade explorer UI
│   ├── journal/page.tsx               # Journal UI
│   └── layout.tsx                     # Root layout + providers
├── components/                        # React components (Radix UI based)
├── db/
│   ├── schema.ts                      # Drizzle schema (all tables)
│   └── index.ts                       # DB connection (singleton)
├── server/
│   ├── ids.ts                         # newId, nowIso, executionHash
│   ├── executions.ts                  # insertExecutions, partitionExecutions
│   ├── rebuild.ts                     # rebuildAccount (buildRoundTrips)
│   ├── settings.ts                    # getJournalDefaults, multipliers
│   └── api.ts                         # handler, ok, bad, requireValue
├── lib/
│   ├── journal-defaults.ts            # Default risk/fee settings
│   └── use-api.ts                     # React query hooks
└── middleware.ts                      # Auth middleware
```

### Desktop App (Electron)

```
apps/desktop/src/
├── main.ts              # Electron entry, window, server lifecycle
├── server-runner.ts     # Spawns Next.js standalone, MT4 proxy (port 80)
└── preload.ts           # IPC bridge (get-app-version, get-data-dir)
```

### MT4/MT5 EAs

```
scripts/
├── mt4/TradeJournalSync.mq4    # Full MT4 sync (orders, realtime, screenshots)
├── mt5/TradeJournalSync.mq5    # Full MT5 sync (deals, realtime, screenshots)
├── mt4-proxy.js                # Port 80 → 3000 proxy (for MT4 WebRequest)
└── setup-sqlite.cjs            # Native binary fixer for better-sqlite3
```

### Core Engine

```
packages/core/src/
├── index.ts              # Barrel exports
├── round-trips.ts        # buildRoundTrips() - FIFO/LIFO/WAVG
├── metrics.ts            # computeMetrics() - Edge Score, expectancy
├── analysis.ts           # analyzeTrades() - distributions, streaks
└── types.ts              # Type definitions
```

---

## 🎯 Development Guidelines

### Code Style

- **TypeScript Strict Mode** - No `any`, explicit types
- **ESM Only** - `type: "module"` everywhere
- **File Extensions** - Required in imports (`.js`, `.ts`)
- **Error Handling** - `handler()` wrapper returns `{ ok, error }` tuples
- **Validation** - `requireValue(condition, message)` for invariants

### Database Patterns

```typescript
// Transaction for multi-table writes
await db.transaction(async (tx) => {
  tx.insert(executions).values(...).run();
  await rebuildAccount(accountId);  // Rebuilds trades table
});

// Upsert with conflict resolution
await tx.insert(trades)
  .values({ key, ...computed })
  .onConflictDoUpdate({ target: trades.key, set: computed })
  .run();
```

### API Handler Pattern

```typescript
export const POST = handler(async (request: Request) => {
  const body = await request.json() as MyBody;
  // validation via requireValue()
  // return ok({ data }) or bad("message", 400)
});
```

---

## 📖 Additional Documentation

- `README.md` - Project overview, quick start
- `CHANGELOG.md` - Version history
- `CONTRIBUTING.md` - Contribution guidelines
- `PANDUAN_SERVER_VPS.md` - Indonesian VPS deployment guide
- `SECURITY.md` - Security policy
- `docs/` - Architecture diagrams, API docs

---

## 🔗 Quick Reference Commands

```bash
# Development
pnpm dev                    # Next.js dev server
pnpm desktop:dev            # Electron dev

# Building
pnpm build                  # Next.js production build
pnpm desktop:build:win      # Windows installer + portable
pnpm desktop:build:mac      # macOS DMG + ZIP

# Testing
pnpm test                   # Run all tests
pnpm test:watch             # Watch mode
pnpm typecheck              # TypeScript check all packages

# Database
pnpm setup:sqlite           # Fix better-sqlite3 native binary

# Formatting
pnpm format                 # Prettier write
pnpm format:check           # Prettier check
```

---

*Generated from comprehensive codebase analysis. This document serves as the single source of truth for AI assistants and developers working on the Trade Journal project.*