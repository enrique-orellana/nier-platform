import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  HardDrive,
  RefreshCw,
  XCircle,
  Zap,
} from "lucide-react";
import {
  buildRenderMetricsUrl,
  DEFAULT_RENDER_METRIC_RANGE,
  formatBytes,
  formatDuration,
  formatPercent,
  normalizeRenderPerformanceSummary,
  RENDER_METRIC_RANGES,
} from "../lib/renderPerformance";

const EMPTY_SUMMARY = normalizeRenderPerformanceSummary({});

const formatRecentDate = (value) => {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatStageName = (value) =>
  String(value || "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());

const chartPoints = (trend, key, width = 560, height = 180) => {
  if (trend.length === 0) return "";
  const values = trend.map((point) => Number(point[key]) || 0);
  const maximum = Math.max(1, ...values);
  return values
    .map((value, index) => {
      const x =
        trend.length === 1 ? width / 2 : (index / (trend.length - 1)) * width;
      const y = height - (value / maximum) * (height - 12) - 6;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
};

const MetricCard = ({ label, value, detail, icon: Icon, tone = "cyan" }) => (
  <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
    <div className="flex items-center justify-between gap-3">
      <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
        {label}
      </span>
      <Icon
        size={16}
        className={
          tone === "green"
            ? "text-emerald-400"
            : tone === "violet"
              ? "text-violet-400"
              : "text-cyan-400"
        }
      />
    </div>
    <div className="mt-3 text-2xl font-bold tracking-tight text-white">
      {value}
    </div>
    <div className="mt-1 text-xs text-zinc-500">{detail}</div>
  </div>
);

const TrendChart = ({ trend }) => {
  const averagePoints = chartPoints(trend, "average_duration_ms");
  const p95Points = chartPoints(trend, "p95_duration_ms");
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-white">Render duration</h2>
          <p className="mt-1 text-xs text-zinc-500">Average and p95 by day</p>
        </div>
        <div className="flex items-center gap-4 text-[11px] text-zinc-400">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-cyan-300" /> Average
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-violet-400" /> P95
          </span>
        </div>
      </div>
      {trend.length === 0 ? (
        <div className="mt-8 flex h-40 items-center justify-center text-sm text-zinc-500">
          No timing trend in this period.
        </div>
      ) : (
        <div className="mt-5 overflow-hidden rounded-xl bg-black/10 p-2">
          <svg
            viewBox="0 0 560 180"
            className="h-44 w-full"
            role="img"
            aria-label="Render duration trend"
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient id="performance-grid" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stopColor="rgba(99,199,255,0.16)" />
                <stop offset="1" stopColor="rgba(99,199,255,0)" />
              </linearGradient>
            </defs>
            {[45, 90, 135].map((y) => (
              <line
                key={y}
                x1="0"
                x2="560"
                y1={y}
                y2={y}
                stroke="rgba(255,255,255,0.08)"
                strokeDasharray="4 6"
              />
            ))}
            <polyline
              points={averagePoints}
              fill="none"
              stroke="#67d5ff"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <polyline
              points={p95Points}
              fill="none"
              stroke="#a78bfa"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <div className="flex justify-between px-1 text-[10px] text-zinc-600">
            <span>{trend[0]?.date || ""}</span>
            <span>{trend[trend.length - 1]?.date || ""}</span>
          </div>
        </div>
      )}
    </div>
  );
};

const StageBreakdown = ({ stages }) => (
  <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
    <h2 className="text-sm font-semibold text-white">Stage breakdown</h2>
    <p className="mt-1 text-xs text-zinc-500">
      Successful render time by stage
    </p>
    <div className="mt-5 space-y-4">
      {stages.length === 0 ? (
        <div className="flex h-40 items-center justify-center text-sm text-zinc-500">
          No stage timing recorded.
        </div>
      ) : (
        stages.map((stage, index) => (
          <div key={stage.name}>
            <div className="mb-2 flex items-center justify-between gap-3 text-xs">
              <span className="truncate text-zinc-300">
                {formatStageName(stage.name)}
              </span>
              <span className="shrink-0 text-zinc-500">
                {formatPercent(stage.share)}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className={`h-full rounded-full ${index % 3 === 0 ? "bg-cyan-300" : index % 3 === 1 ? "bg-violet-400" : "bg-emerald-400"}`}
                style={{
                  width: `${Math.min(100, Math.max(0, Number(stage.share) || 0))}%`,
                }}
              />
            </div>
          </div>
        ))
      )}
    </div>
  </div>
);

const StatusCell = ({ status }) =>
  status === "done" ? (
    <span className="inline-flex items-center gap-1.5 text-emerald-400">
      <CheckCircle2 size={13} /> Done
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-rose-400">
      <XCircle size={13} /> Failed
    </span>
  );

const RecentRenders = ({ recent }) => (
  <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 className="text-sm font-semibold text-white">Recent renders</h2>
        <p className="mt-1 text-xs text-zinc-500">Newest first</p>
      </div>
      <Activity size={16} className="text-zinc-600" />
    </div>
    <div className="mt-4 overflow-x-auto">
      {recent.length === 0 ? (
        <div className="flex h-24 items-center justify-center text-sm text-zinc-500">
          No recent renders.
        </div>
      ) : (
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead className="text-[10px] uppercase tracking-[0.12em] text-zinc-600">
            <tr className="border-b border-white/10">
              <th className="px-3 py-3 font-medium">Render</th>
              <th className="px-3 py-3 font-medium">Status</th>
              <th className="px-3 py-3 font-medium">Duration</th>
              <th className="px-3 py-3 font-medium">Mode</th>
              <th className="px-3 py-3 font-medium">Output</th>
              <th className="px-3 py-3 font-medium">Finished</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 text-zinc-300">
            {recent.map((render) => (
              <tr key={render.render_id}>
                <td className="whitespace-nowrap px-3 py-3">
                  <div className="font-medium text-white">
                    clip_
                    {String(Number(render.clip_index) + 1).padStart(2, "0")}
                  </div>
                  <div className="mt-1 text-[10px] text-zinc-600">
                    {render.version_id || render.render_id}
                  </div>
                </td>
                <td className="whitespace-nowrap px-3 py-3">
                  <StatusCell status={render.status} />
                </td>
                <td className="whitespace-nowrap px-3 py-3">
                  {formatDuration(render.total_duration_ms)}
                </td>
                <td className="whitespace-nowrap px-3 py-3">
                  <span className="inline-flex items-center gap-1.5 text-zinc-400">
                    {render.acceleration_mode === "gpu" ? (
                      <Zap size={13} className="text-amber-300" />
                    ) : (
                      <Cpu size={13} className="text-zinc-500" />
                    )}
                    {String(render.acceleration_mode || "—").toUpperCase()}
                  </span>
                </td>
                <td className="whitespace-nowrap px-3 py-3">
                  {render.output_bytes ? formatBytes(render.output_bytes) : "—"}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-zinc-500">
                  {formatRecentDate(render.finished_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  </div>
);

const DashboardSkeleton = () => (
  <div data-testid="performance-loading" className="space-y-4">
    <div className="h-24 animate-pulse rounded-2xl bg-white/5" />
    <div className="grid gap-4 lg:grid-cols-[1.35fr_0.9fr]">
      <div className="h-72 animate-pulse rounded-2xl bg-white/5" />
      <div className="h-72 animate-pulse rounded-2xl bg-white/5" />
    </div>
    <div className="h-44 animate-pulse rounded-2xl bg-white/5" />
  </div>
);

export default function PerformanceDashboard() {
  const [range, setRange] = useState(DEFAULT_RENDER_METRIC_RANGE);
  const [refreshToken, setRefreshToken] = useState(0);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError("");

    fetch(buildRenderMetricsUrl(range), { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Unable to load render performance.");
        return response.json();
      })
      .then((payload) => {
        if (active) setData(normalizeRenderPerformanceSummary(payload));
      })
      .catch((cause) => {
        if (active && cause.name !== "AbortError") setError(cause.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [range, refreshToken]);

  const summary = data || EMPTY_SUMMARY;
  const acceleration = summary.summary.acceleration_counts;
  const hasMetrics = summary.summary.render_count > 0;
  const rangeLabel = useMemo(
    () =>
      RENDER_METRIC_RANGES.find((option) => option.value === range)?.label ||
      "Last 30 days",
    [range],
  );

  return (
    <div className="h-full overflow-y-auto custom-scrollbar p-5 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6 pb-8">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-300">
                <Activity size={21} />
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-white">
                  Performance
                </h1>
                <p className="mt-1 text-sm text-zinc-500">
                  Render performance across completed jobs.
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor="performance-range">
              Performance range
            </label>
            <select
              id="performance-range"
              aria-label="Performance range"
              value={range}
              onChange={(event) => setRange(event.target.value)}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-zinc-200 outline-none transition-colors focus:border-cyan-400/50"
            >
              {RENDER_METRIC_RANGES.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                  className="bg-zinc-900"
                >
                  {option.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setRefreshToken((current) => current + 1)}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-zinc-300 transition-colors hover:bg-white/10 hover:text-white"
              aria-label="Refresh performance metrics"
            >
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          </div>
        </header>

        {error && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-200">
            <span className="inline-flex items-center gap-2">
              <AlertTriangle size={16} /> {error}
            </span>
            <button
              type="button"
              onClick={() => setRefreshToken((current) => current + 1)}
              className="rounded-lg border border-rose-300/30 px-3 py-1.5 text-xs font-medium text-rose-100 hover:bg-rose-300/10"
            >
              Retry
            </button>
          </div>
        )}

        {loading && !data ? (
          <>
            <p className="sr-only">Loading performance metrics…</p>
            <DashboardSkeleton />
          </>
        ) : !hasMetrics ? (
          <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.025] px-6 py-20 text-center">
            <HardDrive className="mx-auto text-zinc-600" size={28} />
            <h2 className="mt-4 text-lg font-semibold text-white">
              No render metrics yet
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-zinc-500">
              Completed renders will appear here. The selected period is{" "}
              {rangeLabel.toLowerCase()}.
            </p>
          </div>
        ) : (
          <>
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                label="Renders"
                value={summary.summary.render_count}
                detail={`${summary.summary.failed_count} failed in ${rangeLabel.toLowerCase()}`}
                icon={Activity}
              />
              <MetricCard
                label="Success rate"
                value={formatPercent(summary.summary.success_rate)}
                detail={`${summary.summary.successful_count} completed successfully`}
                icon={CheckCircle2}
                tone="green"
              />
              <MetricCard
                label="Avg / p95"
                value={formatDuration(summary.summary.average_duration_ms)}
                detail={`p95 · ${formatDuration(summary.summary.p95_duration_ms)}`}
                icon={Activity}
                tone="violet"
              />
              <MetricCard
                label="Acceleration"
                value={`${acceleration.gpu} GPU`}
                detail={`${acceleration.cpu} CPU renders`}
                icon={Cpu}
              />
            </section>

            <section className="grid gap-4 lg:grid-cols-[1.35fr_0.9fr]">
              <TrendChart trend={summary.trend} />
              <StageBreakdown stages={summary.stages} />
            </section>

            <section className="rounded-2xl border border-white/10 bg-white/[0.035] p-5">
              <div className="flex items-center gap-3">
                <HardDrive size={17} className="text-cyan-300" />
                <div>
                  <h2 className="text-sm font-semibold text-white">
                    Output volume
                  </h2>
                  <p className="mt-1 text-xs text-zinc-500">
                    Total encoded output in this period
                  </p>
                </div>
                <span className="ml-auto text-lg font-semibold text-white">
                  {formatBytes(summary.summary.total_output_bytes)}
                </span>
              </div>
            </section>

            <RecentRenders recent={summary.recent} />
          </>
        )}
      </div>
    </div>
  );
}
