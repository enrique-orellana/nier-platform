package httpapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
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
	recentQuery, err := parseRenderPerformanceRecentQuery(r, rangeKey)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	summary, err := s.store.GetRenderPerformanceSummary(r.Context(), rangeKey, now)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "read render metrics"})
		return
	}
	recent, err := s.store.GetRenderPerformanceRecent(r.Context(), recentQuery, now)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "read recent render metrics"})
		return
	}
	summary.Recent = recent.Items
	summary.RecentTotal = recent.Total
	summary.RecentPage = recent.Page
	summary.RecentPageSize = recent.PageSize
	writeJSON(w, http.StatusOK, summary)
}

func parseRenderPerformanceRecentQuery(r *http.Request, rangeKey string) (jobs.RenderPerformanceRecentQuery, error) {
	query := jobs.RenderPerformanceRecentQuery{
		Range: rangeKey, Page: 1, PageSize: jobs.RenderPerformanceDefaultPageSize,
		Status: r.URL.Query().Get("recent_status"), AccelerationMode: r.URL.Query().Get("recent_mode"),
		Search: r.URL.Query().Get("recent_search"),
	}
	for key, destination := range map[string]*int{"recent_page": &query.Page, "recent_page_size": &query.PageSize} {
		value := r.URL.Query().Get(key)
		if value == "" {
			continue
		}
		parsed, err := strconv.Atoi(value)
		if err != nil {
			return jobs.RenderPerformanceRecentQuery{}, fmt.Errorf("%s must be a number", key)
		}
		*destination = parsed
	}
	if err := jobs.ValidateRenderPerformanceRecentQuery(query); err != nil {
		return jobs.RenderPerformanceRecentQuery{}, err
	}
	return query, nil
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
