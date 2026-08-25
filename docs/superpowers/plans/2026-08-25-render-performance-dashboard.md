# Render Performance Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add a read-only /performance dashboard immediately above Settings that visualizes persisted render-performance metrics for selectable 7-day, 30-day, 90-day, or all-time ranges.

**Architecture:** Keep the existing render-worker POST writer unchanged. Add a server-side summary read method to the jobs store and a GET branch on /api/render-metrics; PostgreSQL performs the range, p95, trend, stage, and recent-history queries, while the memory store uses the same response semantics for tests. Add a focused React dashboard and display helpers, then wire the route and sidebar entry through the existing App shell.

**Tech Stack:** Go 1.26, database/sql with PostgreSQL/pgx, Go httptest, React 18, Vite, Vitest, Testing Library, Tailwind utility classes, lucide-react, inline SVG for the dependency-free duration chart.

---

## File map

### Backend

- Modify backend-go/internal/jobs/store.go: add the summary read method to the shared store interface.
- Modify backend-go/internal/jobs/render_metrics.go: define the range/summary DTOs, range parser, shared in-memory aggregation, and MemoryStore implementation.
- Modify backend-go/internal/jobs/postgres.go: implement the summary read method with bounded PostgreSQL queries over render_performance_metrics.
- Create backend-go/internal/jobs/render_performance_summary_test.go: test range parsing and memory aggregation, including failure exclusion, p95, trend, stages, and bounded recent rows.
- Modify backend-go/internal/httpapi/render_metrics_handlers.go: dispatch GET and POST separately, validate the range, and return summary JSON.
- Modify backend-go/internal/httpapi/render_metrics_handlers_test.go: test GET response shape, invalid ranges, empty history, and mixed done/error metrics.

### Frontend

- Create dashboard/src/lib/renderPerformance.js: allowed range values, API fetch helper, response defaults, and formatting helpers.
- Create dashboard/src/lib/renderPerformance.test.js: test range URL construction, response normalization, duration/byte/percentage formatting, and chart-safe values.
- Create dashboard/src/components/PerformanceDashboard.jsx: loading/error/empty states, range selector, refresh action, summary cards, SVG duration trend, stage breakdown, and responsive recent-render table.
- Create dashboard/src/components/PerformanceDashboard.test.jsx: test data rendering, range changes, refresh, loading, empty, and error states.
- Modify dashboard/src/routing.js: register /performance and preserve project/editor route behavior.
- Modify dashboard/src/App.jsx: import and render PerformanceDashboard, add the Performance nav item immediately before Settings, and keep collapsed-sidebar behavior.
- Modify dashboard/src/App.test.jsx: verify sidebar ordering/icon and direct Performance view.
- Modify dashboard/src/routing.test.js: verify /performance maps to the new tab and project/editor paths remain unchanged.

### Documentation and operations

- The approved design remains in docs/superpowers/specs/2026-08-25-render-performance-dashboard-design.md.
- No database migration is planned; the existing render metrics table and indexes are reused. The query uses finished_at as the period boundary. Add a focused finished_at index only if a measured live query requires it.
- Apply the committed result with .\scripts\manage-local.ps1 -Action Restart, then verify backend/frontend health and the /performance route.

## Task 1: Define the backend summary contract and failing aggregation tests

**Files:**

- Create: backend-go/internal/jobs/render_performance_summary_test.go
- Modify: backend-go/internal/jobs/store.go
- Modify: backend-go/internal/jobs/render_metrics.go

- [ ] Step 1: Run the current focused backend tests.

Run from backend-go:

~~~powershell
go test ./internal/jobs ./internal/httpapi
~~~

Expected: PASS before feature changes.

- [ ] Step 2: Add failing contract tests before implementing aggregation.

Create fixed test data with now = 2026-08-25T12:00:00Z: two successful metrics with durations 1000 and 3000 ms, stage maps {compositing: 600, encoding: 400} and {compositing: 1500, encoding: 1500}, and one failed metric with duration 9000 ms. Insert them into MemoryStore, call GetRenderPerformanceSummary(context.Background(), "30d", now), and assert:

~~~go
if got.Summary.RenderCount != 3 || got.Summary.SuccessfulCount != 2 || got.Summary.FailedCount != 1 {
    t.Fatalf("unexpected counts: %#v", got.Summary)
}
if got.Summary.AverageDurationMS != 2000 || got.Summary.P95DurationMS != 2900 {
    t.Fatalf("failed render leaked into duration statistics: %#v", got.Summary)
}
if got.Summary.AccelerationCounts["gpu"] != 2 || got.Summary.AccelerationCounts["cpu"] != 1 {
    t.Fatalf("unexpected acceleration counts: %#v", got.Summary.AccelerationCounts)
}
if got.Stages[0].Name != "compositing" || got.Stages[0].Share != 52.5 {
    t.Fatalf("unexpected stage aggregation: %#v", got.Stages)
}
if len(got.Trend) != 2 || len(got.Recent) != 3 {
    t.Fatalf("unexpected trend/recent data: %#v %#v", got.Trend, got.Recent)
}
~~~

Add a range test asserting ParseRenderPerformanceRange("7d", now) returns From = now - 7 days, To = now, and ParseRenderPerformanceRange("365d", now) returns an error.

- [ ] Step 3: Run the new tests and verify the expected RED state.

Run:

~~~powershell
go test ./internal/jobs -run 'TestMemoryStoreRenderPerformanceSummaryAggregatesSuccessfulMetrics|TestParseRenderPerformanceRangeRejectsUnsupportedValues' -v
~~~

Expected: FAIL because the summary DTOs, parser, and store method do not exist.

- [ ] Step 4: Add the shared DTOs and interface method.

Add to render_metrics.go:

~~~go
const renderPerformanceRecentLimit = 20

type RenderPerformanceRange struct {
    Key  string
    From *time.Time
    To   time.Time
}

type RenderPerformanceSummary struct {
    Range   string                         `json:"range"`
    From    *time.Time                     `json:"from"`
    To      time.Time                      `json:"to"`
    Summary RenderPerformanceSummaryStats  `json:"summary"`
    Trend   []RenderPerformanceTrendPoint  `json:"trend"`
    Stages  []RenderPerformanceStage       `json:"stages"`
    Recent  []RenderPerformanceRecentEntry `json:"recent"`
}

type RenderPerformanceSummaryStats struct {
    RenderCount        int64            `json:"render_count"`
    SuccessfulCount    int64            `json:"successful_count"`
    FailedCount        int64            `json:"failed_count"`
    SuccessRate        float64          `json:"success_rate"`
    AverageDurationMS  int64            `json:"average_duration_ms"`
    P95DurationMS      int64            `json:"p95_duration_ms"`
    TotalOutputBytes   int64            `json:"total_output_bytes"`
    AccelerationCounts map[string]int64 `json:"acceleration_counts"`
}

type RenderPerformanceTrendPoint struct {
    Date              string `json:"date"`
    RenderCount       int64  `json:"render_count"`
    FailedCount       int64  `json:"failed_count"`
    AverageDurationMS int64  `json:"average_duration_ms"`
    P95DurationMS     int64  `json:"p95_duration_ms"`
}

type RenderPerformanceStage struct {
    Name       string  `json:"name"`
    DurationMS int64   `json:"duration_ms"`
    Share      float64 `json:"share"`
}

type RenderPerformanceRecentEntry struct {
    RenderID         string    `json:"render_id"`
    JobID            string    `json:"job_id"`
    VersionID        string    `json:"version_id,omitempty"`
    ClipIndex        int       `json:"clip_index"`
    Status           string    `json:"status"`
    TotalDurationMS  int64     `json:"total_duration_ms"`
    AccelerationMode string    `json:"acceleration_mode"`
    OutputBytes      int64     `json:"output_bytes"`
    FinishedAt       time.Time `json:"finished_at"`
    Error            string    `json:"error,omitempty"`
}

func ParseRenderPerformanceRange(value string, now time.Time) (RenderPerformanceRange, error)
~~~

Add GetRenderPerformanceSummary(context.Context, string, time.Time) (RenderPerformanceSummary, error) to jobs.Store. The time.Time argument keeps aggregation tests deterministic; the HTTP handler passes time.Now().UTC().

- [ ] Step 5: Implement range parser and memory aggregation.

Accept only empty/30d, 7d, 90d, and all; normalize an empty value to 30d; reject any other value. Set To to now.UTC(). Set From to To minus the selected duration, or leave it nil for all.

Implement MemoryStore.GetRenderPerformanceSummary by snapshotting metrics under RLock, filtering FinishedAt with From <= finished_at <= To, sorting newest-first, and returning:

- counts and CPU/GPU totals from all filtered metrics;
- average/p95 and stage totals from status == done only;
- success rate as successful count divided by render count times 100, or zero with no renders;
- UTC day buckets with failure counts and successful timing statistics;
- stage shares as duration_ms / total_successful_stage_duration_ms * 100, or zero when there are no stage durations;
- at most renderPerformanceRecentLimit recent entries.

Use a deterministic percentile helper with sorted durations and linear interpolation, so [1000, 3000] produces 2900 at p95. Sort stage rows by descending duration then name, trend rows by ascending date, and recent rows by descending finish time then render ID.

- [ ] Step 6: Run focused jobs tests and verify GREEN.

Run:

~~~powershell
gofmt -w internal/jobs/render_metrics.go internal/jobs/render_performance_summary_test.go internal/jobs/store.go
go test ./internal/jobs -run 'TestMemoryStoreRenderPerformanceSummaryAggregatesSuccessfulMetrics|TestParseRenderPerformanceRangeRejectsUnsupportedValues' -v
~~~

Expected: PASS.

## Task 2: Implement the PostgreSQL summary read path

**Files:**

- Modify: backend-go/internal/jobs/postgres.go
- Modify: backend-go/internal/jobs/render_performance_summary_test.go

- [ ] Step 1: Add an optional PostgreSQL parity test.

Use existing TEST_DATABASE_URL convention. Insert three fixed metrics, call GetRenderPerformanceSummary(ctx, "30d", now), assert the same counts/timing/stage semantics as the memory test, and delete inserted render IDs with t.Cleanup. Skip only when TEST_DATABASE_URL is unset.

- [ ] Step 2: Run the parity test to establish its RED or skip state.

Run:

~~~powershell
go test ./internal/jobs -run TestPostgresRenderPerformanceSummary -v
~~~

Expected: FAIL because PostgresStore.GetRenderPerformanceSummary is not implemented, or SKIP if no test database is configured. A skip is acceptable for this integration-only test; memory and HTTP tests remain mandatory.

- [ ] Step 3: Implement PostgreSQL aggregation.

Add GetRenderPerformanceSummary to PostgresStore with four bounded parameterized queries over render_performance_metrics:

1. Summary: COUNT(*), done/error counts, successful AVG(total_duration_ms), successful PERCENTILE_CONT(0.95), output bytes, and CPU/GPU counts.
2. Trend: UTC day, counts, and successful average/p95 grouped by day.
3. Stages: jsonb_each_text(stage_durations_ms) filtered to done metrics and grouped by stage name; compute shares from returned totals.
4. Recent rows: response fields ordered by finished_at DESC, render_id DESC, LIMIT 20.

Build the time predicate from the parsed range and use SQL parameters for From and To; never interpolate the request range into SQL. Scan nullable aggregates through sql.NullFloat64/sql.NullInt64, round durations to the nearest millisecond, and return empty arrays/maps when there are no rows.

- [ ] Step 4: Run backend package tests.

Run:

~~~powershell
gofmt -w internal/jobs/postgres.go internal/jobs/render_performance_summary_test.go
go test ./internal/jobs -v
~~~

Expected: PASS, with only database-dependent skips when no TEST_DATABASE_URL is configured.

## Task 3: Add the GET render-metrics API and tests

**Files:**

- Modify: backend-go/internal/httpapi/render_metrics_handlers.go
- Modify: backend-go/internal/httpapi/render_metrics_handlers_test.go

- [ ] Step 1: Add failing HTTP tests.

Seed a memory store with one done metric and one error metric. Request GET /api/render-metrics?range=7d, decode jobs.RenderPerformanceSummary, and assert range, counts, p95/average, trend, stage, and recent fields. Add a GET /api/render-metrics?range=365d test expecting HTTP 400 and a JSON error. Add an empty-store test expecting HTTP 200 with zero summary counts and empty trend/stages/recent arrays.

- [ ] Step 2: Run handler tests and verify RED.

Run:

~~~powershell
go test ./internal/httpapi -run 'TestRenderMetricsHandler(Reads|Rejects|Returns)' -v
~~~

Expected: FAIL because the existing handler allows POST only and returns 405 for GET.

- [ ] Step 3: Implement GET/POST dispatch.

Refactor the method to this structure while preserving existing POST validation and persistence:

~~~go
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
~~~

renderMetricsSummary must read only the allowlisted range query value, call GetRenderPerformanceSummary(r.Context(), rangeValue, time.Now().UTC()), return HTTP 400 for parser errors, HTTP 500 with a stable JSON error for store failures, and writeJSON(w, http.StatusOK, summary) for success. Keep POST behavior unchanged.

- [ ] Step 4: Run backend HTTP tests and package suite.

Run:

~~~powershell
go test ./internal/httpapi -run 'TestRenderMetricsHandler' -v
go test ./internal/jobs ./internal/httpapi
~~~

Expected: PASS.

## Task 4: Build frontend metric helpers and failing component tests

**Files:**

- Create: dashboard/src/lib/renderPerformance.js
- Create: dashboard/src/lib/renderPerformance.test.js
- Create: dashboard/src/components/PerformanceDashboard.jsx
- Create: dashboard/src/components/PerformanceDashboard.test.jsx

- [ ] Step 1: Add helper tests first.

Test these expectations:

~~~js
expect(buildRenderMetricsUrl("7d")).toContain("/api/render-metrics?range=7d");
expect(formatDuration(42800)).toBe("42.8s");
expect(formatDuration(71400)).toBe("1m 11.4s");
expect(formatBytes(42800000)).toBe("40.8 MB");
expect(formatPercent(98.6)).toBe("98.6%");
expect(normalizeRenderPerformanceSummary({}).summary.render_count).toBe(0);
~~~

Also test unsupported helper ranges normalize to 30d, and trend, stages, recent, and acceleration_counts always have safe empty defaults.

- [ ] Step 2: Run helper tests and verify RED.

Run from dashboard:

~~~powershell
npm test -- --run src/lib/renderPerformance.test.js
~~~

Expected: FAIL because the helper module does not exist.

- [ ] Step 3: Implement helper functions.

Export RENDER_METRIC_RANGES with 7d, 30d, 90d, and all; DEFAULT_RENDER_METRIC_RANGE = 30d; buildRenderMetricsUrl; formatDuration; formatBytes; formatPercent; and normalizeRenderPerformanceSummary. Use getApiUrl in the URL helper, binary byte units with one decimal when needed, and duration formatting matching the asserted seconds/minutes output. Do not aggregate or calculate p95 in the browser.

- [ ] Step 4: Add failing component tests for the approved screen.

Mock fetch with a representative summary response and assert:

- Performance heading, range selector, 142 render count, 98.6%, 42.8s, p95 1m 11.4s, and recent clip_08 appear;
- changing range to 7d fetches /api/render-metrics?range=7d;
- clicking Refresh causes a second fetch for the current range;
- pending fetches show a loading label or skeleton;
- zero counts show the empty-history message;
- rejected fetches show an inline retry message/action.

- [ ] Step 5: Run component tests and verify RED.

Run:

~~~powershell
npm test -- --run src/components/PerformanceDashboard.test.jsx
~~~

Expected: FAIL because PerformanceDashboard.jsx does not exist.

## Task 5: Implement the responsive Performance dashboard

**Files:**

- Modify: dashboard/src/components/PerformanceDashboard.jsx

- [ ] Step 1: Implement cancellable data loading.

Use range state initialized to DEFAULT_RENDER_METRIC_RANGE, refreshToken state, and an effect with AbortController. The effect sets loading, clears the error, fetches buildRenderMetricsUrl(range), throws on non-2xx responses, normalizes JSON, ignores abort errors, and cleans up by aborting. Depend on [range, refreshToken]. Keep the last successful data while a refresh is loading.

- [ ] Step 2: Implement page shell and state views.

Render a full-height scroll container with a centered max-width content area, title, description, period select with aria-label Performance range, and Refresh button. Render muted skeleton blocks during the first request, an inline retry state on errors, and No render metrics yet when a successful response has zero renders.

- [ ] Step 3: Implement summary cards and analytical panels.

Use four responsive cards for count/success, average+p95, output volume, and CPU/GPU totals. Use an inline SVG with role img and an accessible label for average/p95 trend lines, scaling points to available trend values without a chart dependency. Render stage rows as proportional bars with a zero-total guard. Render recent data in a table wrapper with overflow-x-auto and whitespace-nowrap cells.

- [ ] Step 4: Run helper/component tests and verify GREEN.

Run:

~~~powershell
npm test -- --run src/lib/renderPerformance.test.js src/components/PerformanceDashboard.test.jsx
~~~

Expected: PASS.

## Task 6: Wire routing and sidebar navigation

**Files:**

- Modify: dashboard/src/routing.js
- Modify: dashboard/src/routing.test.js
- Modify: dashboard/src/App.jsx
- Modify: dashboard/src/App.test.jsx

- [ ] Step 1: Add failing routing/sidebar tests.

Add:

~~~js
expect(getPathForTab("performance")).toBe("/performance");
expect(getTabFromPath("/performance")).toBe("performance");
expect(parseRoute("http://localhost/projects/p/clips/2/editor").editor).toBe(true);
~~~

Add an App assertion that the Performance nav button occurs immediately before Settings and uses the lucide-activity icon. Add a direct /performance render assertion for the page heading.

- [ ] Step 2: Run routing/App tests and verify RED.

Run:

~~~powershell
npm test -- --run src/routing.test.js src/App.test.jsx
~~~

Expected: FAIL because /performance is not registered and App has no Performance nav/view.

- [ ] Step 3: Implement route and App integration.

Add performance: /performance to TAB_PATHS. Import PerformanceDashboard. Add this NavItem directly before Settings:

~~~jsx
<NavItem
  tabKey="performance"
  icon={Activity}
  label="Performance"
  activeColor="bg-cyan-500/10 text-cyan-400"
/>
~~~

Add {activeTab === "performance" && <PerformanceDashboard />} in the main workspace alongside the other top-level views. Keep Settings as the final sidebar item.

- [ ] Step 4: Run routing/App tests and frontend quality checks.

Run:

~~~powershell
npm test -- --run src/routing.test.js src/App.test.jsx src/lib/renderPerformance.test.js src/components/PerformanceDashboard.test.jsx
npm run format
npm run format:check
npm run lint
npm run build
~~~

Expected: all tests pass, formatting is clean, lint reports zero warnings/errors, and Vite build exits 0.

## Task 7: Full verification, commit, and apply to the live app

**Files:**

- All implementation files from Tasks 1–6; preserve unrelated changes.

- [ ] Step 1: Review complete diff and worktree.

Run from the repository root:

~~~powershell
git status --short
git diff --stat
git diff --check
~~~

Confirm only planned backend/frontend files are changed. Do not stage .superpowers mockup artifacts or unrelated user work.

- [ ] Step 2: Run backend and frontend verification together.

Run:

~~~powershell
Push-Location backend-go; go test ./...; Pop-Location
Push-Location dashboard; npm test -- --run; npm run format:check; npm run lint; npm run build; Pop-Location
~~~

Expected: all commands exit 0, with only explicitly configured integration-test skips.

- [ ] Step 3: Run GitNexus change detection before committing.

After staging only planned implementation files, run mcp__gitnexus__detect_changes({ repo: "openshorts", scope: "staged" }). Review that affected scope is the render-metrics read path, dashboard route, and Performance component, with no HIGH/CRITICAL unexpected process. If it reports unexpected files or flows, unstage and correct scope before committing.

- [ ] Step 4: Commit implementation.

Run:

~~~powershell
git commit -m "feat: add render performance dashboard"
~~~

- [ ] Step 5: Rebuild and restart the live local app.

Run from the repository root:

~~~powershell
.\scripts\manage-local.ps1 -Action Restart
~~~

This is a cross-component change, so restart the default backend/frontend stack. The native renderer should remain healthy through the managed workflow.

- [ ] Step 6: Verify live services and new endpoint.

Run:

~~~powershell
.\scripts\manage-local.ps1 -Action Status
Invoke-RestMethod 'http://localhost:18000/health'
Invoke-RestMethod 'http://localhost:18000/api/render-metrics?range=30d'
~~~

Expected: backend/frontend/database report healthy, metrics endpoint returns the documented JSON shape, and empty history returns zero-valued summary fields rather than an error.

- [ ] Step 7: Verify route in Brave and report result.

Open http://localhost:18575/performance in Brave, confirm Performance appears directly above Settings, select each period option, confirm Refresh reloads the endpoint, and check a narrow viewport for no page-level horizontal overflow. Report the implementation commit and live-app restart result.
