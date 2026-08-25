import { describe, expect, it } from "vitest";
import {
  buildRenderMetricsUrl,
  formatBytes,
  formatDuration,
  formatPercent,
  normalizeRenderPerformanceSummary,
} from "./renderPerformance";

describe("render performance helpers", () => {
  it("builds an API URL for the selected range", () => {
    expect(buildRenderMetricsUrl("7d")).toContain(
      "/api/render-metrics?range=7d",
    );
  });

  it("formats durations and byte counts for dashboard cards", () => {
    expect(formatDuration(42800)).toBe("42.8s");
    expect(formatDuration(71400)).toBe("1m 11.4s");
    expect(formatBytes(42800000)).toBe("40.8 MB");
    expect(formatPercent(98.6)).toBe("98.6%");
  });

  it("normalizes incomplete API payloads without browser aggregation", () => {
    const normalized = normalizeRenderPerformanceSummary({});

    expect(normalized.summary.render_count).toBe(0);
    expect(normalized.summary.acceleration_counts).toEqual({ cpu: 0, gpu: 0 });
    expect(normalized.trend).toEqual([]);
    expect(normalized.stages).toEqual([]);
    expect(normalized.recent).toEqual([]);
  });

  it("falls back to the default range for unsupported values", () => {
    expect(buildRenderMetricsUrl("365d")).toContain("range=30d");
  });
});
