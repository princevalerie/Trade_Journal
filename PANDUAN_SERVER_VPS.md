# 🪟 Panduan Lengkap Instalasi Windows VPS & Trade Journal CLI Manager

Panduan khusus untuk pengguna **Windows VPS** (Windows Server 2016/2019/2022 atau Windows 10/11) untuk menginstal, menjalankan 24/7, dan mengelola **Trade Journal** langsung dari GitHub dengan **CLI Manager**.

---

## 📋 Daftar Isi
1. [Persiapan Windows VPS](#1-persiapan-windows-vps)
2. [Langkah Instalasi Pertama Kali di Windows VPS](#2-langkah-instalasi-pertama-kali-di-windows-vps)
3. [Menggunakan Trade Journal CLI Manager di Windows](#3-menggunakan-trade-journal-cli-manager-di-windows)
4. [Cara Update Otomatis dari GitHub (1 Perintah)](#4-cara-update-otomatis-dari-github-1-perintah)
5. [Menjalankan Server 24/7 (Auto-Start saat Windows VPS Reboot)](#5-menjalankan-server-247-auto-start-saat-windows-vps-reboot)
6. [Koneksi Webhook MT4 & MT5 di Windows VPS](#6-koneksi-webhook-mt4--mt5-di-windows-vps)
7. [Cara Akses Dashboard dari HP / Laptop Rumah](#7-cara-akses-dashboard-dari-hp--laptop-rumah)

---

## 1. Persiapan Windows VPS

Sebelum memulai, pastikan dua aplikasi gratis berikut sudah terpasang di Windows VPS Anda:

1. **Node.js (Versi 22 LTS)**:
   - Buka browser di VPS, kunjungi 👉 **[nodejs.org](https://nodejs.org)**
   - Download installer Windows **LTS 64-bit** (.msi).
   - Jalankan installer, klik **Next** hingga selesai.
2. **Git for Windows**:
   - Download dari 👉 **[git-scm.com/download/win](https://git-scm.com/download/win)**
   - Jalankan installer, klik **Next** hingga selesai.

---

## 2. Langkah Instalasi Pertama Kali di Windows VPS

1. Buka **Command Prompt (CMD)** atau **PowerShell** di Windows VPS Anda.
2. Install **pnpm** dan **PM2** secara global:
   ```cmd
   npm install -g pnpm pm2
   ```
3. Pindah ke folder tempat Anda ingin menyimpan Trade Journal (contoh di drive `C:\`):
   ```cmd
   cd /d C:\
   git clone https://github.com/princevalerie/Trade_Journal.git
   cd Trade_Journal
   ```
4. Install library & build aplikasi:
   ```cmd
   pnpm install
   pnpm build
   ```
5. Jalankan server:
   ```cmd
   journal start
   ```
   Aplikasi sekarang aktif di **`http://localhost:3000`**!

---

## 3. Menggunakan Trade Journal CLI Manager di Windows

Di Windows VPS, Anda memiliki 2 cara mudah:

### 🖱️ Cara 1: Double-Click `journal.bat`
Cukup buka folder `Trade_Journal` di File Explorer Windows Anda, lalu **Double-Click file `journal.bat`**.

Menu interaktif akan langsung terbuka:
```text
╔═══════════════════════════════════════════════════════════╗
║            📊 TRADE JOURNAL MANAGER (CLI)                 ║
╚═══════════════════════════════════════════════════════════╝
 Status Server: ● RUNNING (Port: 3000, PID: 7412)

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

### ⌨️ Cara 2: Perintah Langsung via CMD / PowerShell
Buka CMD di folder project, Anda bisa mengetik perintah langsung:
- `journal start` : Menjalankan server di background
- `journal stop` : Mematikan server
- `journal restart` : Me-restart server
- `journal update` : **Update otomatis dari GitHub**
- `journal status` : Cek status server
- `journal logs` : Lihat log aktivitas server secara realtime
- `journal backup` : Backup database SQLite

---

## 4. Cara Update Otomatis dari GitHub (1 Perintah)

Jika Anda memperbarui kode di laptop lokal lalu push ke GitHub, untuk mengupdate aplikasi di Windows VPS:

Cukup buka CMD lalu ketik:
```cmd
journal update
```
*(atau **Double-click `journal.bat`**, lalu pilih nomor **5**)*

Script akan secara otomatis:
1. Mem-backup database saat ini ke folder `backups/`.
2. Menarik update terbaru dari GitHub (`git pull`).
3. Menginstall library baru (`pnpm install`).
4. Mengompilasi ulang Next.js (`pnpm build`).
5. Me-restart server ke versi terbaru secara otomatis!

---

## 5. Menjalankan Server 24/7 (Auto-Start saat Windows VPS Reboot)

Agar server Trade Journal selalu otomatis menyala kembali jika Windows VPS restart/reboot:

### Cara Praktis via Folder Startup Windows:
1. Tekan tombol **`Windows + R`** di keyboard VPS Anda.
2. Ketik **`shell:startup`** lalu klik **OK**. Folder *Startup* Windows akan terbuka.
3. Buka folder `Trade_Journal`, klik kanan pada file **`journal.bat`** -> pilih **Create shortcut** (Buat pintasan).
4. Pindahkan shortcut tersebut ke dalam folder **Startup** tadi.
5. Selesai! Setiap kali Windows VPS boot/login, Trade Journal otomatis langsung berjalan di background.

---

## 6. Koneksi Webhook MT4 & MT5 di Windows VPS

Karena MT4/MT5 dan Trade Journal berada di satu VPS Windows yang sama, koneksi sangat cepat dan efisien:

### MT5:
- Salin `scripts/mt5/TradeJournalSync.mq5` ke folder `MQL5/Experts/` terminal MT5 Anda lalu compile (`F7`).
- Di MT5, klik **Tools** -> **Options** -> **Expert Advisors**:
  - Centang **Allow algorithmic trading**.
  - Centang **Allow WebRequest for listed URL**, lalu tambahkan: `http://127.0.0.1:3000`
- Pasang EA di chart dengan input `InpApiUrl`: `http://127.0.0.1:3000/api/webhooks/mt5`.

### MT4:
- Salin `scripts/mt4/TradeJournalSync.mq4` ke folder `MQL4/Experts/` MT4 Anda lalu compile.
- Jalankan proxy MT4 port 80 di CMD: `node scripts/mt4-proxy.js`
- Masukkan URL `http://127.0.0.1` ke WebRequest MT4, dan arahkan input EA ke `http://127.0.0.1/api/webhooks/mt4`.

---

## 7. Cara Akses Dashboard dari HP / Laptop Rumah

Jika Anda ingin membuka dashboard Trade Journal dari HP atau laptop kantor tanpa membuka remote desktop VPS:

Gunakan **Cloudflare Tunnel (Gratis & Aman)**:
1. Unduh `cloudflared-windows-amd64.msi` di VPS dari 👉 [GitHub Cloudflare Releases](https://github.com/cloudflare/cloudflared/releases).
2. Di CMD VPS, jalankan:
   ```cmd
   cloudflared tunnel --url http://localhost:3000
   ```
3. Anda akan mendapatkan URL HTTPS gratis resmi (misal: `https://xxxx-xxxx.trycloudflare.com`).
4. Buka alamat tersebut dari browser HP atau laptop mana saja untuk melihat dashboard trading Anda secara realtime!
