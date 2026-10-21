package models

// Candle merepresentasikan struktur OHLCV standar untuk perhitungan indikator dan grafik.
type Candle struct {
	Time   int64   `json:"time"`   // Unix timestamp dalam detik
	Open   float64 `json:"open"`   // Harga pembukaan (USDT)
	High   float64 `json:"high"`   // Harga tertinggi (USDT)
	Low    float64 `json:"low"`    // Harga terendah (USDT)
	Close  float64 `json:"close"`  // Harga penutupan (USDT)
	Volume float64 `json:"volume"` // Volume transaksi (BTC)
}

// BotConfig menyimpan seluruh parameter kustomisasi algoritma bot.
type BotConfig struct {
	Pair              string  `json:"pair"`
	Timeframe         string  `json:"timeframe"`
	Leverage          float64 `json:"leverage"`
	MarginPercent     float64 `json:"marginPercent"`
	TakeProfitPercent float64 `json:"takeProfitPercent"`
	StopLossPercent   float64 `json:"stopLossPercent"`
	MaxPositions      int     `json:"maxPositions"`
	ThresholdScore    float64 `json:"thresholdScore"`
}

// Position merepresentasikan posisi perdagangan terbuka (baik Manual maupun Bot).
type Position struct {
	ID            string  `json:"id"`
	Pair          string  `json:"pair"`
	Side          string  `json:"side"`          // "LONG" atau "SHORT"
	IsBot         bool    `json:"isBot"`         // true = dieksekusi Bot, false = Manual
	EntryPrice    float64 `json:"entryPrice"`    // Harga masuk dalam USDT
	EntryPriceIdr float64 `json:"entryPriceIdr"` // Harga masuk dalam IDR
	MarginIdr     float64 `json:"marginIdr"`     // Modal pokok (IDR)
	Leverage      float64 `json:"leverage"`      // Pengali leverage
	PositionSize  float64 `json:"positionSize"`  // Nilai kontrak total (Margin * Leverage) dalam IDR
	QuantityBtc   float64 `json:"quantityBtc"`   // Jumlah ekuivalen BTC
	EntryFeeIdr   float64 `json:"entryFeeIdr"`   // Biaya buka posisi (0.05% dari PositionSize)
	TpPrice       float64 `json:"tpPrice"`       // Target harga Take Profit (USDT), 0 jika tidak disetel
	SlPrice       float64 `json:"slPrice"`       // Target harga Stop Loss (USDT), 0 jika tidak disetel
	LiqPrice      float64 `json:"liqPrice"`      // Harga likuidasi paksa (USDT)
	OpenedAt      string  `json:"openedAt"`      // Waktu buka posisi
	CandleTime    int64   `json:"candleTime"`    // Timestamp candle saat posisi dibuka
}

// PositionAccounting memuat hasil kalkulasi akuntansi real-time untuk setiap posisi.
type PositionAccounting struct {
	GrossPnlIdr  float64 `json:"grossPnlIdr"`
	ExitFeeIdr   float64 `json:"exitFeeIdr"`
	NetPnlIdr    float64 `json:"netPnlIdr"`
	RoiPercent   float64 `json:"roiPercent"`
	ReturnedCash float64 `json:"returnedCash"`
}

// TradeHistoryItem mencatat rekam jejak posisi yang telah ditutup ke dalam buku besar.
type TradeHistoryItem struct {
	ID            string  `json:"id"`
	Time          string  `json:"time"`
	Type          string  `json:"type"`   // "Bot Trading" atau "Manual"
	Pair          string  `json:"pair"`   // "BTC/USDT"
	Side          string  `json:"side"`   // "LONG" atau "SHORT"
	Leverage      float64 `json:"leverage"`
	MarginIdr     float64 `json:"marginIdr"`
	EntryPrice    float64 `json:"entryPrice"`    // USDT
	EntryPriceIdr float64 `json:"entryPriceIdr"` // IDR
	ClosePrice    float64 `json:"closePrice"`    // USDT
	ClosePriceIdr float64 `json:"closePriceIdr"` // IDR
	PnlIdr        float64 `json:"pnlIdr"`        // Net PnL (setelah dikurangi Entry Fee + Exit Fee)
	RoiPercent    float64 `json:"roiPercent"`
	Status        string  `json:"status"` // "Take Profit", "Stop Loss", "Liquidated", "Manual Close"
}

// ScoreBreakdown memaparkan rincian skor dari masing-masing pilar indikator.
type ScoreBreakdown struct {
	LongScore      float64 `json:"longScore"`
	ShortScore     float64 `json:"shortScore"`
	MaLong         float64 `json:"maLong"`
	MaShort        float64 `json:"maShort"`
	EmaLong        float64 `json:"emaLong"`
	EmaShort       float64 `json:"emaShort"`
	RsiLong        float64 `json:"rsiLong"`
	RsiShort       float64 `json:"rsiShort"`
	VolLong        float64 `json:"volLong"`
	VolShort       float64 `json:"volShort"`
	Ma50           float64 `json:"ma50"`
	Ma200          float64 `json:"ma200"`
	Ema20          float64 `json:"ema20"`
	Rsi14          float64 `json:"rsi14"`
	Rvol           float64 `json:"rvol"`
	Clv            float64 `json:"clv"`
	MultiplierTf   float64 `json:"multiplierTf"`
	SignalSummary  string  `json:"signalSummary"`
	 EvaluatedCandle int64  `json:"evaluatedCandle"`
}

// PersistentState adalah struktur yang disimpan ke dalam file JSON agar tahan restart.
type PersistentState struct {
	IdrBalance             float64            `json:"idrBalance"`
	UsdtRate               float64            `json:"usdtRate"`
	BotRunning             bool               `json:"botRunning"`
	BotNetProfitIdr        float64            `json:"botNetProfitIdr"`
	BotWinCount            int                `json:"botWinCount"`
	BotLossCount           int                `json:"botLossCount"`
	LastBotTradeCandleTime int64              `json:"lastBotTradeCandleTime"`
	BotConfig              BotConfig          `json:"botConfig"`
	ActivePositions        []Position         `json:"activePositions"`
	TradeHistory           []TradeHistoryItem `json:"tradeHistory"`
}

// LiveSnapshot dikirimkan secara berkala ke Frontend untuk memperbarui UI secara real-time.
type LiveSnapshot struct {
	CurrentPriceUsdt float64            `json:"currentPriceUsdt"`
	CurrentPriceIdr  float64            `json:"currentPriceIdr"`
	PriceChange24h   float64            `json:"priceChange24h"`
	High24h          float64            `json:"high24h"`
	Low24h           float64            `json:"low24h"`
	Volume24h        float64            `json:"volume24h"`
	State            PersistentState    `json:"state"`
	Score            ScoreBreakdown     `json:"score"`
	ServerTime       string             `json:"serverTime"`
}
