import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const desktopRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(desktopRoot, "../..");
const webRoot = path.resolve(repoRoot, "apps/web");
const webStandaloneDir = path.resolve(webRoot, ".next/standalone");
const targetStandaloneDir = path.resolve(desktopRoot, "standalone");

console.log("📦 [prepare-standalone] Preparing Next.js standalone bundle for Electron...");

if (!fs.existsSync(webStandaloneDir)) {
  console.error(`❌ Error: Standalone build not found at: ${webStandaloneDir}`);
  console.error("👉 Please run 'pnpm --filter web build' first.");
  process.exit(1);
}

// Clean and recreate target directory
if (fs.existsSync(targetStandaloneDir)) {
  console.log("🧹 Cleaning old standalone bundle...");
  fs.rmSync(targetStandaloneDir, { recursive: true, force: true });
}
fs.mkdirSync(targetStandaloneDir, { recursive: true });

// Copy standalone output recursively
console.log("📂 Copying .next/standalone to apps/desktop/standalone...");
fs.cpSync(webStandaloneDir, targetStandaloneDir, { recursive: true, dereference: true });

// Copy static assets
const webStaticSrc = path.resolve(webRoot, ".next/static");
if (fs.existsSync(webStaticSrc)) {
  console.log("📂 Copying .next/static...");
  const dest1 = path.resolve(targetStandaloneDir, "apps/web/.next/static");
  const dest2 = path.resolve(targetStandaloneDir, ".next/static");
  fs.mkdirSync(path.dirname(dest1), { recursive: true });
  fs.mkdirSync(path.dirname(dest2), { recursive: true });
  fs.cpSync(webStaticSrc, dest1, { recursive: true });
  fs.cpSync(webStaticSrc, dest2, { recursive: true });
}

// Copy public directory
const webPublicSrc = path.resolve(webRoot, "public");
if (fs.existsSync(webPublicSrc)) {
  console.log("📂 Copying public assets...");
  const dest1 = path.resolve(targetStandaloneDir, "apps/web/public");
  const dest2 = path.resolve(targetStandaloneDir, "public");
  fs.mkdirSync(path.dirname(dest1), { recursive: true });
  fs.mkdirSync(path.dirname(dest2), { recursive: true });
  fs.cpSync(webPublicSrc, dest1, { recursive: true });
  fs.cpSync(webPublicSrc, dest2, { recursive: true });
}

// Rebuild better-sqlite3 native module for Electron's ABI.
// The standalone bundle ships with a Node.js-compiled binary (ABI 127),
// but Electron 34 uses ABI 132. Without this step, the packaged app will
// crash with NODE_MODULE_VERSION mismatch errors.
const betterSqlite3Dirs = [
  path.resolve(targetStandaloneDir, "node_modules/better-sqlite3"),
  path.resolve(targetStandaloneDir, "apps/web/node_modules/better-sqlite3"),
];

import { createRequire } from "node:module";
const require = createRequire(path.resolve(desktopRoot, "package.json"));

const electronPkg = JSON.parse(
  fs.readFileSync(require.resolve("electron/package.json"), "utf8")
);
const electronVersion = electronPkg.version;

for (const sqliteDir of betterSqlite3Dirs) {
  if (fs.existsSync(sqliteDir)) {
    console.log(`🔨 Rebuilding better-sqlite3 for Electron ${electronVersion} at ${sqliteDir}...`);
    const { execSync } = await import("node:child_process");
    try {
      execSync(
        `npx --yes prebuild-install --runtime electron --target ${electronVersion} --arch x64 --force`,
        { cwd: sqliteDir, stdio: "inherit" }
      );
      console.log(`✅ better-sqlite3 rebuilt for Electron ${electronVersion}`);
    } catch (err) {
      console.error(`⚠️ Failed to rebuild better-sqlite3:`, err.message);
      console.error("👉 You may need to run: npx @electron/rebuild -v " + electronVersion);
    }
  }
}

console.log("✅ [prepare-standalone] Next.js standalone assets prepared successfully!");
