#!/usr/bin/env node

/**
 * ==============================================================================
 * 🚀 TRADE JOURNAL MANAGER CLI
 * ==============================================================================
 * Cross-platform CLI Manager for Trade Journal
 * Works on Linux (Ubuntu/Debian/CentOS) and Windows Server / Desktop.
 * ==============================================================================
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const os = require('os');

const ROOT_DIR = __dirname;
const PID_FILE = path.join(ROOT_DIR, '.journal.pid');
const LOG_FILE = path.join(ROOT_DIR, '.journal.log');
const BACKUP_DIR = path.join(ROOT_DIR, 'backups');

// ANSI Colors
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgBlue: '\x1b[44m',
};

function log(msg, color = colors.white) {
  console.log(`${color}${msg}${colors.reset}`);
}

function logSuccess(msg) {
  console.log(`${colors.green}✔ ${msg}${colors.reset}`);
}

function logError(msg) {
  console.log(`${colors.red}✖ ${msg}${colors.reset}`);
}

function logWarn(msg) {
  console.log(`${colors.yellow}⚠ ${msg}${colors.reset}`);
}

function logInfo(msg) {
  console.log(`${colors.cyan}ℹ ${msg}${colors.reset}`);
}

function runCmd(cmd, options = {}) {
  try {
    return execSync(cmd, { cwd: ROOT_DIR, stdio: options.silent ? 'pipe' : 'inherit', ...options });
  } catch (err) {
    if (!options.silent) {
      logError(`Perintah gagal: ${cmd}`);
      if (err.message) logError(err.message);
    }
    throw err;
  }
}

function runCmdSilent(cmd) {
  try {
    return execSync(cmd, { cwd: ROOT_DIR, stdio: 'pipe', encoding: 'utf-8' }).trim();
  } catch {
    return null;
  }
}

// Check if PM2 is installed
function hasPm2() {
  const res = runCmdSilent('pm2 -v');
  return Boolean(res);
}

// Check if PM2 manages trade-journal
function isPm2Running() {
  if (!hasPm2()) return false;
  const list = runCmdSilent('pm2 jlist');
  if (!list) return false;
  try {
    const parsed = JSON.parse(list);
    return parsed.some((p) => p.name === 'trade-journal' && p.pm2_env?.status === 'online');
  } catch {
    return false;
  }
}

// Get Process Status (Native or PM2)
function getServerStatus() {
  if (isPm2Running()) {
    const list = JSON.parse(runCmdSilent('pm2 jlist') || '[]');
    const proc = list.find((p) => p.name === 'trade-journal');
    return {
      running: true,
      mode: 'PM2',
      pid: proc?.pid,
      uptime: proc?.pm2_env?.pm_uptime ? Math.round((Date.now() - proc.pm2_env.pm_uptime) / 1000) : 0,
    };
  }

  if (fs.existsSync(PID_FILE)) {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10);
    if (!isNaN(pid)) {
      try {
        // Test if PID is still active
        process.kill(pid, 0);
        return { running: true, mode: 'Standalone Background', pid };
      } catch {
        // PID file exists but process dead
        try { fs.unlinkSync(PID_FILE); } catch {}
      }
    }
  }

  // Also check if port 3000 is occupied
  return { running: false };
}

// Stop Server
function stopServer() {
  logInfo('Menghentikan Trade Journal server...');
  let stopped = false;

  if (hasPm2()) {
    try {
      runCmd('pm2 stop trade-journal', { silent: true });
      runCmd('pm2 delete trade-journal', { silent: true });
      stopped = true;
    } catch {}
  }

  if (fs.existsSync(PID_FILE)) {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf-8').trim(), 10);
    if (!isNaN(pid)) {
      try {
        if (os.platform() === 'win32') {
          execSync(`taskkill /F /PID ${pid} /T`, { stdio: 'pipe' });
        } else {
          process.kill(-pid, 'SIGTERM');
        }
      } catch {
        try { process.kill(pid, 'SIGKILL'); } catch {}
      }
      stopped = true;
    }
    try { fs.unlinkSync(PID_FILE); } catch {}
  }

  if (stopped) {
    logSuccess('Server berhasil dihentikan.');
  } else {
    logInfo('Server tidak sedang berjalan.');
  }
}

// Start Server (Production)
function startServer() {
  const status = getServerStatus();
  if (status.running) {
    logWarn(`Server sudah berjalan (Mode: ${status.mode}, PID: ${status.pid}).`);
    return;
  }

  logInfo('Memulai Trade Journal Server (Production)...');

  // Check if build exists
  const nextBuildPath = path.join(ROOT_DIR, 'apps', 'web', '.next');
  if (!fs.existsSync(nextBuildPath)) {
    logWarn('Hasil build belum ditemukan. Membangun aplikasi terlebih dahulu...');
    buildApp();
  }

  if (hasPm2()) {
    logInfo('Menggunakan PM2 process manager...');
    runCmd('pm2 start "pnpm start" --name "trade-journal"');
    runCmd('pm2 save', { silent: true });
    logSuccess('Server berhasil dijalankan via PM2!');
    logInfo('Akses web: http://localhost:3000');
    return;
  }

  // Fallback to standalone background process
  logInfo('Menjalankan di background daemon...');
  const outLog = fs.openSync(LOG_FILE, 'a');
  const errLog = fs.openSync(LOG_FILE, 'a');

  const isWin = os.platform() === 'win32';
  const child = spawn(isWin ? 'cmd.exe' : 'pnpm', isWin ? ['/c', 'pnpm', 'start'] : ['start'], {
    cwd: ROOT_DIR,
    detached: true,
    stdio: ['ignore', outLog, errLog],
  });

  child.unref();
  fs.writeFileSync(PID_FILE, String(child.pid), 'utf-8');

  logSuccess(`Server berhasil dijalankan di background! (PID: ${child.pid})`);
  logInfo(`Log tersimpan di: ${LOG_FILE}`);
  logInfo('Akses web: http://localhost:3000');
}

// Start Dev Server
function startDev() {
  logInfo('Memulai server dalam mode pengembangan (Turbopack Hot-Reload)...');
  logInfo('Tekan Ctrl + C untuk keluar dari mode dev.\n');
  runCmd('pnpm dev');
}

// Build App
function buildApp() {
  logInfo('Membangun aplikasi (pnpm build)...');
  runCmd('pnpm build');
  logSuccess('Build selesai dengan sukses!');
}

// UPDATE FROM GITHUB (The main requested feature!)
function updateFromGithub() {
  console.log('\n' + colors.cyan + colors.bright + '===================================================' + colors.reset);
  console.log(colors.cyan + colors.bright + '      🚀 UPDATE TRADE JOURNAL DARI GITHUB' + colors.reset);
  console.log(colors.cyan + colors.bright + '===================================================' + colors.reset + '\n');

  const statusBefore = getServerStatus();

  // 1. Backup DB first
  logInfo('[1/5] Membuat backup otomatis database saat ini...');
  try {
    backupDb();
  } catch (err) {
    logWarn('Gagal backup otomatis, melanjutkan update...');
  }

  // 2. Git Fetch & Pull
  logInfo('\n[2/5] Mengambil pembaruan terbaru dari GitHub (git pull)...');
  try {
    // Check if git working directory is clean
    const status = runCmdSilent('git status --porcelain');
    if (status) {
      logWarn('Ada file lokal yang dimodifikasi. Menyimpan perubahan sementara (git stash)...');
      runCmd('git stash');
    }

    // Pull latest
    runCmd('git pull');
    logSuccess('Kode berhasil diperbarui dari GitHub!');
  } catch (err) {
    logError('Gagal melakukan git pull. Pastikan koneksi internet aktif dan git terkonfigurasi.');
    return;
  }

  // 3. Install Dependencies
  logInfo('\n[3/5] Memeriksa & menginstall dependencies (pnpm install)...');
  try {
    runCmd('pnpm install');
    logSuccess('Dependencies berhasil diperbarui!');
  } catch (err) {
    logError('Gagal menginstall dependencies.');
    return;
  }

  // 4. Build Application
  logInfo('\n[4/5] Mengompilasi ulang aplikasi (pnpm build)...');
  try {
    runCmd('pnpm build');
    logSuccess('Aplikasi berhasil dikompilasi!');
  } catch (err) {
    logError('Gagal melakukan build aplikasi.');
    return;
  }

  // 5. Restart server if it was running
  logInfo('\n[5/5] Memeriksa status server...');
  if (statusBefore.running) {
    logInfo('Merestart server dengan versi terbaru...');
    stopServer();
    setTimeout(() => {
      startServer();
      console.log('\n' + colors.green + colors.bright + '===================================================' + colors.reset);
      logSuccess('UPDATE SELESAI & SERVER BERJALAN DENGAN VERSI TERBARU!');
      console.log(colors.green + colors.bright + '===================================================' + colors.reset + '\n');
    }, 1500);
  } else {
    console.log('\n' + colors.green + colors.bright + '===================================================' + colors.reset);
    logSuccess('UPDATE SELESAI!');
    logInfo('Ketik: node journal.js start (untuk menjalankan server)');
    console.log(colors.green + colors.bright + '===================================================' + colors.reset + '\n');
  }
}

// Backup Database
function backupDb() {
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const dbPaths = [
    path.join(ROOT_DIR, 'apps', 'web', 'data', 'journal.db'),
    path.join(ROOT_DIR, 'data', 'journal.db'),
  ];

  let found = false;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

  for (const dbPath of dbPaths) {
    if (fs.existsSync(dbPath)) {
      const backupFile = path.join(BACKUP_DIR, `journal-backup-${timestamp}.db`);
      fs.copyFileSync(dbPath, backupFile);
      logSuccess(`Database berhasil dibackup ke: ${backupFile}`);
      found = true;
      break;
    }
  }

  if (!found) {
    logWarn('Belum ada file database journal.db yang ditemukan untuk dibackup.');
  }
}

// Restore Database
function restoreDb() {
  if (!fs.existsSync(BACKUP_DIR)) {
    logWarn('Folder backup kosong.');
    return;
  }

  const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.db')).sort().reverse();
  if (files.length === 0) {
    logWarn('Tidak ada file backup (.db) yang tersedia.');
    return;
  }

  logInfo('File backup yang tersedia:');
  files.forEach((file, index) => {
    const stats = fs.statSync(path.join(BACKUP_DIR, file));
    const sizeKB = (stats.size / 1024).toFixed(1);
    console.log(`  [${index + 1}] ${file} (${sizeKB} KB)`);
  });

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('\nPilih nomor file yang ingin direstore (atau tekan Enter untuk batal): ', (ans) => {
    rl.close();
    const idx = parseInt(ans.trim(), 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= files.length) {
      logInfo('Restore dibatalkan.');
      return;
    }

    const selectedFile = files[idx];
    const source = path.join(BACKUP_DIR, selectedFile);
    const target = path.join(ROOT_DIR, 'apps', 'web', 'data', 'journal.db');

    const targetDir = path.dirname(target);
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

    // Stop server first if running
    const status = getServerStatus();
    if (status.running) stopServer();

    fs.copyFileSync(source, target);
    logSuccess(`Database berhasil direstore dari: ${selectedFile}`);

    if (status.running) startServer();
  });
}

// View Realtime Logs
function viewLogs() {
  if (hasPm2() && isPm2Running()) {
    runCmd('pm2 logs trade-journal');
    return;
  }

  if (!fs.existsSync(LOG_FILE)) {
    logWarn(`Belum ada log file (${LOG_FILE}).`);
    return;
  }

  logInfo(`Menampilkan 50 baris terakhir dari ${LOG_FILE} (Tekan Ctrl+C untuk keluar):\n`);
  const lines = fs.readFileSync(LOG_FILE, 'utf-8').split('\n');
  console.log(lines.slice(-50).join('\n'));

  // Tail log
  const tail = spawn(os.platform() === 'win32' ? 'powershell' : 'tail', 
    os.platform() === 'win32' ? ['-Command', `Get-Content -Path "${LOG_FILE}" -Wait -Tail 20`] : ['-f', LOG_FILE], 
    { stdio: 'inherit' }
  );

  process.on('SIGINT', () => {
    tail.kill();
    process.exit(0);
  });
}

// Start Cloudflare Tunnel
function startTunnel() {
  const exePath = path.join(PROJECT_ROOT, os.platform() === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  if (!fs.existsSync(exePath)) {
    logInfo('cloudflared belum ditemukan. Menjalankan tunnel.bat untuk download otomatis...');
    if (os.platform() === 'win32') {
      execSync('tunnel.bat', { stdio: 'inherit' });
      return;
    }
  }
  logInfo('Menjalankan Cloudflare Tunnel ke port 3000...');
  logInfo('Salin link https://xxxx.trycloudflare.com yang muncul di bawah:\n');
  const p = spawn(exePath, ['tunnel', '--url', 'http://localhost:3000'], { stdio: 'inherit' });
  process.on('SIGINT', () => {
    p.kill();
    process.exit(0);
  });
}

// Show Menu TUI
function showInteractiveMenu() {
  const status = getServerStatus();
  const statusText = status.running
    ? `${colors.green}● RUNNING${colors.reset} (${status.mode}, Port: 3000${status.pid ? ', PID: ' + status.pid : ''})`
    : `${colors.red}○ STOPPED${colors.reset}`;

  console.clear();
  console.log(colors.cyan + colors.bright + '╔═══════════════════════════════════════════════════════════╗' + colors.reset);
  console.log(colors.cyan + colors.bright + '║            📊 TRADE JOURNAL MANAGER (CLI)                 ║' + colors.reset);
  console.log(colors.cyan + colors.bright + '╚═══════════════════════════════════════════════════════════╝' + colors.reset);
  console.log(` Status Server: ${statusText}\n`);

  console.log(`${colors.white}[1]${colors.reset} 🚀 ${colors.bright}Start Server (Production)${colors.reset}`);
  console.log(`${colors.white}[2]${colors.reset} 🛠️  Start Server (Dev / Turbopack)`);
  console.log(`${colors.white}[3]${colors.reset} ⏹️  Stop Server`);
  console.log(`${colors.white}[4]${colors.reset} 🔄 Restart Server`);
  console.log(`${colors.white}[5]${colors.reset} ⬇️  ${colors.green}${colors.bright}Update / Upgrade dari GitHub (Git Pull + Rebuild)${colors.reset}`);
  console.log(`${colors.white}[6]${colors.reset} 🔨 Build Aplikasi Manual (pnpm build)`);
  console.log(`${colors.white}[7]${colors.reset} 💾 Backup Database`);
  console.log(`${colors.white}[8]${colors.reset} ♻️  Restore Database`);
  console.log(`${colors.white}[9]${colors.reset} 📜 Lihat Log Server`);
  console.log(`${colors.white}[T]${colors.reset} 🌐 ${colors.cyan}${colors.bright}Buka Public Tunnel (Cloudflare - untuk MT4 VPS)${colors.reset}`);
  console.log(`${colors.white}[0]${colors.reset} ❌ Keluar\n`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question('Pilih nomor menu: ', (choice) => {
    rl.close();
    switch (choice.trim().toUpperCase()) {
      case 'T':
      case '10':
        startTunnel();
        break;
      case '1':
        startServer();
        break;
      case '2':
        startDev();
        break;
      case '3':
        stopServer();
        break;
      case '4':
        stopServer();
        setTimeout(startServer, 1000);
        break;
      case '5':
        updateFromGithub();
        break;
      case '6':
        buildApp();
        break;
      case '7':
        backupDb();
        break;
      case '8':
        restoreDb();
        break;
      case '9':
        viewLogs();
        break;
      case '0':
        logInfo('Keluar.');
        process.exit(0);
        break;
      default:
        logWarn('Pilihan tidak valid.');
        setTimeout(showInteractiveMenu, 1000);
        break;
    }
  });
}

// CLI Argument Handler
const args = process.argv.slice(2);
const command = args[0]?.toLowerCase();

switch (command) {
  case 'start':
    startServer();
    break;
  case 'dev':
    startDev();
    break;
  case 'stop':
    stopServer();
    break;
  case 'restart':
    stopServer();
    setTimeout(startServer, 1000);
    break;
  case 'update':
  case 'upgrade':
  case 'pull':
    updateFromGithub();
    break;
  case 'build':
    buildApp();
    break;
  case 'backup':
    backupDb();
    break;
  case 'restore':
    restoreDb();
    break;
  case 'logs':
  case 'log':
    viewLogs();
    break;
  case 'tunnel':
    startTunnel();
    break;
  case 'status': {
    const s = getServerStatus();
    if (s.running) {
      logSuccess(`Server RUNNING on http://localhost:3000 (Mode: ${s.mode}${s.pid ? ', PID: ' + s.pid : ''})`);
    } else {
      logWarn('Server STOPPED.');
    }
    break;
  }
  case 'help':
  case '--help':
  case '-h':
    console.log(`
Trade Journal CLI Commands:
  node journal.js               Buka Menu Interaktif
  node journal.js start         Jalankan server di background
  node journal.js dev           Jalankan server mode dev
  node journal.js stop          Hentikan server
  node journal.js restart       Restart server
  node journal.js update        Ambil update terbaru dari GitHub + rebuild otomatis
  node journal.js build         Build aplikasi
  node journal.js backup        Backup database SQLite
  node journal.js restore       Restore database dari backup
  node journal.js status        Lihat status server
  node journal.js logs          Lihat log aplikasi
    `);
    break;
  default:
    // If no argument provided, open interactive menu!
    showInteractiveMenu();
    break;
}
