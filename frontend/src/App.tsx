import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createChart, IChartApi, ISeriesApi, LineData, Time } from 'lightweight-charts';
import {
  Activity,
  Bot,
  History,
  Settings,
  TrendingUp,
  TrendingDown,
  Play,
  Square,
  Sliders,
  Trash2,
  ShieldCheck,
  Wallet,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import {
  BotConfig,
  Candle,
  LiveSnapshot,
} from './types/trading';
import {
  calculateLivePositionAccounting,
  formatIdr,
  formatSignedIdr,
  formatUsdt,
} from './utils/formatters';

type ActiveTab = 'market' | 'bot' | 'history' | 'config';

const API_BASE = 'http://localhost:8080/api';

function computeSMA(candles: Candle[], period: number): LineData[] {
  const result: LineData[] = [];
  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += candles[i - j].close;
    }
    result.push({
      time: candles[i].time as Time,
      value: sum / period,
    });
  }
  return result;
}

function computeEMA(candles: Candle[], period: number): LineData[] {
  const result: LineData[] = [];
  if (candles.length < period) return result;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += candles[i].close;
  let prevEma = sum / period;
  result.push({ time: candles[period - 1].time as Time, value: prevEma });
  const k = 2 / (period + 1);
  for (let i = period; i < candles.length; i++) {
    const ema = (candles[i].close - prevEma) * k + prevEma;
    result.push({ time: candles[i].time as Time, value: ema });
    prevEma = ema;
  }
  return result;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('market');
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const [chartTimeframe, setChartTimeframe] = useState<string>('15m');
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'reconnecting'>('reconnecting');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Form Order Manual
  const [orderSide, setOrderSide] = useState<'LONG' | 'SHORT'>('LONG');
  const [manualMarginIdr, setManualMarginIdr] = useState<string>('1000000');
  const [manualLeverage, setManualLeverage] = useState<number>(10);
  const [manualTpPrice, setManualTpPrice] = useState<string>('');
  const [manualSlPrice, setManualSlPrice] = useState<string>('');

  // Modal Konfigurasi Bot (State Terisolasi agar tombol Batal tidak membocorkan state - Hasil Audit Tahap 1)
  const [isBotModalOpen, setIsBotModalOpen] = useState<boolean>(false);
  const [draftBotConfig, setDraftBotConfig] = useState<BotConfig>({
    pair: 'BTC/USDT',
    timeframe: '15m',
    leverage: 10,
    marginPercent: 10,
    takeProfitPercent: 15,
    stopLossPercent: 10,
    maxPositions: 1,
    thresholdScore: 65,
  });

  // Form Konfigurasi Saldo Sistem
  const [configBalanceInput, setConfigBalanceInput] = useState<string>('100000000');
  const [configUsdtRateInput, setConfigUsdtRateInput] = useState<string>('16000');

  // Referensi Chart TradingView
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartApiRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const ma50SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ma200SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ema20SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  const showNotice = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  // Inisialisasi & Koneksi Real-Time SSE ke Golang Backend
  useEffect(() => {
    fetch(`${API_BASE}/snapshot`)
      .then((res) => res.json())
      .then((data: LiveSnapshot) => {
        setSnapshot(data);
        setDraftBotConfig(data.state.botConfig);
        setConfigBalanceInput(String(Math.round(data.state.idrBalance)));
        setConfigUsdtRateInput(String(Math.round(data.state.usdtRate)));
        setConnectionStatus('connected');
      })
      .catch(() => setConnectionStatus('reconnecting'));

    const evtSource = new EventSource(`${API_BASE}/stream`);
    evtSource.onmessage = (event) => {
      try {
        const data: LiveSnapshot = JSON.parse(event.data);
        setSnapshot(data);
        setConnectionStatus('connected');
      } catch {
        // Ignore parse error
      }
    };
    evtSource.onerror = () => {
      setConnectionStatus('reconnecting');
    };

    return () => {
      evtSource.close();
    };
  }, []);

  // Inisialisasi TradingView Lightweight Charts + ResizeObserver (Hasil Audit Tahap 2)
  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: '#111827' },
        textColor: '#9ca3af',
      },
      grid: {
        vertLines: { color: '#1f2937' },
        horzLines: { color: '#1f2937' },
      },
      crosshair: { mode: 0 },
      rightPriceScale: { borderColor: '#374151' },
      timeScale: { borderColor: '#374151', timeVisible: true, secondsVisible: false },
      width: chartContainerRef.current.clientWidth,
      height: 440,
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#10b981',
      downColor: '#ef4444',
      borderUpColor: '#10b981',
      borderDownColor: '#ef4444',
      wickUpColor: '#10b981',
      wickDownColor: '#ef4444',
    });

    const ema20Series = chart.addLineSeries({
      color: '#38bdf8',
      lineWidth: 2,
      title: 'EMA 20',
    });
    const ma50Series = chart.addLineSeries({
      color: '#f59e0b',
      lineWidth: 2,
      title: 'MA 50',
    });
    const ma200Series = chart.addLineSeries({
      color: '#a855f7',
      lineWidth: 2,
      title: 'MA 200',
    });

    chartApiRef.current = chart;
    candleSeriesRef.current = candleSeries;
    ema20SeriesRef.current = ema20Series;
    ma50SeriesRef.current = ma50Series;
    ma200SeriesRef.current = ma200Series;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        chart.applyOptions({ width: entry.contentRect.width });
      }
    });
    resizeObserver.observe(chartContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, []);

  // Muat Candlestick Chart secara Independen dari Timeframe Bot (Hasil Pemisahan Stream)
  const loadChartCandles = useCallback(async (tf: string) => {
    try {
      const res = await fetch(`${API_BASE}/klines?interval=${tf}&limit=300`);
      const candles: Candle[] = await res.json();
      if (!Array.isArray(candles) || candles.length === 0 || !candleSeriesRef.current) return;

      candleSeriesRef.current.setData(
        candles.map((c) => ({
          time: c.time as Time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }))
      );
      ema20SeriesRef.current?.setData(computeEMA(candles, 20));
      ma50SeriesRef.current?.setData(computeSMA(candles, 50));
      ma200SeriesRef.current?.setData(computeSMA(candles, 200));
    } catch {
      // Abaikan jika sedang offline sementara
    }
  }, []);

  useEffect(() => {
    loadChartCandles(chartTimeframe);
    const interval = setInterval(() => loadChartCandles(chartTimeframe), 5000);
    return () => clearInterval(interval);
  }, [chartTimeframe, loadChartCandles]);

  // Handler Eksekusi Manual
  const handleOpenManualOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/positions/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          side: orderSide,
          marginIdr: Number(manualMarginIdr),
          leverage: Number(manualLeverage),
          tpPrice: manualTpPrice ? Number(manualTpPrice) : 0,
          slPrice: manualSlPrice ? Number(manualSlPrice) : 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal membuka posisi');
      setSnapshot(data);
      setManualTpPrice('');
      setManualSlPrice('');
      showNotice(`Posisi ${orderSide} Manual berhasil dibuka!`, 'success');
    } catch (err: any) {
      showNotice(err.message, 'error');
    }
  };

  // Handler Tutup Posisi
  const handleClosePosition = async (id: string) => {
    try {
      const res = await fetch(`${API_BASE}/positions/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menutup posisi');
      setSnapshot(data);
      showNotice('Posisi berhasil ditutup dan dicatat ke History Trade.', 'success');
    } catch (err: any) {
      showNotice(err.message, 'error');
    }
  };

  // Handler Toggle Bot
  const handleToggleBot = async () => {
    if (!snapshot) return;
    const nextStatus = !snapshot.state.botRunning;
    try {
      const res = await fetch(`${API_BASE}/bot/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ running: nextStatus }),
      });
      const data = await res.json();
      setSnapshot(data);
      showNotice(
        nextStatus
          ? `Bot Trading Diaktifkan pada Timeframe ${data.state.botConfig.timeframe}!`
          : 'Bot Trading Dihentikan (Standby).',
        'success'
      );
    } catch (err: any) {
      showNotice(err.message, 'error');
    }
  };

  // Handler Simpan Konfigurasi Bot
  const handleSaveBotConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/bot/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draftBotConfig),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal menyimpan konfigurasi bot');
      setSnapshot(data);
      setIsBotModalOpen(false);
      showNotice(`Konfigurasi Bot disimpan (Timeframe Bot: ${draftBotConfig.timeframe}).`, 'success');
    } catch (err: any) {
      showNotice(err.message, 'error');
    }
  };

  // Handler Simpan Saldo di Menu Konfigurasi
  const handleSaveBalanceConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_BASE}/config/balance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idrBalance: Number(configBalanceInput),
          usdtRate: Number(configUsdtRateInput),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gagal memperbarui saldo');
      setSnapshot(data);
      showNotice('Konfigurasi Saldo Simulasi & Kurs USDT berhasil diperbarui!', 'success');
    } catch (err: any) {
      showNotice(err.message, 'error');
    }
  };

  // Handler Bersihkan Riwayat
  const handleClearHistory = async () => {
    try {
      const res = await fetch(`${API_BASE}/history/clear`, { method: 'POST' });
      const data = await res.json();
      setSnapshot(data);
      showNotice('Seluruh riwayat perdagangan telah dibersihkan.', 'success');
    } catch (err: any) {
      showNotice(err.message, 'error');
    }
  };

  const currentPriceUsdt = snapshot?.currentPriceUsdt || 0;
  const currentPriceIdr = snapshot?.currentPriceIdr || 0;
  const state = snapshot?.state;
  const score = snapshot?.score;

  // Hitung total Unrealized PnL untuk Ekuitas Real-time
  const totalUnrealizedNetPnlIdr =
    state?.activePositions.reduce((acc, pos) => {
      const calc = calculateLivePositionAccounting(pos, currentPriceUsdt);
      return acc + calc.netPnlIdr;
    }, 0) || 0;

  const totalLockedMarginIdr =
    state?.activePositions.reduce((acc, pos) => acc + pos.marginIdr, 0) || 0;

  const totalEquityIdr = (state?.idrBalance || 0) + totalLockedMarginIdr + totalUnrealizedNetPnlIdr;

  return (
    <div className="min-h-screen flex flex-col bg-[#0b0f19] text-gray-100">
      {/* Notifikasi Toast */}
      {toast && (
        <div
          className={`fixed bottom-5 right-5 z-50 flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl border ${
            toast.type === 'success'
              ? 'bg-emerald-950/90 border-emerald-500/50 text-emerald-200'
              : 'bg-rose-950/90 border-rose-500/50 text-rose-200'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle className="w-5 h-5 text-rose-400 shrink-0" />
          )}
          <span className="text-sm font-medium">{toast.message}</span>
        </div>
      )}

      {/* Navbar Atas */}
      <header className="sticky top-0 z-30 bg-gray-900/90 backdrop-blur border-b border-gray-800 px-6 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4">
          {/* Brand & Status Server */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white shadow-lg shadow-indigo-600/30">
                ST
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-base tracking-tight text-white">
                    SimTrader Pro
                  </span>
                  <span className="text-[11px] font-mono uppercase px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                    Go + TS Engine
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      connectionStatus === 'connected'
                        ? 'bg-emerald-400 animate-pulse'
                        : 'bg-amber-400'
                    }`}
                  />
                  <span>
                    {connectionStatus === 'connected'
                      ? `Server Live (${snapshot?.serverTime || ''})`
                      : 'Menghubungkan ke Backend Go...'}
                  </span>
                </div>
              </div>
            </div>

            {/* Harga Live BTC/USDT */}
            <div className="hidden md:flex items-center gap-4 pl-4 border-l border-gray-800">
              <div>
                <div className="text-xs text-gray-400">BTC/USDT Live</div>
                <div className="font-mono font-bold text-lg text-white">
                  {formatUsdt(currentPriceUsdt)}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-400">Harga IDR</div>
                <div className="font-mono text-sm text-gray-200">
                  {formatIdr(currentPriceIdr)}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-400">24h Change</div>
                <div
                  className={`font-mono text-sm font-semibold ${
                    (snapshot?.priceChange24h || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {(snapshot?.priceChange24h || 0) >= 0 ? '+' : ''}
                  {(snapshot?.priceChange24h || 0).toFixed(2)}%
                </div>
              </div>
            </div>
          </div>

          {/* Menu Navigasi Utama */}
          <nav className="flex items-center gap-1 bg-gray-950/80 p-1 rounded-xl border border-gray-800">
            <button
              onClick={() => setActiveTab('market')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'market'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <Activity className="w-4 h-4" />
              Market
            </button>
            <button
              onClick={() => setActiveTab('bot')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'bot'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <Bot className="w-4 h-4" />
              Manajemen Bot
              {state?.botRunning && (
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
              )}
            </button>
            <button
              onClick={() => setActiveTab('history')}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'history'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <History className="w-4 h-4" />
              History Trade
              {state && state.tradeHistory.length > 0 && (
                <span className="px-1.5 py-0.2 text-xs rounded-full bg-gray-800 text-gray-300 font-mono">
                  {state.tradeHistory.length}
                </span>
              )}
            </button>
            <button
              onClick={() => {
                if (state) {
                  setConfigBalanceInput(String(Math.round(state.idrBalance)));
                  setConfigUsdtRateInput(String(Math.round(state.usdtRate)));
                }
                setActiveTab('config');
              }}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'config'
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <Settings className="w-4 h-4" />
              Konfigurasi
            </button>
          </nav>

          {/* Ringkasan Saldo Tersedia & Ekuitas */}
          <div className="flex items-center gap-4 bg-gray-950/90 px-4 py-2 rounded-xl border border-gray-800">
            <div>
              <div className="text-[11px] text-gray-400 uppercase">Saldo Tersedia</div>
              <div className="font-mono font-bold text-sm text-emerald-400">
                {formatIdr(state?.idrBalance || 0)}
              </div>
            </div>
            <div className="border-l border-gray-800 pl-4">
              <div className="text-[11px] text-gray-400 uppercase">Total Ekuitas</div>
              <div className="font-mono font-bold text-sm text-white">
                {formatIdr(totalEquityIdr)}
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Konten Halaman */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 space-y-6">
        {/* ===================================================================
            TAB 1: HALAMAN MARKET (CHART + FORM ORDER MANUAL + POSISI AKTIF)
           =================================================================== */}
        <div className={activeTab === 'market' ? 'space-y-6' : 'hidden'}>
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
            {/* Kolom Kiri (3/4): Grafik Candlestick Live */}
            <div className="lg:col-span-3 bg-gray-900 rounded-2xl border border-gray-800 p-4 flex flex-col justify-between">
              <div className="flex flex-wrap items-center justify-between gap-3 pb-3 mb-3 border-b border-gray-800">
                <div className="flex items-center gap-3">
                  <span className="font-bold text-white text-base">
                    Chart Visual BTC/USDT
                  </span>
                  <span className="text-xs px-2.5 py-1 rounded-md bg-gray-800 text-gray-300 font-mono">
                    Indikator: EMA 20 (Biru) • MA 50 (Kuning) • MA 200 (Ungu)
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-gray-400 mr-1">Timeframe Chart:</span>
                  {['1m', '5m', '15m', '1h', '4h', '1d'].map((tf) => (
                    <button
                      key={tf}
                      onClick={() => setChartTimeframe(tf)}
                      className={`px-2.5 py-1 rounded text-xs font-mono font-semibold transition ${
                        chartTimeframe === tf
                          ? 'bg-indigo-600 text-white'
                          : 'bg-gray-800 text-gray-400 hover:text-white'
                      }`}
                    >
                      {tf}
                    </button>
                  ))}
                </div>
              </div>

              <div ref={chartContainerRef} className="w-full h-[440px] rounded-lg overflow-hidden" />

              <div className="mt-3 pt-2 border-t border-gray-800/80 flex flex-wrap items-center justify-between text-xs text-gray-400">
                <span>
                  🔒 Stream Data Terpisah: Mengubah timeframe grafik di atas <b>tidak mengganggu</b> timeframe analisis Bot ({state?.botConfig.timeframe || '15m'}).
                </span>
                <span className="font-mono">
                  Skor Live Bot ({state?.botConfig.timeframe}): Long {score?.longScore || 0}% | Short {score?.shortScore || 0}%
                </span>
              </div>
            </div>

            {/* Kolom Kanan (1/4): Panel Eksekusi Manual Futures */}
            <div className="bg-gray-900 rounded-2xl border border-gray-800 p-5 flex flex-col justify-between">
              <form onSubmit={handleOpenManualOrder} className="space-y-4">
                <div className="flex items-center justify-between border-b border-gray-800 pb-3">
                  <h3 className="font-bold text-white text-base">Order Manual</h3>
                  <span className="text-xs font-mono text-gray-400">Fee 0.05%</span>
                </div>

                {/* Tombol Pilihan LONG / SHORT */}
                <div className="grid grid-cols-2 gap-2 p-1 bg-gray-950 rounded-xl border border-gray-800">
                  <button
                    type="button"
                    onClick={() => setOrderSide('LONG')}
                    className={`py-2 rounded-lg font-bold text-sm flex items-center justify-center gap-1.5 transition ${
                      orderSide === 'LONG'
                        ? 'bg-emerald-600 text-white shadow'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    <TrendingUp className="w-4 h-4" />
                    LONG
                  </button>
                  <button
                    type="button"
                    onClick={() => setOrderSide('SHORT')}
                    className={`py-2 rounded-lg font-bold text-sm flex items-center justify-center gap-1.5 transition ${
                      orderSide === 'SHORT'
                        ? 'bg-rose-600 text-white shadow'
                        : 'text-gray-400 hover:text-white'
                    }`}
                  >
                    <TrendingDown className="w-4 h-4" />
                    SHORT
                  </button>
                </div>

                {/* Input Margin IDR */}
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    Margin Modal (IDR)
                  </label>
                  <input
                    type="number"
                    min={10000}
                    step={10000}
                    value={manualMarginIdr}
                    onChange={(e) => setManualMarginIdr(e.target.value)}
                    className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3.5 py-2.5 text-sm font-mono text-white focus:outline-none focus:border-indigo-500"
                    required
                  />
                  <div className="grid grid-cols-4 gap-1.5 mt-2">
                    {[10, 25, 50, 100].map((pct) => (
                      <button
                        key={pct}
                        type="button"
                        onClick={() => {
                          if (!state) return;
                          const maxMargin = Math.floor(
                            (state.idrBalance * (pct / 100)) / (1 + manualLeverage * 0.0005)
                          );
                          setManualMarginIdr(String(Math.max(10000, maxMargin)));
                        }}
                        className="py-1 text-xs font-mono bg-gray-800 hover:bg-gray-700 text-gray-300 rounded"
                      >
                        {pct}%
                      </button>
                    ))}
                  </div>
                </div>

                {/* Slider Leverage */}
                <div>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-gray-400">Leverage</span>
                    <span className="font-mono font-bold text-indigo-400">
                      {manualLeverage}x
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={100}
                    value={manualLeverage}
                    onChange={(e) => setManualLeverage(Number(e.target.value))}
                    className="w-full accent-indigo-500"
                  />
                </div>

                {/* Input Opsional TP & SL dalam USDT */}
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Take Profit (USDT)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Opsional"
                      value={manualTpPrice}
                      onChange={(e) => setManualTpPrice(e.target.value)}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3 py-2 text-xs font-mono text-emerald-400 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">
                      Stop Loss (USDT)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="Opsional"
                      value={manualSlPrice}
                      onChange={(e) => setManualSlPrice(e.target.value)}
                      className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3 py-2 text-xs font-mono text-rose-400 focus:outline-none focus:border-rose-500"
                    />
                  </div>
                </div>

                {/* Ringkasan Kalkulasi Order */}
                <div className="bg-gray-950/90 p-3 rounded-xl border border-gray-800 space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-400">Ukuran Kontrak:</span>
                    <span className="font-mono text-white">
                      {formatIdr(Number(manualMarginIdr || 0) * manualLeverage)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-400">Biaya Masuk (0.05%):</span>
                    <span className="font-mono text-amber-400">
                      {formatIdr(Number(manualMarginIdr || 0) * manualLeverage * 0.0005)}
                    </span>
                  </div>
                </div>

                <button
                  type="submit"
                  className={`w-full py-3 rounded-xl font-bold text-sm text-white shadow-lg transition ${
                    orderSide === 'LONG'
                      ? 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/20'
                      : 'bg-rose-600 hover:bg-rose-500 shadow-rose-600/20'
                  }`}
                >
                  Eksekusi {orderSide} Sekarang
                </button>
              </form>
            </div>
          </div>

          {/* Tabel Posisi Terbuka (Menampilkan Posisi Manual & Bot Sekaligus) */}
          <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-white text-base">
                  Posisi Aktif Terbuka (Manual & Bot)
                </h3>
                <span className="px-2.5 py-0.5 text-xs font-mono rounded-full bg-indigo-500/20 text-indigo-300">
                  {state?.activePositions.length || 0} Posisi
                </span>
              </div>
              <div className="text-xs font-mono text-gray-400">
                Unrealized Net PnL:{' '}
                <span
                  className={
                    totalUnrealizedNetPnlIdr >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'
                  }
                >
                  {formatSignedIdr(totalUnrealizedNetPnlIdr)}
                </span>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-gray-950/70 text-gray-400 text-xs uppercase border-b border-gray-800">
                  <tr>
                    <th className="px-5 py-3.5">Sumber</th>
                    <th className="px-5 py-3.5">Posisi</th>
                    <th className="px-5 py-3.5">Harga Entry</th>
                    <th className="px-5 py-3.5">Harga Live</th>
                    <th className="px-5 py-3.5">Margin (Lev)</th>
                    <th className="px-5 py-3.5">Target TP / SL</th>
                    <th className="px-5 py-3.5">Harga Likuidasi</th>
                    <th className="px-5 py-3.5 text-right">Net P/L (ROI)</th>
                    <th className="px-5 py-3.5 text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {(!state || state.activePositions.length === 0) && (
                    <tr>
                      <td colSpan={9} className="text-center py-8 text-gray-500 italic">
                        Belum ada posisi terbuka saat ini.
                      </td>
                    </tr>
                  )}
                  {state?.activePositions.map((pos) => {
                    const acc = calculateLivePositionAccounting(pos, currentPriceUsdt);
                    const isProfit = acc.netPnlIdr >= 0;
                    return (
                      <tr key={pos.id} className="hover:bg-gray-800/40 transition">
                        <td className="px-5 py-4">
                          {pos.isBot ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                              <Bot className="w-3.5 h-3.5" /> Bot
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-semibold bg-sky-500/20 text-sky-300 border border-sky-500/30">
                              Manual
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-4 font-bold">
                          <span
                            className={
                              pos.side === 'LONG' ? 'text-emerald-400' : 'text-rose-400'
                            }
                          >
                            {pos.side}
                          </span>
                        </td>
                        <td className="px-5 py-4 font-mono text-gray-200">
                          <div>{formatUsdt(pos.entryPrice)}</div>
                          <div className="text-xs text-gray-500">
                            {formatIdr(pos.entryPriceIdr)}
                          </div>
                        </td>
                        <td className="px-5 py-4 font-mono text-gray-200">
                          <div>{formatUsdt(currentPriceUsdt)}</div>
                          <div className="text-xs text-gray-500">
                            {formatIdr(currentPriceIdr)}
                          </div>
                        </td>
                        <td className="px-5 py-4 font-mono">
                          <div className="text-white">{formatIdr(pos.marginIdr)}</div>
                          <div className="text-xs text-indigo-400">{pos.leverage}x Leverage</div>
                        </td>
                        <td className="px-5 py-4 font-mono text-xs">
                          <div className="text-emerald-400">
                            TP: {pos.tpPrice > 0 ? formatUsdt(pos.tpPrice) : '-'}
                          </div>
                          <div className="text-rose-400">
                            SL: {pos.slPrice > 0 ? formatUsdt(pos.slPrice) : '-'}
                          </div>
                        </td>
                        <td className="px-5 py-4 font-mono text-xs text-amber-400">
                          {formatUsdt(pos.liqPrice)}
                        </td>
                        <td className="px-5 py-4 text-right font-mono">
                          <div
                            className={`font-bold ${
                              isProfit ? 'text-emerald-400' : 'text-rose-400'
                            }`}
                          >
                            {formatSignedIdr(acc.netPnlIdr)}
                          </div>
                          <div
                            className={`text-xs ${
                              isProfit ? 'text-emerald-500' : 'text-rose-500'
                            }`}
                          >
                            ({isProfit ? '+' : ''}
                            {acc.roiPercent.toFixed(2)}%)
                          </div>
                        </td>
                        <td className="px-5 py-4 text-center">
                          <button
                            onClick={() => handleClosePosition(pos.id)}
                            className="px-3 py-1.5 rounded-lg bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white text-xs font-semibold transition"
                          >
                            Tutup Posisi
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* ===================================================================
            TAB 2: HALAMAN MANAJEMEN BOT (SCORING ENGINE 65% + LIVE BARS)
           =================================================================== */}
        <div className={activeTab === 'bot' ? 'space-y-6' : 'hidden'}>
          <div className="bg-gray-900 rounded-2xl border border-gray-800 p-6">
            <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-gray-800">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
                  <Bot className="w-7 h-7" />
                </div>
                <div>
                  <div className="flex items-center gap-2.5">
                    <h2 className="text-xl font-bold text-white">
                      Weighted Predictive Scoring Bot
                    </h2>
                    <span
                      className={`px-2.5 py-0.5 text-xs font-bold rounded-full ${
                        state?.botRunning
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                          : 'bg-gray-800 text-gray-400'
                      }`}
                    >
                      {state?.botRunning ? 'AKTIF (24/7 SERVER MODE)' : 'STANDBY'}
                    </span>
                    <span className="px-2.5 py-0.5 text-xs font-mono rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                      Timeframe Bot: {state?.botConfig.timeframe || '15m'} (M_tf ={' '}
                      {score?.multiplierTf || 0.4})
                    </span>
                  </div>
                  <p className="text-sm text-gray-400 mt-1">
                    {score?.signalSummary || 'Memantau konvergensi MA 50/200, EMA 20, RSI 14, dan RVOL...'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => {
                    if (state) setDraftBotConfig(state.botConfig);
                    setIsBotModalOpen(true);
                  }}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-200 text-sm font-medium transition"
                >
                  <Sliders className="w-4 h-4" />
                  Konfigurasi Parameter Bot
                </button>
                <button
                  onClick={handleToggleBot}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm text-white shadow-lg transition ${
                    state?.botRunning
                      ? 'bg-rose-600 hover:bg-rose-500 shadow-rose-600/20'
                      : 'bg-emerald-600 hover:bg-emerald-500 shadow-emerald-600/20'
                  }`}
                >
                  {state?.botRunning ? (
                    <>
                      <Square className="w-4 h-4" /> Hentikan Bot
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4" /> Jalankan Bot
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Statistik Kinerja Bot */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 my-6">
              <div className="bg-gray-950/80 p-4 rounded-xl border border-gray-800">
                <div className="text-xs text-gray-400">Total Profit Bersih Bot</div>
                <div
                  className={`text-lg font-mono font-bold mt-1 ${
                    (state?.botNetProfitIdr || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {formatSignedIdr(state?.botNetProfitIdr || 0)}
                </div>
              </div>
              <div className="bg-gray-950/80 p-4 rounded-xl border border-gray-800">
                <div className="text-xs text-gray-400">Win / Loss Ratio Bot</div>
                <div className="text-lg font-mono font-bold text-white mt-1">
                  <span className="text-emerald-400">{state?.botWinCount || 0}W</span> /{' '}
                  <span className="text-rose-400">{state?.botLossCount || 0}L</span>
                </div>
              </div>
              <div className="bg-gray-950/80 p-4 rounded-xl border border-gray-800">
                <div className="text-xs text-gray-400">Target Auto TP / SL</div>
                <div className="text-lg font-mono font-bold text-white mt-1">
                  <span className="text-emerald-400">+{state?.botConfig.takeProfitPercent}%</span> /{' '}
                  <span className="text-rose-400">-{state?.botConfig.stopLossPercent}%</span>
                </div>
              </div>
              <div className="bg-gray-950/80 p-4 rounded-xl border border-gray-800">
                <div className="text-xs text-gray-400">Alokasi Margin & Leverage</div>
                <div className="text-lg font-mono font-bold text-indigo-400 mt-1">
                  {state?.botConfig.marginPercent}% Saldo • {state?.botConfig.leverage}x
                </div>
              </div>
            </div>

            {/* Live Probability Score Bars (Ambang Batas 65%) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-gray-950 p-5 rounded-2xl border border-gray-800">
              {/* Bar Probabilitas LONG */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-sm text-emerald-400 flex items-center gap-1.5">
                    <TrendingUp className="w-4 h-4" /> PROBABILITAS LONG
                  </span>
                  <span className="font-mono font-bold text-lg text-emerald-400">
                    {score?.longScore || 0}%{' '}
                    <span className="text-xs text-gray-500 font-normal">
                      / Target {state?.botConfig.thresholdScore || 65}%
                    </span>
                  </span>
                </div>
                <div className="w-full h-4 bg-gray-800 rounded-full overflow-hidden relative">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-600 to-emerald-400 transition-all duration-300"
                    style={{ width: `${Math.min(100, score?.longScore || 0)}%` }}
                  />
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-white/80"
                    style={{ left: `${state?.botConfig.thresholdScore || 65}%` }}
                    title="Ambang Eksekusi 65%"
                  />
                </div>
                <div className="grid grid-cols-4 gap-2 text-xs font-mono text-gray-400 pt-1">
                  <div className="bg-gray-900 p-2 rounded border border-gray-800">
                    <div>MA 50/200</div>
                    <div className="text-emerald-400 font-bold">{score?.maLong || 0}/35</div>
                  </div>
                  <div className="bg-gray-900 p-2 rounded border border-gray-800">
                    <div>EMA 20</div>
                    <div className="text-emerald-400 font-bold">{score?.emaLong || 0}/25</div>
                  </div>
                  <div className="bg-gray-900 p-2 rounded border border-gray-800">
                    <div>RSI 14</div>
                    <div className="text-emerald-400 font-bold">{score?.rsiLong || 0}/25</div>
                  </div>
                  <div className="bg-gray-900 p-2 rounded border border-gray-800">
                    <div>Volume</div>
                    <div className="text-emerald-400 font-bold">{score?.volLong || 0}/15</div>
                  </div>
                </div>
              </div>

              {/* Bar Probabilitas SHORT */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="font-bold text-sm text-rose-400 flex items-center gap-1.5">
                    <TrendingDown className="w-4 h-4" /> PROBABILITAS SHORT
                  </span>
                  <span className="font-mono font-bold text-lg text-rose-400">
                    {score?.shortScore || 0}%{' '}
                    <span className="text-xs text-gray-500 font-normal">
                      / Target {state?.botConfig.thresholdScore || 65}%
                    </span>
                  </span>
                </div>
                <div className="w-full h-4 bg-gray-800 rounded-full overflow-hidden relative">
                  <div
                    className="h-full bg-gradient-to-r from-rose-600 to-rose-400 transition-all duration-300"
                    style={{ width: `${Math.min(100, score?.shortScore || 0)}%` }}
                  />
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-white/80"
                    style={{ left: `${state?.botConfig.thresholdScore || 65}%` }}
                    title="Ambang Eksekusi 65%"
                  />
                </div>
                <div className="grid grid-cols-4 gap-2 text-xs font-mono text-gray-400 pt-1">
                  <div className="bg-gray-900 p-2 rounded border border-gray-800">
                    <div>MA 50/200</div>
                    <div className="text-rose-400 font-bold">{score?.maShort || 0}/35</div>
                  </div>
                  <div className="bg-gray-900 p-2 rounded border border-gray-800">
                    <div>EMA 20</div>
                    <div className="text-rose-400 font-bold">{score?.emaShort || 0}/25</div>
                  </div>
                  <div className="bg-gray-900 p-2 rounded border border-gray-800">
                    <div>RSI 14</div>
                    <div className="text-rose-400 font-bold">{score?.rsiShort || 0}/25</div>
                  </div>
                  <div className="bg-gray-900 p-2 rounded border border-gray-800">
                    <div>Volume</div>
                    <div className="text-rose-400 font-bold">{score?.volShort || 0}/15</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Telemetri Nilai Mentah Indikator di Server Golang */}
            <div className="mt-4 pt-4 border-t border-gray-800 flex flex-wrap items-center justify-between gap-3 text-xs font-mono text-gray-400">
              <span>MA50: ${score?.ma50 || 0}</span>
              <span>MA200: ${score?.ma200 || 0}</span>
              <span>EMA20: ${score?.ema20 || 0}</span>
              <span>RSI(14): {score?.rsi14 || 0}</span>
              <span>Effective RVOL: {score?.rvol || 0}x</span>
              <span>CLV: {score?.clv || 0}</span>
            </div>
          </div>
        </div>

        {/* ===================================================================
            TAB 3: HALAMAN HISTORY TRADE (MANUAL & BOT TRADING)
           =================================================================== */}
        <div className={activeTab === 'history' ? 'space-y-6' : 'hidden'}>
          <div className="flex flex-wrap justify-between items-center gap-4">
            <div>
              <h2 className="text-2xl font-bold text-white">
                Riwayat Perdagangan (History Trade)
              </h2>
              <p className="text-sm text-gray-400">
                Mencakup seluruh rekam jejak transaksi yang telah ditutup, baik dari eksekusi Manual maupun otomatis oleh Bot Trading.
              </p>
            </div>
            <button
              onClick={handleClearHistory}
              className="flex items-center gap-2 px-4 py-2 bg-rose-600/20 text-rose-400 hover:bg-rose-600 hover:text-white rounded-xl text-sm font-medium transition"
            >
              <Trash2 className="w-4 h-4" />
              Bersihkan Riwayat
            </button>
          </div>

          <div className="bg-gray-900 rounded-2xl border border-gray-800 overflow-hidden shadow-lg">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-gray-300">
                <thead className="text-xs uppercase bg-gray-950/70 text-gray-400 border-b border-gray-800">
                  <tr>
                    <th className="px-6 py-4">Waktu Penutupan</th>
                    <th className="px-6 py-4">Tipe / Eksekutor</th>
                    <th className="px-6 py-4">Pasangan</th>
                    <th className="px-6 py-4">Posisi</th>
                    <th className="px-6 py-4">Harga Entry</th>
                    <th className="px-6 py-4">Harga Close</th>
                    <th className="px-6 py-4 text-right">Net P/L (IDR)</th>
                    <th className="px-6 py-4 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {(!state || state.tradeHistory.length === 0) && (
                    <tr>
                      <td colSpan={8} className="text-center py-10 text-gray-500 italic">
                        Belum ada riwayat perdagangan yang ditutup.
                      </td>
                    </tr>
                  )}
                  {state?.tradeHistory.map((trade) => {
                    const isProfit = trade.pnlIdr >= 0;
                    return (
                      <tr key={trade.id} className="hover:bg-gray-800/40 transition">
                        <td className="px-6 py-4 whitespace-nowrap font-mono text-xs text-gray-400">
                          {trade.time}
                        </td>
                        <td className="px-6 py-4">
                          {trade.type === 'Bot Trading' ? (
                            <span className="inline-flex items-center gap-1.5 text-purple-400 font-semibold text-xs">
                              <Bot className="w-4 h-4" /> Bot Trading
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-sky-400 font-semibold text-xs">
                              Manual
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 font-medium text-white">
                          {trade.pair}{' '}
                          <span className="text-xs font-mono text-indigo-400">
                            ({trade.leverage}x)
                          </span>
                        </td>
                        <td
                          className={`px-6 py-4 font-bold ${
                            trade.side === 'LONG' ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          {trade.side}
                        </td>
                        <td className="px-6 py-4 font-mono">
                          <div>{formatUsdt(trade.entryPrice)}</div>
                          <div className="text-xs text-gray-500">
                            {formatIdr(trade.entryPriceIdr)}
                          </div>
                        </td>
                        <td className="px-6 py-4 font-mono">
                          <div>{formatUsdt(trade.closePrice)}</div>
                          <div className="text-xs text-gray-500">
                            {formatIdr(trade.closePriceIdr)}
                          </div>
                        </td>
                        <td
                          className={`px-6 py-4 text-right font-mono font-bold ${
                            isProfit ? 'text-emerald-400' : 'text-rose-400'
                          }`}
                        >
                          <div>{formatSignedIdr(trade.pnlIdr)}</div>
                          <div className="text-xs font-normal">
                            ({isProfit ? '+' : ''}
                            {trade.roiPercent.toFixed(2)}%)
                          </div>
                        </td>
                        <td className="px-6 py-4 text-center">
                          {trade.status === 'Take Profit' && (
                            <span className="px-2.5 py-1 bg-emerald-500/20 text-emerald-400 rounded-md text-xs font-bold">
                              TP Hit
                            </span>
                          )}
                          {trade.status === 'Stop Loss' && (
                            <span className="px-2.5 py-1 bg-rose-500/20 text-rose-400 rounded-md text-xs font-bold">
                              SL Hit
                            </span>
                          )}
                          {trade.status === 'Liquidated' && (
                            <span className="px-2.5 py-1 bg-amber-500/20 text-amber-400 rounded-md text-xs font-bold">
                              Liquidated
                            </span>
                          )}
                          {trade.status === 'Manual Close' && (
                            <span className="px-2.5 py-1 bg-gray-700/60 text-gray-300 rounded-md text-xs font-bold">
                              Manual Close
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* ===================================================================
            TAB 4: HALAMAN KONFIGURASI (PENGATURAN SALDO DINAMIS & KURS)
           =================================================================== */}
        <div className={activeTab === 'config' ? 'space-y-6' : 'hidden'}>
          <div className="max-w-2xl mx-auto bg-gray-900 rounded-2xl border border-gray-800 p-6 space-y-6">
            <div className="flex items-center gap-3 border-b border-gray-800 pb-4">
              <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400">
                <Wallet className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">
                  Konfigurasi Saldo & Akun Simulasi
                </h2>
                <p className="text-xs text-gray-400">
                  Atur jumlah modal simulasi (IDR) yang tersimpan secara persisten di Server Golang.
                </p>
              </div>
            </div>

            {state && state.activePositions.length > 0 && (
              <div className="p-4 rounded-xl bg-amber-950/60 border border-amber-500/40 text-amber-200 text-xs flex items-center gap-3">
                <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0" />
                <span>
                  Perubahan saldo dikunci sementara karena Anda masih memiliki{' '}
                  <b>{state.activePositions.length} posisi aktif terbuka</b>. Tutup posisi terlebih dahulu untuk mengatur ulang saldo.
                </span>
              </div>
            )}

            <form onSubmit={handleSaveBalanceConfig} className="space-y-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1.5">
                  Saldo Kas Tersedia (IDR)
                </label>
                <input
                  type="number"
                  min={100000}
                  step={100000}
                  value={configBalanceInput}
                  onChange={(e) => setConfigBalanceInput(e.target.value)}
                  disabled={Boolean(state && state.activePositions.length > 0)}
                  className="w-full bg-gray-950 border border-gray-800 rounded-xl px-4 py-3 text-base font-mono text-white focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                  required
                />
                <div className="flex flex-wrap gap-2 mt-2.5">
                  {[10000000, 50000000, 100000000, 500000000, 1000000000].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      disabled={Boolean(state && state.activePositions.length > 0)}
                      onClick={() => setConfigBalanceInput(String(preset))}
                      className="px-3 py-1.5 rounded-lg bg-gray-800 hover:bg-gray-700 text-xs font-mono text-gray-300 disabled:opacity-40"
                    >
                      {formatIdr(preset)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs text-gray-400 mb-1.5">
                  Kurs Konversi 1 USDT ke IDR
                </label>
                <input
                  type="number"
                  min={1000}
                  step={100}
                  value={configUsdtRateInput}
                  onChange={(e) => setConfigUsdtRateInput(e.target.value)}
                  disabled={Boolean(state && state.activePositions.length > 0)}
                  className="w-full bg-gray-950 border border-gray-800 rounded-xl px-4 py-3 text-base font-mono text-white focus:outline-none focus:border-indigo-500 disabled:opacity-50"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={Boolean(state && state.activePositions.length > 0)}
                className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 font-bold text-sm text-white shadow-lg shadow-indigo-600/20 transition flex items-center justify-center gap-2"
              >
                <RefreshCw className="w-4 h-4" />
                Simpan Perubahan Saldo ke Server
              </button>
            </form>
          </div>
        </div>
      </main>

      {/* Modal Popup Konfigurasi Parameter Bot */}
      {isBotModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-2xl max-w-lg w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-800 pb-3">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-indigo-400" />
                Konfigurasi Parameter Bot Trading
              </h3>
              <button
                onClick={() => setIsBotModalOpen(false)}
                className="text-gray-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveBotConfig} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    Timeframe Analisis Bot (Statis)
                  </label>
                  <select
                    value={draftBotConfig.timeframe}
                    onChange={(e) =>
                      setDraftBotConfig({ ...draftBotConfig, timeframe: e.target.value })
                    }
                    className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3 py-2.5 text-sm font-mono text-white"
                  >
                    <option value="1m">1 Menit (Scalping)</option>
                    <option value="5m">5 Menit</option>
                    <option value="15m">15 Menit (Default)</option>
                    <option value="1h">1 Jam (Intraday)</option>
                    <option value="4h">4 Jam (Swing)</option>
                    <option value="1d">1 Hari (Macro)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    Leverage Bot (1x - 100x)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={draftBotConfig.leverage}
                    onChange={(e) =>
                      setDraftBotConfig({
                        ...draftBotConfig,
                        leverage: Number(e.target.value),
                      })
                    }
                    className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3 py-2.5 text-sm font-mono text-white"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    Alokasi Margin per Order (% Saldo)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={95}
                    value={draftBotConfig.marginPercent}
                    onChange={(e) =>
                      setDraftBotConfig({
                        ...draftBotConfig,
                        marginPercent: Number(e.target.value),
                      })
                    }
                    className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3 py-2.5 text-sm font-mono text-white"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    Maksimal Posisi Bersamaan
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={draftBotConfig.maxPositions}
                    onChange={(e) =>
                      setDraftBotConfig({
                        ...draftBotConfig,
                        maxPositions: Number(e.target.value),
                      })
                    }
                    className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3 py-2.5 text-sm font-mono text-white"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    Target Take Profit ROI (%)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={500}
                    value={draftBotConfig.takeProfitPercent}
                    onChange={(e) =>
                      setDraftBotConfig({
                        ...draftBotConfig,
                        takeProfitPercent: Number(e.target.value),
                      })
                    }
                    className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3 py-2.5 text-sm font-mono text-emerald-400"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs text-gray-400 mb-1">
                    Batas Stop Loss ROI (%)
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={90}
                    value={draftBotConfig.stopLossPercent}
                    onChange={(e) =>
                      setDraftBotConfig({
                        ...draftBotConfig,
                        stopLossPercent: Number(e.target.value),
                      })
                    }
                    className="w-full bg-gray-950 border border-gray-800 rounded-xl px-3 py-2.5 text-sm font-mono text-rose-400"
                    required
                  />
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-gray-800">
                <button
                  type="button"
                  onClick={() => setIsBotModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm font-medium"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-bold"
                >
                  Simpan Konfigurasi
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
