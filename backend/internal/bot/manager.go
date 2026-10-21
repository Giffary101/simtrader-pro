package bot

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"simtrader-pro/backend/internal/engine"
	"simtrader-pro/backend/internal/models"
	"strconv"
	"sync"
	"time"
)

type Manager struct {
	mu               sync.RWMutex
	StateFilePath    string
	State            models.PersistentState
	BotCandles       []models.Candle
	CurrentPriceUsdt float64
	PriceChange24h   float64
	High24h          float64
	Low24h           float64
	Volume24h        float64
	LatestScore      models.ScoreBreakdown
	httpClient       *http.Client
}

func NewManager(stateFilePath string) *Manager {
	m := &Manager{
		StateFilePath: stateFilePath,
		httpClient: &http.Client{
			Timeout: 8 * time.Second,
		},
	}
	m.loadState()
	return m
}

func (m *Manager) loadState() {
	m.mu.Lock()
	defer m.mu.Unlock()

	raw, err := os.ReadFile(m.StateFilePath)
	if err == nil {
		if err := json.Unmarshal(raw, &m.State); err == nil {
			if m.State.UsdtRate <= 0 {
				m.State.UsdtRate = 16000
			}
			if m.State.BotConfig.ThresholdScore <= 0 {
				m.State.BotConfig.ThresholdScore = 65
			}
			return
		}
	}

	// Default State jika file belum ada
	m.State = models.PersistentState{
		IdrBalance:      100000000,
		UsdtRate:        16000,
		BotRunning:      false,
		BotNetProfitIdr: 0,
		BotConfig: models.BotConfig{
			Pair:              "BTC/USDT",
			Timeframe:         "15m",
			Leverage:          10,
			MarginPercent:     10,
			TakeProfitPercent: 15,
			StopLossPercent:   10,
			MaxPositions:      1,
			ThresholdScore:    65,
		},
		ActivePositions: []models.Position{},
		TradeHistory:    []models.TradeHistoryItem{},
	}
	m.saveStateLocked()
}

func (m *Manager) saveStateLocked() {
	raw, err := json.MarshalIndent(m.State, "", "  ")
	if err != nil {
		log.Printf("[ERROR] Gagal serialisasi state: %v", err)
		return
	}
	_ = os.WriteFile(m.StateFilePath, raw, 0644)
}

// StartBackgroundLoop menjalankan mesin pengambilan data Binance dan evaluasi Bot 24/7.
func (m *Manager) StartBackgroundLoop() {
	// Muat data awal
	m.FetchTicker24h()
	m.FetchBotCandles(500)
	m.EvaluateTick()

	tickerFast := time.NewTicker(2 * time.Second)
	tickerCandles := time.NewTicker(5 * time.Second)

	go func() {
		for {
			select {
			case <-tickerFast.C:
				m.FetchTicker24h()
				m.EvaluateTick()
			case <-tickerCandles.C:
				m.FetchBotCandles(250)
				m.EvaluateTick()
			}
		}
	}()
}

// FetchTicker24h mengambil harga live BTCUSDT dan statistik 24 jam dari Binance.
func (m *Manager) FetchTicker24h() {
	resp, err := m.httpClient.Get("https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT")
	if err != nil {
		return
	}
	defer resp.Body.Close()

	var payload struct {
		LastPrice          string `json:"lastPrice"`
		PriceChangePercent string `json:"priceChangePercent"`
		HighPrice          string `json:"highPrice"`
		LowPrice           string `json:"lowPrice"`
		Volume             string `json:"volume"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return
	}

	lastPrice, _ := strconv.ParseFloat(payload.LastPrice, 64)
	changePct, _ := strconv.ParseFloat(payload.PriceChangePercent, 64)
	high24, _ := strconv.ParseFloat(payload.HighPrice, 64)
	low24, _ := strconv.ParseFloat(payload.LowPrice, 64)
	vol24, _ := strconv.ParseFloat(payload.Volume, 64)

	if lastPrice > 0 {
		m.mu.Lock()
		m.CurrentPriceUsdt = lastPrice
		m.PriceChange24h = changePct
		m.High24h = high24
		m.Low24h = low24
		m.Volume24h = vol24
		m.mu.Unlock()
	}
}

// FetchCandlesByTimeframe mengambil data candlestick historis dari Binance untuk chart maupun Bot.
func (m *Manager) FetchCandlesByTimeframe(tf string, limit int) ([]models.Candle, error) {
	url := fmt.Sprintf("https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=%s&limit=%d", tf, limit)
	resp, err := m.httpClient.Get(url)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}

	var raw [][]interface{}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, err
	}

	candles := make([]models.Candle, 0, len(raw))
	for _, k := range raw {
		if len(k) < 6 {
			continue
		}
		openTimeMs, _ := k[0].(float64)
		openStr, _ := k[1].(string)
		highStr, _ := k[2].(string)
		lowStr, _ := k[3].(string)
		closeStr, _ := k[4].(string)
		volStr, _ := k[5].(string)

		o, _ := strconv.ParseFloat(openStr, 64)
		h, _ := strconv.ParseFloat(highStr, 64)
		l, _ := strconv.ParseFloat(lowStr, 64)
		c, _ := strconv.ParseFloat(closeStr, 64)
		v, _ := strconv.ParseFloat(volStr, 64)

		candles = append(candles, models.Candle{
			Time:   int64(openTimeMs / 1000),
			Open:   o,
			High:   h,
			Low:    l,
			Close:  c,
			Volume: v,
		})
	}
	return candles, nil
}

// FetchBotCandles memperbarui memori independen botKlineData sesuai timeframe di BotConfig.
func (m *Manager) FetchBotCandles(limit int) {
	m.mu.RLock()
	tf := m.State.BotConfig.Timeframe
	m.mu.RUnlock()

	candles, err := m.FetchCandlesByTimeframe(tf, limit)
	if err != nil || len(candles) == 0 {
		return
	}

	m.mu.Lock()
	m.BotCandles = candles
	if m.CurrentPriceUsdt == 0 {
		m.CurrentPriceUsdt = candles[len(candles)-1].Close
	}
	m.mu.Unlock()
}

// EvaluateTick melakukan pengecekan TP/SL/Likuidasi pada seluruh posisi aktif dan menjalankan algoritma Bot.
func (m *Manager) EvaluateTick() {
	m.mu.Lock()
	defer m.mu.Unlock()

	if len(m.BotCandles) > 0 && m.CurrentPriceUsdt > 0 {
		lastIdx := len(m.BotCandles) - 1
		m.BotCandles[lastIdx].Close = m.CurrentPriceUsdt
		if m.CurrentPriceUsdt > m.BotCandles[lastIdx].High {
			m.BotCandles[lastIdx].High = m.CurrentPriceUsdt
		}
		if m.CurrentPriceUsdt < m.BotCandles[lastIdx].Low {
			m.BotCandles[lastIdx].Low = m.CurrentPriceUsdt
		}
	}

	// 1. Hitung Skor Probabilitas terbaru
	m.LatestScore = engine.EvaluatePredictiveScore(m.BotCandles, m.State.BotConfig.Timeframe)

	if m.CurrentPriceUsdt <= 0 {
		return
	}

	// 2. Periksa target TP, SL, dan Likuidasi untuk setiap posisi aktif (Tanpa bug mutasi slice)
	remainingPositions := make([]models.Position, 0, len(m.State.ActivePositions))
	stateChanged := false

	for _, pos := range m.State.ActivePositions {
		closeReason := ""
		if pos.Side == "LONG" {
			if m.CurrentPriceUsdt <= pos.LiqPrice {
				closeReason = "Liquidated"
			} else if pos.SlPrice > 0 && m.CurrentPriceUsdt <= pos.SlPrice {
				closeReason = "Stop Loss"
			} else if pos.TpPrice > 0 && m.CurrentPriceUsdt >= pos.TpPrice {
				closeReason = "Take Profit"
			}
		} else {
			if m.CurrentPriceUsdt >= pos.LiqPrice {
				closeReason = "Liquidated"
			} else if pos.SlPrice > 0 && m.CurrentPriceUsdt >= pos.SlPrice {
				closeReason = "Stop Loss"
			} else if pos.TpPrice > 0 && m.CurrentPriceUsdt <= pos.TpPrice {
				closeReason = "Take Profit"
			}
		}

		if closeReason != "" {
			m.settleClosedPositionLocked(pos, m.CurrentPriceUsdt, closeReason)
			stateChanged = true
		} else {
			remainingPositions = append(remainingPositions, pos)
		}
	}
	m.State.ActivePositions = remainingPositions

	// 3. Jika Bot sedang Aktif, evaluasi pembukaan posisi otomatis jika skor >= Threshold (65%)
	if m.State.BotRunning && len(m.BotCandles) >= engine.MinBotCandles {
		botActiveCount := 0
		for _, pos := range m.State.ActivePositions {
			if pos.IsBot {
				botActiveCount++
			}
		}

		currentCandleTime := m.BotCandles[len(m.BotCandles)-1].Time
		threshold := m.State.BotConfig.ThresholdScore
		if threshold <= 0 {
			threshold = 65.0
		}

		// Anti-Spam Cooldown: Maksimal 1 eksekusi bot per candle & patuhi batas MaxPositions
		if botActiveCount < m.State.BotConfig.MaxPositions && m.State.LastBotTradeCandleTime != currentCandleTime {
			if m.LatestScore.LongScore >= threshold && m.LatestScore.LongScore >= m.LatestScore.ShortScore {
				if err := m.openBotPositionLocked("LONG", currentCandleTime); err == nil {
					stateChanged = true
				}
			} else if m.LatestScore.ShortScore >= threshold && m.LatestScore.ShortScore > m.LatestScore.LongScore {
				if err := m.openBotPositionLocked("SHORT", currentCandleTime); err == nil {
					stateChanged = true
				}
			}
		}
	}

	if stateChanged {
		m.saveStateLocked()
	}
}

func (m *Manager) openBotPositionLocked(side string, candleTime int64) error {
	cfg := m.State.BotConfig
	marginIdr := math.Round(m.State.IdrBalance * (cfg.MarginPercent / 100.0))
	if marginIdr < 10000 {
		return fmt.Errorf("saldo tidak mencukupi untuk margin bot")
	}

	posSizeIdr := marginIdr * cfg.Leverage
	entryFeeIdr := math.Round(posSizeIdr * engine.TradingFeeRate)
	if marginIdr+entryFeeIdr > m.State.IdrBalance {
		return fmt.Errorf("saldo tidak mencukupi untuk margin + biaya masuk")
	}

	entryPrice := m.CurrentPriceUsdt
	tpRatio := (cfg.TakeProfitPercent / 100.0) / cfg.Leverage
	slRatio := (cfg.StopLossPercent / 100.0) / cfg.Leverage

	var tpPrice, slPrice float64
	if side == "LONG" {
		tpPrice = math.Round(entryPrice*(1.0+tpRatio)*100) / 100
		slPrice = math.Round(entryPrice*(1.0-slRatio)*100) / 100
	} else {
		tpPrice = math.Round(entryPrice*(1.0-tpRatio)*100) / 100
		slPrice = math.Round(entryPrice*(1.0+slRatio)*100) / 100
	}

	liqPrice := engine.CalculateLiquidationPrice(side, entryPrice, cfg.Leverage)

	// Validasi agar Stop Loss tidak melewati harga Likuidasi (Hasil Audit Tahap 2)
	if side == "LONG" && slPrice <= liqPrice {
		slPrice = math.Round((liqPrice+(entryPrice-liqPrice)*0.15)*100) / 100
	} else if side == "SHORT" && slPrice >= liqPrice {
		slPrice = math.Round((liqPrice-(liqPrice-entryPrice)*0.15)*100) / 100
	}

	m.State.IdrBalance -= (marginIdr + entryFeeIdr)
	m.State.LastBotTradeCandleTime = candleTime

	pos := models.Position{
		ID:            fmt.Sprintf("BOT-%d", time.Now().UnixMilli()),
		Pair:          cfg.Pair,
		Side:          side,
		IsBot:         true,
		EntryPrice:    entryPrice,
		EntryPriceIdr: math.Round(entryPrice * m.State.UsdtRate),
		MarginIdr:     marginIdr,
		Leverage:      cfg.Leverage,
		PositionSize:  posSizeIdr,
		QuantityBtc:   (posSizeIdr / m.State.UsdtRate) / entryPrice,
		EntryFeeIdr:   entryFeeIdr,
		TpPrice:       tpPrice,
		SlPrice:       slPrice,
		LiqPrice:      liqPrice,
		OpenedAt:      time.Now().Format("02/01/2006 15:04:05"),
		CandleTime:    candleTime,
	}

	m.State.ActivePositions = append([]models.Position{pos}, m.State.ActivePositions...)
	return nil
}

// OpenManualPosition membuka posisi perdagangan manual dari pengguna.
func (m *Manager) OpenManualPosition(side string, marginIdr float64, leverage float64, tpPrice float64, slPrice float64) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.CurrentPriceUsdt <= 0 {
		return fmt.Errorf("harga pasar belum tersedia")
	}
	if marginIdr < 10000 {
		return fmt.Errorf("margin minimal adalah Rp 10.000")
	}
	if leverage < 1 || leverage > 125 {
		return fmt.Errorf("leverage harus di antara 1x hingga 125x")
	}

	posSizeIdr := math.Round(marginIdr * leverage)
	entryFeeIdr := math.Round(posSizeIdr * engine.TradingFeeRate)
	if marginIdr+entryFeeIdr > m.State.IdrBalance {
		return fmt.Errorf("saldo tidak mencukupi untuk Margin (Rp %.0f) + Biaya Buka Posisi (Rp %.0f)", marginIdr, entryFeeIdr)
	}

	entryPrice := m.CurrentPriceUsdt
	liqPrice := engine.CalculateLiquidationPrice(side, entryPrice, leverage)

	if side == "LONG" {
		if tpPrice > 0 && tpPrice <= entryPrice {
			return fmt.Errorf("Take Profit LONG harus di atas harga masuk ($%.2f)", entryPrice)
		}
		if slPrice > 0 && (slPrice >= entryPrice || slPrice <= liqPrice) {
			return fmt.Errorf("Stop Loss LONG harus berada di antara harga Likuidasi ($%.2f) dan harga masuk ($%.2f)", liqPrice, entryPrice)
		}
	} else {
		if tpPrice > 0 && tpPrice >= entryPrice {
			return fmt.Errorf("Take Profit SHORT harus di bawah harga masuk ($%.2f)", entryPrice)
		}
		if slPrice > 0 && (slPrice <= entryPrice || slPrice >= liqPrice) {
			return fmt.Errorf("Stop Loss SHORT harus berada di antara harga masuk ($%.2f) dan harga Likuidasi ($%.2f)", entryPrice, liqPrice)
		}
	}

	m.State.IdrBalance -= (marginIdr + entryFeeIdr)

	pos := models.Position{
		ID:            fmt.Sprintf("MAN-%d", time.Now().UnixMilli()),
		Pair:          "BTC/USDT",
		Side:          side,
		IsBot:         false,
		EntryPrice:    entryPrice,
		EntryPriceIdr: math.Round(entryPrice * m.State.UsdtRate),
		MarginIdr:     marginIdr,
		Leverage:      leverage,
		PositionSize:  posSizeIdr,
		QuantityBtc:   (posSizeIdr / m.State.UsdtRate) / entryPrice,
		EntryFeeIdr:   entryFeeIdr,
		TpPrice:       tpPrice,
		SlPrice:       slPrice,
		LiqPrice:      liqPrice,
		OpenedAt:      time.Now().Format("02/01/2006 15:04:05"),
		CandleTime:    time.Now().Unix(),
	}

	m.State.ActivePositions = append([]models.Position{pos}, m.State.ActivePositions...)
	m.saveStateLocked()
	return nil
}

// ClosePositionByID menutup posisi secara manual berdasarkan ID.
func (m *Manager) ClosePositionByID(id string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	idx := -1
	for i, pos := range m.State.ActivePositions {
		if pos.ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		return fmt.Errorf("posisi tidak ditemukan")
	}

	pos := m.State.ActivePositions[idx]
	m.settleClosedPositionLocked(pos, m.CurrentPriceUsdt, "Manual Close")
	m.State.ActivePositions = append(m.State.ActivePositions[:idx], m.State.ActivePositions[idx+1:]...)
	m.saveStateLocked()
	return nil
}

func (m *Manager) settleClosedPositionLocked(pos models.Position, closePriceUsdt float64, reason string) {
	acc := engine.CalculatePositionAccounting(pos, closePriceUsdt)
	if reason == "Liquidated" {
		acc.ReturnedCash = 0
		acc.NetPnlIdr = -pos.MarginIdr - pos.EntryFeeIdr
		acc.RoiPercent = -100.0
	}

	m.State.IdrBalance += acc.ReturnedCash

	if pos.IsBot {
		m.State.BotNetProfitIdr += acc.NetPnlIdr
		if acc.NetPnlIdr > 0 {
			m.State.BotWinCount++
		} else {
			m.State.BotLossCount++
		}
	}

	execType := "Manual"
	if pos.IsBot {
		execType = "Bot Trading"
	}

	historyItem := models.TradeHistoryItem{
		ID:            fmt.Sprintf("HIST-%d", time.Now().UnixNano()),
		Time:          time.Now().Format("02/01/2006 15:04:05"),
		Type:          execType,
		Pair:          pos.Pair,
		Side:          pos.Side,
		Leverage:      pos.Leverage,
		MarginIdr:     pos.MarginIdr,
		EntryPrice:    pos.EntryPrice,
		EntryPriceIdr: pos.EntryPriceIdr,
		ClosePrice:    closePriceUsdt,
		ClosePriceIdr: math.Round(closePriceUsdt * m.State.UsdtRate),
		PnlIdr:        acc.NetPnlIdr,
		RoiPercent:    acc.RoiPercent,
		Status:        reason,
	}

	m.State.TradeHistory = append([]models.TradeHistoryItem{historyItem}, m.State.TradeHistory...)
}

// ToggleBot mengaktifkan atau menghentikan Bot Trading.
func (m *Manager) ToggleBot(running bool) models.PersistentState {
	m.mu.Lock()
	m.State.BotRunning = running
	m.saveStateLocked()
	stateCopy := m.State
	m.mu.Unlock()

	if running {
		m.FetchBotCandles(500)
		m.EvaluateTick()
	}
	return stateCopy
}

// UpdateBotConfig menyimpan konfigurasi baru Bot dan menyegarkan data candle independen Bot.
func (m *Manager) UpdateBotConfig(cfg models.BotConfig) error {
	m.mu.Lock()
	oldTf := m.State.BotConfig.Timeframe
	if cfg.ThresholdScore <= 0 {
		cfg.ThresholdScore = 65
	}
	m.State.BotConfig = cfg
	m.saveStateLocked()
	m.mu.Unlock()

	if oldTf != cfg.Timeframe {
		m.FetchBotCandles(500)
	}
	m.EvaluateTick()
	return nil
}

// UpdateBalance mengubah saldo simulasi IDR (Terkunci apabila masih ada posisi terbuka - Hasil Audit Tahap 1).
func (m *Manager) UpdateBalance(newBalanceIdr float64, newUsdtRate float64) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if len(m.State.ActivePositions) > 0 {
		return fmt.Errorf("tidak dapat mengubah saldo saat masih ada %d posisi terbuka. Tutup seluruh posisi terlebih dahulu", len(m.State.ActivePositions))
	}
	if newBalanceIdr < 100000 {
		return fmt.Errorf("saldo minimal adalah Rp 100.000")
	}
	m.State.IdrBalance = math.Round(newBalanceIdr)
	if newUsdtRate >= 1000 {
		m.State.UsdtRate = math.Round(newUsdtRate)
	}
	m.saveStateLocked()
	return nil
}

// ClearHistory membersihkan riwayat perdagangan yang sudah selesai.
func (m *Manager) ClearHistory() {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.State.TradeHistory = []models.TradeHistoryItem{}
	m.saveStateLocked()
}

// GetLiveSnapshot mengembalikan salinan lengkap state dan skor saat ini untuk API/Stream.
func (m *Manager) GetLiveSnapshot() models.LiveSnapshot {
	m.mu.RLock()
	defer m.mu.RUnlock()

	return models.LiveSnapshot{
		CurrentPriceUsdt: m.CurrentPriceUsdt,
		CurrentPriceIdr:  math.Round(m.CurrentPriceUsdt * m.State.UsdtRate),
		PriceChange24h:   m.PriceChange24h,
		High24h:          m.High24h,
		Low24h:           m.Low24h,
		Volume24h:        m.Volume24h,
		State:            m.State,
		Score:            m.LatestScore,
		ServerTime:       time.Now().Format("15:04:05 WIB"),
	}
}
