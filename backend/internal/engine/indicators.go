package engine

import (
	"math"
	"simtrader-pro/backend/internal/models"
)

// CalculateSMA menghitung Simple Moving Average untuk periode tertentu.
// Mengembalikan slice dengan panjang yang sama dengan input candles (nilai tidak valid diisi NaN).
func CalculateSMA(candles []models.Candle, period int) []float64 {
	n := len(candles)
	result := make([]float64, n)
	for i := 0; i < n; i++ {
		if i < period-1 {
			result[i] = math.NaN()
			continue
		}
		sum := 0.0
		for j := 0; j < period; j++ {
			sum += candles[i-j].Close
		}
		result[i] = sum / float64(period)
	}
	return result
}

// CalculateEMA menghitung Exponential Moving Average dengan inisialisasi seed SMA-period (Hasil Audit Tahap 1).
func CalculateEMA(candles []models.Candle, period int) []float64 {
	n := len(candles)
	result := make([]float64, n)
	if n < period {
		for i := range result {
			result[i] = math.NaN()
		}
		return result
	}

	// Seed pertama menggunakan rata-rata sederhana (SMA) dari 'period' candle pertama
	sum := 0.0
	for i := 0; i < period; i++ {
		sum += candles[i].Close
		if i < period-1 {
			result[i] = math.NaN()
		}
	}
	seedSMA := sum / float64(period)
	result[period-1] = seedSMA

	k := 2.0 / float64(period+1)
	prevEma := seedSMA
	for i := period; i < n; i++ {
		ema := (candles[i].Close-prevEma)*k + prevEma
		result[i] = ema
		prevEma = ema
	}
	return result
}

// CalculateRSI menghitung Relative Strength Index (Wilder's Smoothing) dengan pengaman pembagian nol (Hasil Audit Tahap 2).
func CalculateRSI(candles []models.Candle, period int) []float64 {
	n := len(candles)
	result := make([]float64, n)
	for i := range result {
		result[i] = math.NaN()
	}
	if n <= period {
		return result
	}

	gains := 0.0
	losses := 0.0
	for i := 1; i <= period; i++ {
		diff := candles[i].Close - candles[i-1].Close
		if diff >= 0 {
			gains += diff
		} else {
			losses -= diff
		}
	}

	avgGain := gains / float64(period)
	avgLoss := losses / float64(period)

	result[period] = computeRsiValue(avgGain, avgLoss)

	for i := period + 1; i < n; i++ {
		diff := candles[i].Close - candles[i-1].Close
		gain := 0.0
		loss := 0.0
		if diff > 0 {
			gain = diff
		} else if diff < 0 {
			loss = -diff
		}
		avgGain = ((avgGain * float64(period-1)) + gain) / float64(period)
		avgLoss = ((avgLoss * float64(period-1)) + loss) / float64(period)
		result[i] = computeRsiValue(avgGain, avgLoss)
	}

	return result
}

func computeRsiValue(avgGain, avgLoss float64) float64 {
	if avgLoss == 0 && avgGain == 0 {
		return 50.0 // Pasar datar sempurna (Flat-market guard)
	}
	if avgLoss == 0 {
		return 100.0
	}
	rs := avgGain / avgLoss
	return 100.0 - (100.0 / (1.0 + rs))
}

// CalculateEffectiveRVOL menghitung Relative Volume menggunakan max(V_t, V_{t-1}) terhadap
// rata-rata 10 candle tertutup sebelumnya (t-2 s/d t-11) untuk mencegah penalti palsu di awal pergantian candle (Hasil Audit Tahap 1).
func CalculateEffectiveRVOL(candles []models.Candle) float64 {
	n := len(candles)
	if n < 12 {
		return 1.0
	}
	t := n - 1
	effectiveVol := math.Max(candles[t].Volume, candles[t-1].Volume)

	sumClosedVol := 0.0
	for i := t - 11; i <= t-2; i++ {
		sumClosedVol += candles[i].Volume
	}
	avgVol10 := sumClosedVol / 10.0
	if avgVol10 <= 0 {
		return 1.0
	}
	return effectiveVol / avgVol10
}

// CalculateCLV menghitung Close Location Value dalam rentang [0.0, 1.0].
// 1.0 berarti ditutup tepat di High, 0.0 berarti ditutup tepat di Low.
func CalculateCLV(c models.Candle) float64 {
	rng := c.High - c.Low
	if rng <= 0 {
		return 0.5
	}
	return (c.Close - c.Low) / rng
}
