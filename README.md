<div align="center">

<img src=".github/assets/banner.svg" alt="Trade Journal: the open-source trade journal" width="100%" />

<br/>

### 📊 Modern Open-Source Trade Journal & Analytics Platform
**Sinkronisasi Realtime MetaTrader 4 & 5 di Windows VPS / Server, Analisis Mendalam, Kalender P&L, Replay Transaksi, dan AI Reflection.**  
*Self-hosted, aman, database SQLite lokal, dan 100% gratis selamanya.*

[![GitHub](https://img.shields.io/badge/GitHub-princevalerie%2FTrade__Journal-blue?logo=github)](https://github.com/princevalerie/Trade_Journal)
[![Node](https://img.shields.io/badge/node-%3E%3D22.0.0-green.svg)](https://nodejs.org)
[![pnpm](https://img.shields.io/badge/pnpm-11.0.8-orange.svg)](https://pnpm.io)
[![Windows VPS Ready](https://img.shields.io/badge/Windows%20VPS-Tested%20%26%20Ready-0078D6?logo=windows)](https://github.com/princevalerie/Trade_Journal)
[![License](https://img.shields.io/badge/license-MIT-white.svg)](LICENSE)

---

[Instalasi Windows VPS](#-1-panduan-instalasi-di-windows-vps-rekomendasi) · [Penggunaan CLI Windows](#-2-penggunaan-cli-manager-di-windows-vps) · [Update 1-Klik](#-3-cara-update-otomatis-dari-github-1-perintah) · [Sinkronisasi MT4 & MT5](#-5-sinkronisasi-metatrader-4--metatrader-5-di-vps) · [Auto-Start 24/7](#-4-menjalankan-server-247-auto-start-saat-windows-vps-reboot) · [Akses dari HP/Laptop](#-6-cara-mengakses-dashboard-dari-hplaptop-rumah)

</div>

---

<img src=".github/assets/screenshot-dashboard.png" alt="Trade Journal dashboard in dark mode" width="100%" />

---

## ⚡ Kebutuhan Sistem (Windows VPS / Server)

Sebelum memulai di Windows VPS Anda (Windows Server 2016/2019/2022 atau Windows 10/11), pastikan software gratis berikut sudah terpasang:

1. **Node.js (Versi 22 LTS)**: Unduh dan install dari website resmi 👉 **[nodejs.org](https://nodejs.org)** *(pilih versi LTS 64-bit .msi, saat instalasi klik Next hingga selesai)*.
2. **Git for Windows**: Unduh dan install dari 👉 **[git-scm.com](https://git-scm.com/download/win)** *(klik Next hingga selesai)*.

---

## 🚀 1. Panduan Instalasi di Windows VPS (Rekomendasi)

Karena terminal MetaTrader (MT4 & MT5) berjalan di Windows, menjalankan Trade Journal di **Windows VPS yang sama** adalah setup yang paling ideal, cepat, dan stabil!

### Langkah 1: Buka PowerShell / Command Prompt (CMD) di Windows VPS
Klik tombol **Start**, ketik `powershell` atau `cmd`, lalu tekan **Enter**.

### Langkah 2: Install pnpm & PM2
Ketik perintah berikut lalu tekan Enter:
```cmd
npm install -g pnpm pm2
```

### Langkah 3: Clone Repository dari GitHub
Pilih folder tempat Anda ingin meletakkan aplikasi (misal di Desktop atau Drive `C:\`):
```cmd
cd /d C:\
git clone https://github.com/princevalerie/Trade_Journal.git
cd Trade_Journal
```

### Langkah 4: Install Dependencies & Build Aplikasi
```cmd
pnpm install
pnpm build
```

### Langkah 5: Jalankan Aplikasi!
Cukup jalankan:
```cmd
journal start
```
Atau cukup **Double-Click file `journal.bat`** di File Explorer Windows Anda! 🎉  
Buka browser di Windows VPS (Chrome/Edge), lalu buka alamat:  
👉 **`http://localhost:3000`**

---

## 💻 2. Penggunaan CLI Manager di Windows VPS

Untuk memudahkan Anda mengelola server tanpa perlu menghafal perintah yang rumit, aplikasi ini sudah menyediakan launcher otomatis:

### 🖱️ Cara 1: Double-Click (Paling Mudah)
Buka folder `Trade_Journal` di Windows File Explorer, lalu **Double-Click** file:
👉 **`journal.bat`**

Jendela Command Prompt interaktif yang rapi dan berwarna akan langsung muncul:

```text
╔═══════════════════════════════════════════════════════════╗
║            📊 TRADE JOURNAL MANAGER (CLI)                 ║
╚═══════════════════════════════════════════════════════════╝
 Status Server: ● RUNNING (Port: 3000, PID: 8524)

[1] 🚀 Start Server (Production)
[2] 🛠️  Start Server (Dev / Turbopack)
[3] ⏹️  Stop Server
[4] 🔄 Restart Server
[5] ⬇️  Update / Upgrade dari GitHub (Git Pull + Rebuild)  <-- UPDATE 1-KLIK
[6] 🔨 Build Aplikasi Manual (pnpm build)
[7] 💾 Backup Database
[8] ♻️  Restore Database
[9] 📜 Lihat Log Server
[0] ❌ Keluar

Pilih nomor menu [0-9]:
```
*Tinggal ketik angka pilihan Anda (misal ketik `1` lalu Enter untuk start, atau `5` untuk update).*

---

### ⌨️ Cara 2: Perintah Langsung via CMD / PowerShell
Buka CMD di folder project, Anda bisa mengetik perintah langsung:

| Perintah Windows | Fungsi |
| :--- | :--- |
| `journal` *(atau `node journal.js`)* | Buka **Menu Interaktif** |
| `journal start` | Jalankan server di background (Production) |
| `journal stop` | Matikan server |
| `journal restart` | Restart server |
| `journal update` | **Tarik update terbaru dari GitHub** + Rebuild + Auto-Restart |
| `journal status` | Cek apakah server aktif, port berapa, dan PID berapa |
| `journal logs` | Lihat log aktivitas server secara realtime |
| `journal backup` | Backup database SQLite ke folder `backups/` |
| `journal restore` | Kembalikan data dari file backup |

---

## 🔄 3. Cara Update Otomatis dari GitHub (1 Perintah)

Jika Anda melakukan perubahan kode di laptop/PC lokal lalu melakukan `git push` ke GitHub, cara mengupdate di Windows VPS sangat mudah:

Cukup buka CMD di folder project lalu ketik:
```cmd
journal update
```
*(atau **Double-click `journal.bat`**, lalu pilih nomor **5**)*

### ⚙️ Apa yang terjadi secara otomatis?
1. 💾 **Auto-Backup Database:** Database SQLite (`journal.db`) Anda otomatis dicadangkan ke folder `backups/` agar riwayat transaksi aman 100%.
2. ⬇️ **Git Pull:** Otomatis mengambil kode terbaru dari GitHub.
3. 📦 **Pnpm Install:** Otomatis mengupdate library baru jika ada.
4. 🔨 **Pnpm Build:** Otomatis mengompilasi ulang Next.js.
5. 🔄 **Auto-Restart:** Server otomatis me-restart ke versi terbaru tanpa mematikan data trading Anda.

---

## 🛡️ 4. Menjalankan Server 24/7 (Auto-Start saat Windows VPS Reboot)

VPS Windows terkadang restart otomatis (misalnya setelah update Windows otomatis). Agar Trade Journal **langsung otomatis menyala kembali saat Windows VPS boot/login**, pilih salah satu cara mudah berikut:

### Opsi A: Menggunakan Folder Windows Startup (Paling Simpel & Cepat)
1. Di Windows VPS, tekan tombol keyboard **`Windows + R`**.
2. Ketik **`shell:startup`** lalu klik **OK**. Folder *Startup* Windows akan terbuka.
3. Buka folder `Trade_Journal`, klik kanan pada file **`journal.bat`** -> pilih **Create shortcut** (Buat pintasan).
4. Pindahkan file shortcut tersebut ke dalam folder **Startup** yang terbuka tadi.
5. Selesai! Setiap kali Windows VPS menyala/reboot, server Trade Journal akan langsung otomatis berjalan di background.

### Opsi B: Menggunakan PM2
Buka PowerShell / CMD sebagai Administrator:
```cmd
# Jalankan via PM2
pm2 start "pnpm start" --name "trade-journal"

# Simpan state proses
pm2 save
```

---

## 🤖 5. Sinkronisasi MetaTrader 4 & MetaTrader 5 di VPS

Karena Trade Journal dan MetaTrader berada di **satu Windows VPS yang sama**, koneksinya super cepat dan tidak butuh kuota internet!

### A. Pengaturan di MetaTrader 5 (MT5):
1. Salin file `scripts/mt5/TradeJournalSync.mq5` ke folder:  
   `C:\Users\<Username>\AppData\Roaming\MetaQuotes\Terminal\<INSTANCE_ID>\MQL5\Experts\`
2. Buka MetaEditor di MT5, buka file tersebut lalu tekan **`F7`** (Compile).
3. Di terminal MT5, klik menu **Tools** -> **Options** -> tab **Expert Advisors**:
   - Centang **"Allow algorithmic trading"**.
   - Centang **"Allow WebRequest for listed URL"**, lalu tambahkan URL:
     ```text
     http://127.0.0.1:3000
     ```
4. Drag/pasang Expert Advisor `TradeJournalSync` ke salah satu chart apapun (misal EURUSD M1).
5. Pada tab Inputs:
   - `InpApiUrl`: `http://127.0.0.1:3000/api/webhooks/mt5`
   - `InpApiKey`: Kosongkan (atau isi sesuai `MT_WEBHOOK_SECRET` Anda).
6. Selesai! Semua transaksi yang ada dan transaksi baru otomatis tersinkron ke dashboard.

---

### B. Pengaturan di MetaTrader 4 (MT4):
1. Salin file `scripts/mt4/TradeJournalSync.mq4` ke folder `MQL4/Experts/` terminal MT4 Anda, lalu compile (`F7`).
2. Di MT4, buka menu **Tools** -> **Options** -> tab **Expert Advisors**:
   - Centang **"Allow WebRequest for listed URL"**, lalu masukkan:
     ```text
     http://127.0.0.1
     ```
3. *Catatan Port MT4:* WebRequest MT4 secara default membatasi port non-standar dan menyukai port 80. Cukup jalankan proxy bawaan di terminal Windows VPS Anda:
   ```cmd
   node scripts/mt4-proxy.js
   ```
4. Pasang `TradeJournalSync` di chart MT4 dengan `InpApiUrl`: `http://127.0.0.1/api/webhooks/mt4`.

---

### C. Pengelompokan EA Cerdas (Magic Number):
Aplikasi ini secara otomatis mengenali dan menyatukan seluruh transaksi dari satu robot EA meskipun komentar ordernya berbeda (misal `Scalp_Buy` & `Scalp_Sell`):
- Pilihan filter di UI akan menampilkan format: **`MagicNumber#namakomentar1#namakomentar2`** (contoh: `20260919#HullMA Long v2#PPT_HullATR`).
- Filter murni berfokus pada **Magic Number**, sehingga 100% transaksi dari EA tersebut tercatat sebagai satu kesatuan performa yang akurat.

---

## 📱 6. Cara Mengakses Dashboard dari HP/Laptop Rumah

Jika Trade Journal berjalan di Windows VPS dan Anda ingin membukanya dari browser HP atau laptop di rumah, gunakan **Cloudflare Tunnel (100% Gratis & Sangat Aman)**:

1. Unduh `cloudflared-windows-amd64.msi` di Windows VPS dari GitHub Cloudflare: 👉 [cloudflared releases](https://github.com/cloudflare/cloudflared/releases).
2. Buka Command Prompt di Windows VPS, lalu jalankan:
   ```cmd
   cloudflared tunnel --url http://localhost:3000
   ```
3. Anda akan mendapatkan URL HTTPS gratis resmi (contoh: `https://xxxx-xxxx.trycloudflare.com`).
4. Buka URL tersebut dari browser HP atau laptop Anda di rumah untuk memantau jurnal trading Anda kapan saja dan di mana saja!

---

## 🐧 7. Panduan untuk Linux VPS (Ubuntu / Debian)

Jika Anda menggunakan VPS Linux, langkahnya sama persis:
```bash
# Clone & install
git clone https://github.com/princevalerie/Trade_Journal.git
cd Trade_Journal
chmod +x journal.sh
pnpm install && pnpm build

# Buka menu CLI Linux
./journal.sh

# Update otomatis dari GitHub
node journal.js update
```

---

## ❓ 8. Troubleshooting & FAQ

#### Q: Di Windows VPS muncul pesan `node: command not found`?
Pastikan Anda sudah menginstall Node.js dari [nodejs.org](https://nodejs.org). Setelah install selesai, **tutup semua jendela CMD/PowerShell** lalu buka kembali agar perintah `node` dan `pnpm` dikenali.

#### Q: Bagaimana cara melihat log server jika web tidak terbuka?
Buka CMD di folder project lalu ketik:
```cmd
journal logs
```
Atau double click `journal.bat` lalu pilih menu nomor **[9]**.

#### Q: Data trade aman saat saya menjalankan `journal update`?
**Sangat aman!** Script update otomatis menyalin file database SQLite (`journal.db`) Anda ke folder `backups/` dengan penamaan tanggal dan jam sebelum melakukan pull dari GitHub.

---

<div align="center">

**Trade Journal Community Edition**  
*Dikelola dan dikembangkan untuk komunitas trader Indonesia & Global.*

</div>
