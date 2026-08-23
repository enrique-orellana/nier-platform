package httpapi

import (
	"encoding/json"
	"net/http"

	"github.com/mutonby/openshorts/backend-go/internal/jobs"
)

func (s *Server) renderMetrics(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	var metric jobs.RenderPerformanceMetric
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(&metric); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid render metric JSON"})
		return
	}
	if err := jobs.ValidateRenderPerformanceMetric(metric); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}
	if err := s.store.UpsertRenderPerformanceMetric(r.Context(), metric); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "persist render metric"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "saved"})
}
