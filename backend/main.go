package main

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"simtrader-pro/backend/internal/bot"
	"simtrader-pro/backend/internal/models"
	"strconv"
	"time"
)

func enableCORS(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}
		next(w, r)
	}
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func main() {
	dataDir := filepath.Join(".", "data")
	_ = os.MkdirAll(dataDir, 0755)
	stateFile := filepath.Join(dataDir, "state.json")

	manager := bot.NewManager(stateFile)
	manager.StartBackgroundLoop()

	// Endpoint 1: Snapshot State & Skor Live
	http.HandleFunc("/api/snapshot", enableCORS(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, manager.GetLiveSnapshot())
	}))

	// Endpoint 2: Server-Sent Events (SSE) Real-Time Stream ke Frontend
	http.HandleFunc("/api/stream", enableCORS(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-cache")
		w.Header().Set("Connection", "keep-alive")

		flusher, ok := w.(http.Flusher)
		if !ok {
			http.Error(w, "Streaming unsupported", http.StatusInternalServerError)
			return
		}

		ticker := time.NewTicker(1 * time.Second)
		defer ticker.Stop()

		for {
			select {
			case <-r.Context().Done():
				return
			case <-ticker.C:
				snap := manager.GetLiveSnapshot()
				payload, _ := json.Marshal(snap)
				_, _ = fmt.Fprintf(w, "data: %s\n\n", payload)
				flusher.Flush()
			}
		}
	}))

	// Endpoint 3: Ambil Candlestick Chart sesuai Timeframe Pilihan UI (Terpisah dari Timeframe Bot)
	http.HandleFunc("/api/klines", enableCORS(func(w http.ResponseWriter, r *http.Request) {
		tf := r.URL.Query().Get("interval")
		if tf == "" {
			tf = "15m"
		}
		limitStr := r.URL.Query().Get("limit")
		limit, err := strconv.Atoi(limitStr)
		if err != nil || limit <= 0 {
			limit = 300
		}
		candles, err := manager.FetchCandlesByTimeframe(tf, limit)
		if err != nil {
			writeJSON(w, http.StatusBadGateway, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, candles)
	}))

	// Endpoint 4: Buka Posisi Manual
	http.HandleFunc("/api/positions/open", enableCORS(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
			return
		}
		var req struct {
			Side      string  `json:"side"`
			MarginIdr float64 `json:"marginIdr"`
			Leverage  float64 `json:"leverage"`
			TpPrice   float64 `json:"tpPrice"`
			SlPrice   float64 `json:"slPrice"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Payload tidak valid"})
			return
		}
		if err := manager.OpenManualPosition(req.Side, req.MarginIdr, req.Leverage, req.TpPrice, req.SlPrice); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, manager.GetLiveSnapshot())
	}))

	// Endpoint 5: Tutup Posisi Manual
	http.HandleFunc("/api/positions/close", enableCORS(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
			return
		}
		var req struct {
			ID string `json:"id"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Payload tidak valid"})
			return
		}
		if err := manager.ClosePositionByID(req.ID); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, manager.GetLiveSnapshot())
	}))

	// Endpoint 6: Toggle Start/Stop Bot Trading
	http.HandleFunc("/api/bot/toggle", enableCORS(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
			return
		}
		var req struct {
			Running bool `json:"running"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Payload tidak valid"})
			return
		}
		manager.ToggleBot(req.Running)
		writeJSON(w, http.StatusOK, manager.GetLiveSnapshot())
	}))

	// Endpoint 7: Simpan Konfigurasi Bot
	http.HandleFunc("/api/bot/config", enableCORS(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
			return
		}
		var cfg models.BotConfig
		if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Konfigurasi tidak valid"})
			return
		}
		_ = manager.UpdateBotConfig(cfg)
		writeJSON(w, http.StatusOK, manager.GetLiveSnapshot())
	}))

	// Endpoint 8: Update Konfigurasi Saldo Simulasi IDR & Kurs USDT
	http.HandleFunc("/api/config/balance", enableCORS(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
			return
		}
		var req struct {
			IdrBalance float64 `json:"idrBalance"`
			UsdtRate   float64 `json:"usdtRate"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Input saldo tidak valid"})
			return
		}
		if err := manager.UpdateBalance(req.IdrBalance, req.UsdtRate); err != nil {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, manager.GetLiveSnapshot())
	}))

	// Endpoint 9: Hapus Riwayat Perdagangan
	http.HandleFunc("/api/history/clear", enableCORS(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "Method not allowed"})
			return
		}
		manager.ClearHistory()
		writeJSON(w, http.StatusOK, manager.GetLiveSnapshot())
	}))

	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}
	log.Printf("====================================================================")
	log.Printf("🚀 SimTrader Pro Golang Backend berjalan di http://localhost:%s", port)
	log.Printf("📊 Weighted Predictive Scoring Engine (Threshold 65%%) Siap!")
	log.Printf("====================================================================")
	log.Fatal(http.ListenAndServe(":"+port, nil))
}
