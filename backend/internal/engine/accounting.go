package engine

import (
	"math"
	"simtrader-pro/backend/internal/models"
)

const TradingFeeRate = 0.0005 // 0.05% biaya transaksi (Taker/Maker standar Binance Futures)

// CalculatePositionAccounting adalah fungsi akuntansi terpusat (Hasil Audit Tahap 3)
// Memastikan biaya masuk (EntryFeeIdr) tidak pernah terpotong dua kali saat posisi ditutup.
func CalculatePositionAccounting(pos models.Position, closePriceUsdt float64) models.PositionAccounting {
	var priceDiffRatio float64
	if pos.Side == "LONG" {
		priceDiffRatio = (closePriceUsdt - pos.EntryPrice) / pos.EntryPrice
	} else {
		priceDiffRatio = (pos.EntryPrice - closePriceUsdt) / pos.EntryPrice
	}

	grossPnlIdr := math.Round(pos.PositionSize * priceDiffRatio)
	exitFeeIdr := math.Round(pos.PositionSize * TradingFeeRate)

	// Net PnL mencakup pengurangan Entry Fee (yang sudah dibayar di awal) dan Exit Fee (yang dibayar saat tutup)
	netPnlIdr := grossPnlIdr - pos.EntryFeeIdr - exitFeeIdr

	roiPercent := 0.0
	if pos.MarginIdr > 0 {
		roiPercent = math.Round((netPnlIdr/pos.MarginIdr)*10000) / 100
	}

	// Kas yang dikembalikan ke dompet hanya mengurangi Exit Fee karena Entry Fee telah dipotong saat buka posisi
	returnedCash := math.Max(0, pos.MarginIdr+grossPnlIdr-exitFeeIdr)

	return models.PositionAccounting{
		GrossPnlIdr:  grossPnlIdr,
		ExitFeeIdr:   exitFeeIdr,
		NetPnlIdr:    netPnlIdr,
		RoiPercent:   roiPercent,
		ReturnedCash: returnedCash,
	}
}

// CalculateLiquidationPrice menghitung estimasi harga likuidasi (rugi kotor menyentuh 90% dari Margin).
func CalculateLiquidationPrice(side string, entryPrice float64, leverage float64) float64 {
	if leverage <= 0 {
		leverage = 1
	}
	liqMoveRatio := 0.90 / leverage
	if side == "LONG" {
		return math.Round(entryPrice*(1.0-liqMoveRatio)*100) / 100
	}
	return math.Round(entryPrice*(1.0+liqMoveRatio)*100) / 100
}
