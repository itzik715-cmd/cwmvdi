package health

import (
	"encoding/json"
	"log"
	"net/http"

	"github.com/itzik715-cmd/kamatera-vdi/agent/internal/config"
)

const ListenAddr = "127.0.0.1:17715"

// Start runs a local HTTP health server so the browser can detect the agent.
func Start() {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "*")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"status":  "ok",
			"agent":   "kamvdi",
			"version": config.AgentVersion,
		})
	})

	go func() {
		if err := http.ListenAndServe(ListenAddr, mux); err != nil {
			log.Printf("Health server failed: %v", err)
		}
	}()
}
