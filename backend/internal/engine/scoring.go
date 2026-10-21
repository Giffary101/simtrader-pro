package engine

import (
	"fmt"
	"math"
	"simtrader-pro/backend/internal/models"
)

const MinBotCandles = 203 // Wajib minimal 203 candle agar MA200 memiliki minimal 4 titik (t, t-1, t-2, t-3)

// GetTimeframeMultiplier mengembalikan faktor normalisasi sensitivitas indikator berdasarkan timeframe.
func GetTimeframeMultiplier(tf string) float64 {
	switch tf {
	case "1m":
		return 0.1
	case "5m":
		return 0.25
	case "15m":
		return 0.4
	case "1h":
		return 0.7
	case "4h":
		return 1.0
	case "1d":
		return 2.5
	default:
		return 0.4
	}
}

// EvaluatePredictiveScore menjalankan Weighted Predictive Scoring Engine (Ambang Batas 65%).
// Seluruh konstanta dan logika identik 100% dengan hasil Audit Tahap 1, 2, dan 3.
func EvaluatePredictiveScore(candles []models.Candle, timeframe string) models.ScoreBreakdown {
	n := len(candles)
	mTf := GetTimeframeMultiplier(timeframe)

	if n < MinBotCandles {
		return models.ScoreBreakdown{
			MultiplierTf:  mTf,
			SignalSummary: fmt.Sprintf("Menunggu data historis (%d/%d candle)...", n, MinBotCandles),
		}
	}

	t := n - 1
	ma50Arr := CalculateSMA(candles, 50)
	ma200Arr := CalculateSMA(candles, 200)
	ema20Arr := CalculateEMA(candles, 20)
	rsi14Arr := CalculateRSI(candles, 14)

	ma50 := ma50Arr[t]
	ma200 := ma200Arr[t]
	ema20 := ema20Arr[t]
	rsi14 := rsi14Arr[t]

	if math.IsNaN(ma50) || math.IsNaN(ma200) || math.IsNaN(ma200Arr[t-3]) || math.IsNaN(ema20) || math.IsNaN(rsi14) {
		return models.ScoreBreakdown{
			MultiplierTf:  mTf,
			SignalSummary: "Menghitung stabilitas indikator...",
		}
	}

	// =========================================================================
	// KOMPONEN 1: MOMENTUM & KONVERGENSI MA 50 / MA 200 (Maks 35 Poin)
	// =========================================================================
	dT := ((ma50 - ma200) / ma200) * 100.0
	dT3 := ((ma50Arr[t-3] - ma200Arr[t-3]) / ma200Arr[t-3]) * 100.0
	vMa := dT - dT3
	mMa50 := ((ma50 - ma50Arr[t-3]) / ma50Arr[t-3]) * 100.0

	maLong := 0.0
	maShort := 0.0

	// Evaluasi Sinyal LONG MA (Termasuk perbaikan simetri titik persilangan D_t = 0 pada Audit Tahap 3)
	if dT >= -1.8*mTf && dT < 0 && vMa > 0.08*mTf && mMa50 > 0.04*mTf {
		// Pre-Golden Cross (Jemput Bawah)
		ratio := math.Min(1.0, vMa/(0.35*mTf))
		maLong = 22.0 + (13.0 * ratio)
	} else if dT >= 0 && dT <= 0.85*mTf && mMa50 > 0.03*mTf {
		// Dynamic MA Bounce / Early Golden Cross
		maLong = 28.0 + math.Min(7.0, (mMa50/(0.25*mTf))*7.0)
	} else if dT > 0.85*mTf && mMa50 > 0 {
		// Tren Bullish Berkelanjutan
		maLong = 12.0
	}

	// Evaluasi Sinyal SHORT MA
	if dT <= 1.8*mTf && dT > 0 && vMa < -0.08*mTf && mMa50 < -0.04*mTf {
		// Pre-Death Cross (Jemput Atas)
		ratio := math.Min(1.0, math.Abs(vMa)/(0.35*mTf))
		maShort = 22.0 + (13.0 * ratio)
	} else if dT <= 0 && dT >= -0.85*mTf && mMa50 < -0.03*mTf {
		// Dynamic MA Rejection / Early Death Cross
		maShort = 28.0 + math.Min(7.0, (math.Abs(mMa50)/(0.25*mTf))*7.0)
	} else if dT < -0.85*mTf && mMa50 < 0 {
		// Tren Bearish Berkelanjutan
		maShort = 12.0
	}

	// =========================================================================
	// KOMPONEN 2: RESPONSIVITAS EMA 20 (Maks 25 Poin)
	// =========================================================================
	price := candles[t].Close
	deltaEma := ((price - ema20) / ema20) * 100.0
	mEma20 := ((ema20 - ema20Arr[t-2]) / ema20Arr[t-2]) * 100.0

	emaLong := 0.0
	emaShort := 0.0

	// Evaluasi Sinyal LONG EMA 20
	if deltaEma >= 0 && deltaEma <= 1.2*mTf && mEma20 > 0.05*mTf {
		ratio := math.Min(1.0, mEma20/(0.30*mTf))
		emaLong = 15.0 + (10.0 * ratio)
	} else if deltaEma >= -0.35*mTf && deltaEma < 0 && mEma20 > 0 {
		emaLong = 12.0
	} else if deltaEma > 2.2*mTf {
		// Filter Anti-FOMO (Harga sudah terbang terlalu jauh dari EMA 20)
		emaLong = 5.0
	} else if deltaEma > 1.2*mTf && mEma20 > 0 {
		emaLong = 10.0
	}

	// Evaluasi Sinyal SHORT EMA 20
	if deltaEma <= 0 && deltaEma >= -1.2*mTf && mEma20 < -0.05*mTf {
		ratio := math.Min(1.0, math.Abs(mEma20)/(0.30*mTf))
		emaShort = 15.0 + (10.0 * ratio)
	} else if deltaEma <= 0.35*mTf && deltaEma > 0 && mEma20 < 0 {
		emaShort = 12.0
	} else if deltaEma < -2.2*mTf {
		// Filter Anti-FOMO Short
		emaShort = 5.0
	} else if deltaEma < -1.2*mTf && mEma20 < 0 {
		emaShort = 10.0
	}

	// =========================================================================
	// KOMPONEN 3: PEMETAAN NON-LINEAR RSI 14 (Maks 25 Poin, Penalti -15 Poin)
	// =========================================================================
	deltaRsi := rsi14 - rsi14Arr[t-2]
	rsiLong := 0.0
	rsiShort := 0.0

	// Evaluasi Sinyal LONG RSI
	if rsi14 >= 28.0 && rsi14 <= 48.0 && deltaRsi > 2.5 {
		ratio := math.Min(1.0, deltaRsi/9.0)
		rsiLong = 15.0 + (10.0 * ratio)
	} else if rsi14 > 48.0 && rsi14 <= 66.0 && deltaRsi > 1.0 {
		ratio := math.Min(1.0, deltaRsi/8.0)
		rsiLong = 10.0 + (8.0 * ratio)
	} else if rsi14 > 72.0 {
		// Penalti Overbought
		rsiLong = -15.0
	}

	// Evaluasi Sinyal SHORT RSI
	if rsi14 >= 52.0 && rsi14 <= 72.0 && deltaRsi < -2.5 {
		ratio := math.Min(1.0, math.Abs(deltaRsi)/9.0)
		rsiShort = 15.0 + (10.0 * ratio)
	} else if rsi14 >= 34.0 && rsi14 < 52.0 && deltaRsi < -1.0 {
		ratio := math.Min(1.0, math.Abs(deltaRsi)/8.0)
		rsiShort = 10.0 + (8.0 * ratio)
	} else if rsi14 < 28.0 {
		// Penalti Oversold
		rsiShort = -15.0
	}

	// =========================================================================
	// KOMPONEN 4: VALIDASI VOLUME & ANTI-FAKEOUT (Maks 15 Poin, Penalti -10 Poin)
	// =========================================================================
	rvol := CalculateEffectiveRVOL(candles)
	clv := CalculateCLV(candles[t])

	volLong := 0.0
	volShort := 0.0

	// Evaluasi Volume LONG
	if rvol >= 1.15 && clv >= 0.60 {
		ratio := math.Min(1.0, (rvol-1.15)/1.35)
		volLong = 10.0 + (5.0 * ratio)
	} else if rvol < 0.50 || (rvol >= 1.15 && clv < 0.30) {
		volLong = -10.0
	} else {
		volLong = 5.0
	}

	// Evaluasi Volume SHORT
	if rvol >= 1.15 && clv <= 0.40 {
		ratio := math.Min(1.0, (rvol-1.15)/1.35)
		volShort = 10.0 + (5.0 * ratio)
	} else if rvol < 0.50 || (rvol >= 1.15 && clv > 0.70) {
		volShort = -10.0
	} else {
		volShort = 5.0
	}

	// Total Skor dibatasi pada rentang [0, 100]
	totalLong := math.Max(0.0, math.Min(100.0, math.Round(maLong+emaLong+rsiLong+volLong)))
	totalShort := math.Max(0.0, math.Min(100.0, math.Round(maShort+emaShort+rsiShort+volShort)))

	summary := "Netral / Menunggu Konfirmasi Momentum"
	if totalLong >= 65.0 && totalLong >= totalShort {
		summary = fmt.Sprintf("SINYAL KUAT LONG (%.0f%% >= 65%%)", totalLong)
	} else if totalShort >= 65.0 && totalShort > totalLong {
		summary = fmt.Sprintf("SINYAL KUAT SHORT (%.0f%% >= 65%%)", totalShort)
	} else if totalLong >= 50.0 {
		summary = fmt.Sprintf("Akumulasi Bullish (%.0f%%)", totalLong)
	} else if totalShort >= 50.0 {
		summary = fmt.Sprintf("Distribusi Bearish (%.0f%%)", totalShort)
	}

	return models.ScoreBreakdown{
		LongScore:       totalLong,
		ShortScore:      totalShort,
		MaLong:          math.Round(maLong*10) / 10,
		MaShort:         math.Round(maShort*10) / 10,
		EmaLong:         math.Round(emaLong*10) / 10,
		EmaShort:        math.Round(emaShort*10) / 10,
		RsiLong:         math.Round(rsiLong*10) / 10,
		RsiShort:        math.Round(rsiShort*10) / 10,
		VolLong:         math.Round(volLong*10) / 10,
		VolShort:        math.Round(volShort*10) / 10,
		Ma50:            math.Round(ma50*100) / 100,
		Ma200:           math.Round(ma200*100) / 100,
		Ema20:           math.Round(ema20*100) / 100,
		Rsi14:           math.Round(rsi14*100) / 100,
		Rvol:            math.Round(rvol*100) / 100,
		Clv:             math.Round(clv*100) / 100,
		MultiplierTf:    mTf,
		SignalSummary:   summary,
		EvaluatedCandle: candles[t].Time,
	}
}
