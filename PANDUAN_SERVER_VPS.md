# 🚀 Panduan Instalasi Server / VPS & Trade Journal CLI Manager

Panduan lengkap untuk memindahkan, menginstal, dan mengelola **Trade Journal** di Server / VPS (Ubuntu, Debian, atau Windows Server) langsung dari GitHub, dilengkapi dengan **CLI Manager** interaktif.

---

## 📋 Daftar Isi
1. [Persiapan Server / VPS](#1-persiapan-server--vps)
2. [Langkah Instalasi Pertama Kali di Server](#2-langkah-instalasi-pertama-kali-di-server)
3. [Menggunakan Trade Journal CLI Manager](#3-menggunakan-trade-journal-cli-manager)
4. [Cara Update Aplikasi dari GitHub (1 Klik / 1 Perintah)](#4-cara-update-aplikasi-dari-github-1-perintah)
5. [Menjalankan Server 24/7 (Auto-Start saat VPS Reboot)](#5-menjalankan-server-247-auto-start-saat-vps-reboot)
6. [Koneksi Webhook MT4 & MT5 dari Server](#6-koneksi-webhook-mt4--mt5-dari-server)
7. [Daftar Perintah CLI Cheat-Sheet](#7-daftar-perintah-cli-cheat-sheet)

---

## 1. Persiapan Server / VPS

Pastikan Server atau VPS Anda sudah terpasang:
- **Node.js versi 22+**
- **Git**
- **pnpm** (versi 11+)

### Cara Install di Ubuntu / Debian:
```bash
# Update package list
sudo apt update && sudo apt upgrade -y

# Install Git & Curl
sudo apt install -y git curl

# Install Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# Verifikasi versi node & npm
node -v   # Harap pastikan v22.x.x
npm -v

# Install pnpm & PM2 secara global
sudo npm install -g pnpm pm2
```

---

## 2. Langkah Instalasi Pertama Kali di Server

Masuk ke direktori home atau folder web di server Anda (misal `/var/www` atau `~`):

```bash
# 1. Clone repository dari GitHub Anda
git clone <URL_REPOSITORY_GITHUB_ANDA> trade-journal

# 2. Masuk ke folder project
cd trade-journal

# 3. Berikan izin eksekusi ke file launcher (khusus Linux)
chmod +x journal.sh

# 4. Install dependencies
pnpm install

# 5. Build aplikasi pertama kali
pnpm build
```

---

## 3. Menggunakan Trade Journal CLI Manager

Kami telah menyediakan **CLI Manager** serbaguna yang bisa dibuka melalui menu interaktif atau perintah langsung.

### 🎮 Buka Menu Interaktif:
Di Linux / macOS:
```bash
./journal.sh
```
Atau di Windows / Linux menggunakan Node:
```bash
node journal.js
```
*(atau bisa juga `pnpm journal`)*

Tampilan Menu CLI:
```text
╔═══════════════════════════════════════════════════════════╗
║            📊 TRADE JOURNAL MANAGER (CLI)                 ║
╚═══════════════════════════════════════════════════════════╝
 Status Server: ● RUNNING (Port: 3000, PID: 12345)

[1] 🚀 Start Server (Production)
[2] 🛠️  Start Server (Dev / Turbopack)
[3] ⏹️  Stop Server
[4] 🔄 Restart Server
[5] ⬇️  Update / Upgrade dari GitHub (Git Pull + Rebuild)
[6] 🔨 Build Aplikasi Manual (pnpm build)
[7] 💾 Backup Database
[8] ♻️  Restore Database
[9] 📜 Lihat Log Server
[0] ❌ Keluar

Pilih nomor menu [0-9]:
```

---

## 4. Cara Update Aplikasi dari GitHub (1 Perintah)

Jika Anda telah melakukan commit atau update kode di komputer lokal lalu push ke GitHub, untuk mengupdate aplikasi di server Anda **TIDAK PERLU** repot-repot mengetik banyak perintah manual.

Cukup jalankan satu perintah berikut di terminal server:

```bash
node journal.js update
```
*(atau jalankan `./journal.sh`, lalu pilih menu **[5]**)*

### Apa yang otomatis dilakukan oleh perintah update?
1. 💾 **Auto-Backup:** Otomatis mem-backup database SQLite Anda saat ini ke folder `backups/` agar data aman.
2. ⬇️ **Git Pull:** Otomatis mengambil kode terbaru dari repositori GitHub (`git pull`).
3. 📦 **Install Dependencies:** Otomatis menjalankan `pnpm install` jika ada library baru.
4. 🔨 **Rebuild:** Otomatis mengompilasi ulang Next.js (`pnpm build`).
5. 🔄 **Auto-Restart:** Jika server sebelumnya sedang berjalan, server akan otomatis direstart dengan versi baru tanpa mematikan data trading Anda!

---

## 5. Menjalankan Server 24/7 (Auto-Start saat VPS Reboot)

Agar Trade Journal selalu menyala di server bahkan jika VPS mengalami restart atau crash, gunakan **PM2**:

### Menjalankan via CLI:
```bash
node journal.js start
```
*(CLI akan otomatis mendeteksi PM2 dan menjalankannya sebagai background service).*

### Mengaktifkan Auto-Start saat VPS Reboot:
```bash
# Simpan proses yang aktif di PM2
pm2 save

# Buat startup script untuk OS Linux
pm2 startup
# (Salin dan jalankan perintah yang dimunculkan oleh terminal jika ada)
```

Untuk memantau log aplikasi secara realtime:
```bash
node journal.js logs
# atau
pm2 logs trade-journal
```

---

## 6. Koneksi Webhook MT4 & MT5 dari Server

### Jika Trade Journal & MetaTrader berada di VPS yang SAMA:
- **MT5 Webhook URL:**
  ```text
  http://127.0.0.1:3000/api/webhooks/mt5
  ```
- **MT4 Webhook URL (Port 80 Proxy):**
  Jalankan proxy MT4:
  ```bash
  node scripts/mt4-proxy.js
  ```
  Lalu arahkan URL MT4 ke:
  ```text
  http://127.0.0.1/api/webhooks/mt4
  ```

### Jika MetaTrader berada di VPS LAIN atau di PC Rumah:
Gunakan salah satu dari cara berikut agar Webhook bisa diakses secara aman:
1. **Nginx Reverse Proxy dengan Domain & SSL Gratis (Certbot):**
   Arahkan domain/subdomain Anda (misal `journal.domainanda.com`) ke IP VPS, lalu pasang Nginx yang mem-forward ke port `3000`.
   - Webhook MT5: `https://journal.domainanda.com/api/webhooks/mt5`
   - Webhook MT4: `https://journal.domainanda.com/api/webhooks/mt4`
2. **Cloudflare Tunnel (Tanpa IP Publik / Port Forwarding):**
   Install Cloudflare Tunnel (`cloudflared`) di VPS untuk mendapatkan URL HTTPS resmi gratis.

---

## 7. Daftar Perintah CLI Cheat-Sheet

| Perintah | Deskripsi |
| :--- | :--- |
| `node journal.js` *(atau `./journal.sh`)* | Membuka **Menu Interaktif** CLI |
| `node journal.js start` | Menjalankan server di background (Production/PM2) |
| `node journal.js stop` | Menghentikan server |
| `node journal.js restart` | Me-restart server |
| `node journal.js update` | **Update otomatis dari GitHub** + Rebuild + Auto-Restart |
| `node journal.js status` | Memeriksa apakah server aktif dan di port berapa |
| `node journal.js logs` | Melihat log server secara realtime |
| `node journal.js backup` | Mem-backup database SQLite ke folder `backups/` |
| `node journal.js restore` | Me-restore database dari daftar backup yang tersedia |
| `node journal.js build` | Membangun/compile aplikasi Next.js secara manual |
| `node journal.js dev` | Menjalankan server dalam mode development |
| `node journal.js help` | Menampilkan panduan bantuan perintah |

---

*Selamat menggunakan Trade Journal di Server Anda! Jika ada pertanyaan atau kendala, silakan tanyakan langsung.*
