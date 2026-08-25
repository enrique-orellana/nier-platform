# Render Performance Dashboard Design

## Goal

Add a read-only `Performance` section immediately above `Settings` in the main OpenShorts sidebar. The section visualizes the render-performance metrics already produced by the render worker and persisted by the Go backend.

The first release focuses only on render performance. It does not attempt to measure browser responsiveness, frontend timings, or general application analytics.

## User experience

The dashboard uses the analytical layout selected during design review:

- Page title and short description explaining that the data covers completed renders.
- A period selector with `7 days`, `30 days`, `90 days`, and `All time`; the default is `30 days`.
- Summary cards for:
  - total renders in the selected period;
  - success rate and failed render count;
  - average and p95 render duration;
  - CPU/GPU acceleration totals.
- A duration chart showing average and p95 duration over time.
- A stage breakdown showing the percentage contribution of recorded render stages.
- A recent-renders table showing the newest render identifiers, status, duration, acceleration mode, and output size.
- A compact refresh action that reloads the selected range on demand.

The page is read-only. Render controls and configuration settings remain in their existing locations.

The dashboard follows the existing dark glass-panel styling and uses a distinct lucide activity/performance icon. It must remain usable when the sidebar is collapsed, including the existing tooltip behavior. On narrow screens, cards and analysis panels stack vertically, while recent-render rows may scroll horizontally rather than overflow the page.

## Navigation

Add a `performance` tab path at `/performance`. The main navigation order becomes:

1. existing product tabs;
2. Projects;
3. Performance;
4. Settings.

Direct navigation to `/performance` must select the Performance tab just like the existing routes. The route must not interfere with project or editor URL parsing.

## Data flow

The render worker's existing `POST /api/render-metrics` persistence path remains unchanged. The dashboard reads a new backend query endpoint:

```text
GET /api/render-metrics?range=7d|30d|90d|all
```

The backend performs aggregation in PostgreSQL and returns only the data needed by the page. This avoids transferring the full render history or duplicating p95 and stage aggregation logic in the browser.

The response shape is:

```json
{
  "range": "30d",
  "from": "2026-07-26T00:00:00Z",
  "to": "2026-08-25T00:00:00Z",
  "summary": {
    "render_count": 142,
    "successful_count": 140,
    "failed_count": 2,
    "success_rate": 98.6,
    "average_duration_ms": 42800,
    "p95_duration_ms": 71400,
    "total_output_bytes": 123456789,
    "acceleration_counts": { "cpu": 6, "gpu": 136 }
  },
  "trend": [
    {
      "date": "2026-08-25",
      "render_count": 8,
      "failed_count": 0,
      "average_duration_ms": 40100,
      "p95_duration_ms": 68400
    }
  ],
  "stages": [
    { "name": "compositing", "duration_ms": 120000, "share": 56.0 }
  ],
  "recent": [
    {
      "render_id": "render-1",
      "job_id": "job-1",
      "version_id": "version-1",
      "clip_index": 8,
      "status": "done",
      "total_duration_ms": 38400,
      "acceleration_mode": "gpu",
      "output_bytes": 42800000,
      "finished_at": "2026-08-25T10:00:00Z",
      "error": ""
    }
  ]
}
```

The exact SQL/query helpers may differ, but the API must preserve these semantics:

- only metrics whose completion time falls inside the selected range are included;
- `all` includes all persisted metrics;
- failed renders contribute to render count and failure count but are excluded from average duration, p95 duration, trend duration, and stage-share calculations; those timing metrics use only `done` renders;
- p95 is calculated server-side over the same successful-duration population used by the displayed average;
- missing stage maps produce an empty stage breakdown rather than an error;
- recent history is bounded to a small fixed number of rows, newest first.

## UI states and error handling

- Loading: render the page shell and muted placeholders for cards/panels.
- Empty history: explain that no completed render metrics exist for the selected period and offer the range selector/refresh action.
- Fetch failure: keep the page shell visible, show an inline retry message, and leave the rest of the dashboard navigation usable.
- Invalid range values: the backend falls back to the default 30-day range or returns a clear 400 response; the frontend never sends arbitrary values.
- Large values: format durations, byte counts, percentages, and dates through small shared display helpers so cards and history remain readable.

## Backend boundaries

Extend the jobs store with a list/summary read operation implemented by both the memory store and PostgreSQL store. Keep the existing single-render metric lookup and POST upsert behavior intact. Add a GET branch to the existing render-metrics handler or a focused handler helper, plus focused handler/store tests.

No schema migration is required: the current `render_performance_metrics` table and indexes contain the required fields. If query profiling reveals a missing index during implementation, add only the index needed by the selected completion-time range query.

## Frontend boundaries

Create a focused Performance dashboard component and a small data/display helper module rather than adding all chart and aggregation logic to `App.jsx`. Update routing and sidebar wiring in the existing app shell. Use CSS/grid utilities already present in the dashboard and keep chart rendering dependency-free unless the existing package already provides a suitable chart library.

## Verification and acceptance

Backend tests must cover:

- valid range parsing and default behavior;
- empty results;
- successful and failed metrics in one response;
- average/p95 calculation over successful renders;
- daily trend and stage aggregation;
- bounded newest-first recent history;
- invalid request handling.

Frontend tests must cover:

- `/performance` route selection and sidebar placement before Settings;
- period selection and refresh request parameters;
- summary and history rendering from a representative API response;
- loading, empty, and error states;
- no layout-level overflow caused by the new view.

The live app workflow must rebuild and restart the dashboard/backend through `scripts/manage-local.ps1`, then verify the Performance route and backend health. Existing unrelated worktree changes must be preserved.
