# SimTrader Pro — Live BTC Algorithmic Trading Terminal (Golang + TypeScript)

Arsitektur Fullstack **Server-Ready Algorithmic Trading System** yang memisahkan mesin komputasi kuantitatif di sisi **Backend (Golang)** dengan antarmuka visual reaktif di sisi **Frontend (React + TypeScript + TradingView Lightweight Charts)**.

---

## Fitur Utama & Hasil Audit 3 Tahap
1. **Weighted Predictive Scoring Engine (Ambang Eksekusi 65%)**:
   - **Komponen 1 — Momentum & Konvergensi MA 50/200 (Maks 35 Poin)**: Deteksi *Pre-Cross* (jemput bawah/atas) dan *Dynamic MA Bounce* dengan simetri titik nol ($D_t = 0$).
   - **Komponen 2 — Responsivitas EMA 20 (Maks 25 Poin)**: Inisialisasi *seed* SMA-20 yang presisi dan filter *Anti-FOMO* saat deviasi harga melewati $2.2\% \times M_{\text{tf}}$.
   - **Komponen 3 — Pemetaan Non-Linear RSI 14 (Maks 25 Poin / Penalti -15 Poin)**: Akselerasi momentum 2-candle ($\Delta\text{RSI}_t$), proteksi pasar datar (*flat-market division by zero guard*), dan penalti zona jenuh.
   - **Komponen 4 — Validasi Volume & Anti-Fakeout (Maks 15 Poin / Penalti -10 Poin)**: Proteksi pergantian *candle* baru menggunakan $\max(V_t, V_{t-1})$ terhadap rata-rata 10 *candle* tertutup sebelumnya (`t-2` s/d `t-11`), rasio $\text{RVOL} \ge 1.15\times$, dan *Close Location Value* ($\text{CLV}$).
2. **Aliran Data Independen (Independent Dual Data Streams)**:
   - *Timeframe* analisis bot di server berjalan secara mandiri sesuai konfigurasi bot tanpa terganggu oleh pergantian *timeframe* grafik yang sedang dilihat pengguna di layar *Market*.
3. **Akuntansi Presisi Tingkat Satuan Rupiah (Stage-3 Audited Accounting)**:
   - Pemisahan biaya pembukaan (*Entry Fee* 0.05%) dan penutupan (*Exit Fee* 0.05%), validasi harga *Stop Loss* terhadap harga Likuidasi, serta penguncian perubahan saldo saat masih ada posisi terbuka.
4. **Penyimpanan Persisten Otomatis (`backend/data/state.json`)**:
   - Seluruh saldo, konfigurasi bot, posisi aktif, dan *History Trade* (baik Manual maupun Bot) tersimpan otomatis di server sehingga bot tetap berjalan 24/7 meskipun *browser* atau laptop dimatikan.

---

## Struktur Direktori Proyek
```text
SimTrader-Pro/
├── README.md
├── docker-compose.yml
├── start-windows.bat
├── backend/
│   ├── go.mod
│   ├── main.go
│   ├── data/
│   │   └── state.json
│   └── internal/
│       ├── models/
│       │   └── types.go
│       ├── engine/
│       │   ├── indicators.go
│       │   ├── scoring.go
│       │   └── accounting.go
│       └── bot/
│           └── manager.go
└── frontend/
    ├── package.json
    ├── tsconfig.json
    ├── tsconfig.node.json
    ├── vite.config.ts
    ├── index.html
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── types/
        │   └── trading.ts
        └── utils/
            └── formatters.ts
```

---

## Cara Menjalankan di Windows (Lokal)

### Prasyarat:
1. Install **Go (Golang)** versi 1.21 ke atas: [https://go.dev/dl/](https://go.dev/dl/)
2. Install **Node.js (LTS)** versi 18 ke atas: [https://nodejs.org/](https://nodejs.org/)

### Langkah Eksekusi Cepat (1x Klik):
Klik ganda file **`start-windows.bat`** di folder utama. Skrip akan otomatis:
1. Mengunduh modul Golang (`go mod tidy`) dan menyalakan server Backend di `http://localhost:8080`.
2. Mengunduh paket Frontend (`npm install`) dan menyalakan antarmuka Web di `http://localhost:5173`.

### Langkah Eksekusi Manual melalui Terminal:
1. **Jalankan Backend Golang**:
   ```bash
   cd backend
   go mod tidy
   go run main.go
   ```
2. **Jalankan Frontend TypeScript** (buka terminal baru):
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
3. Buka browser dan akses **`http://localhost:5173`**.
