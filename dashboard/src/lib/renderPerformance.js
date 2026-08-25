import { getApiUrl } from "../config";

export const RENDER_METRIC_RANGES = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "all", label: "All time" },
];

export const DEFAULT_RENDER_METRIC_RANGE = "30d";

const allowedRanges = new Set(RENDER_METRIC_RANGES.map(({ value }) => value));

export const normalizeRenderMetricRange = (value) =>
  allowedRanges.has(value) ? value : DEFAULT_RENDER_METRIC_RANGE;

export const buildRenderMetricsUrl = (range) =>
  getApiUrl(
    `/api/render-metrics?range=${encodeURIComponent(normalizeRenderMetricRange(range))}`,
  );

const formatDecimal = (value) => Number(value.toFixed(1)).toString();

export const formatDuration = (milliseconds) => {
  const value = Math.max(0, Number(milliseconds) || 0);
  if (value < 1000) return `${Math.round(value)}ms`;

  const totalSeconds = value / 1000;
  if (totalSeconds < 60) return `${formatDecimal(totalSeconds)}s`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return seconds > 0 ? `${minutes}m ${formatDecimal(seconds)}s` : `${minutes}m`;
};

export const formatBytes = (bytes) => {
  const value = Math.max(0, Number(bytes) || 0);
  if (value === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(
    units.length - 1,
    Math.floor(Math.log(value) / Math.log(1024)),
  );
  return `${formatDecimal(value / 1024 ** exponent)} ${units[exponent]}`;
};

export const formatPercent = (value) => `${Number(value || 0).toFixed(1)}%`;

export const normalizeRenderPerformanceSummary = (payload) => {
  const source = payload && typeof payload === "object" ? payload : {};
  const summary =
    source.summary && typeof source.summary === "object" ? source.summary : {};
  const accelerationCounts =
    summary.acceleration_counts &&
    typeof summary.acceleration_counts === "object"
      ? summary.acceleration_counts
      : {};

  return {
    range: normalizeRenderMetricRange(source.range),
    from: source.from || null,
    to: source.to || null,
    summary: {
      render_count: Number(summary.render_count) || 0,
      successful_count: Number(summary.successful_count) || 0,
      failed_count: Number(summary.failed_count) || 0,
      success_rate: Number(summary.success_rate) || 0,
      average_duration_ms: Number(summary.average_duration_ms) || 0,
      p95_duration_ms: Number(summary.p95_duration_ms) || 0,
      total_output_bytes: Number(summary.total_output_bytes) || 0,
      acceleration_counts: {
        cpu: Number(accelerationCounts.cpu) || 0,
        gpu: Number(accelerationCounts.gpu) || 0,
      },
    },
    trend: Array.isArray(source.trend) ? source.trend : [],
    stages: Array.isArray(source.stages) ? source.stages : [],
    recent: Array.isArray(source.recent) ? source.recent : [],
  };
};
