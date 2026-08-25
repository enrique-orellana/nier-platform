package httpapi

import (
	"encoding/json"
	"net/http"
	"time"

	"github.com/mutonby/openshorts/backend-go/internal/jobs"
)

func (s *Server) renderMetrics(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		s.renderMetricsSummary(w, r)
	case http.MethodPost:
		s.persistRenderMetric(w, r)
	default:
		w.Header().Set("Allow", "GET, POST")
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func (s *Server) renderMetricsSummary(w http.ResponseWriter, r *http.Request) {
	rangeKey := r.URL.Query().Get("range")
	now := time.Now().UTC()
	if _, err := jobs.ParseRenderPerformanceRange(rangeKey, now); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	summary, err := s.store.GetRenderPerformanceSummary(r.Context(), rangeKey, now)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "read render metrics"})
		return
	}
	writeJSON(w, http.StatusOK, summary)
}

func (s *Server) persistRenderMetric(w http.ResponseWriter, r *http.Request) {

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
