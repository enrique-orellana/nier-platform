import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronsLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  Cpu,
  HardDrive,
  RefreshCw,
  Search,
  XCircle,
  Zap,
} from "lucide-react";
import { Area, AreaChart, CartesianGrid, Legend, XAxis, YAxis } from "recharts";
import {
  buildRenderMetricsUrl,
  DEFAULT_RENDER_METRIC_RANGE,
  DEFAULT_RENDER_PAGE_SIZE,
  formatBytes,
  formatDuration,
  formatPercent,
  normalizeRenderPerformanceSummary,
  RENDER_METRIC_RANGES,
} from "../lib/renderPerformance";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ChartContainer,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui";

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

const formatAxisDuration = (milliseconds) => {
  const value = Math.max(0, Number(milliseconds) || 0);
  if (value >= 60000) {
    const minutes = value / 60000;
    return `${Number(minutes.toFixed(minutes >= 10 ? 0 : 1))}m`;
  }
  if (value >= 1000) return `${Math.round(value / 1000)}s`;
  return `${Math.round(value)}ms`;
};

const formatChartDate = (value) => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

const MetricCard = ({ label, value, detail, icon: Icon, tone = "cyan" }) => (
  <Card className="rounded-xl p-4">
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Icon
        size={16}
        className={
          tone === "green"
            ? "text-emerald-500"
            : tone === "violet"
              ? "text-violet-400"
              : "text-primary"
        }
      />
    </div>
    <div className="mt-3 text-2xl font-semibold tracking-tight text-card-foreground">
      {value}
    </div>
    <div className="mt-1 text-sm text-muted-foreground">{detail}</div>
  </Card>
);

const renderDurationChartConfig = {
  average_duration_ms: {
    label: "Average",
    color: "hsl(var(--chart-1))",
  },
  p95_duration_ms: {
    label: "P95",
    color: "hsl(var(--chart-2))",
  },
};

const TrendChart = ({ trend }) => (
  <Card>
    <CardHeader>
      <CardTitle>Render duration</CardTitle>
      <CardDescription>Average and p95 by day</CardDescription>
    </CardHeader>
    <CardContent className="px-2 pt-0 sm:px-6">
      {trend.length === 0 ? (
        <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
          No timing trend in this period.
        </div>
      ) : (
        <ChartContainer
          config={renderDurationChartConfig}
          className="h-[260px] w-full"
          aria-label="Render duration trend"
        >
          <AreaChart
            accessibilityLayer
            data={trend}
            margin={{ top: 8, right: 12, left: 4, bottom: 0 }}
          >
            <defs>
              <linearGradient
                id="renderAverageFill"
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop
                  offset="5%"
                  stopColor="var(--color-average_duration_ms)"
                  stopOpacity={0.2}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-average_duration_ms)"
                  stopOpacity={0.02}
                />
              </linearGradient>
              <linearGradient id="renderP95Fill" x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="5%"
                  stopColor="var(--color-p95_duration_ms)"
                  stopOpacity={0.12}
                />
                <stop
                  offset="95%"
                  stopColor="var(--color-p95_duration_ms)"
                  stopOpacity={0.01}
                />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={32}
              tickFormatter={formatChartDate}
            />
            <YAxis
              width={48}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={formatAxisDuration}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  labelFormatter={formatChartDate}
                  valueFormatter={formatDuration}
                />
              }
            />
            <Legend verticalAlign="bottom" content={<ChartLegendContent />} />
            <Area
              dataKey="p95_duration_ms"
              type="monotone"
              stroke="var(--color-p95_duration_ms)"
              strokeWidth={2}
              fill="url(#renderP95Fill)"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
            />
            <Area
              dataKey="average_duration_ms"
              type="monotone"
              stroke="var(--color-average_duration_ms)"
              strokeWidth={2}
              fill="url(#renderAverageFill)"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 0 }}
            />
          </AreaChart>
        </ChartContainer>
      )}
    </CardContent>
  </Card>
);

const StageBreakdown = ({ stages }) => (
  <Card className="rounded-xl p-5">
    <h2 className="text-base font-semibold text-card-foreground">
      Stage breakdown
    </h2>
    <p className="mt-1 text-sm text-muted-foreground">
      Successful render time by stage
    </p>
    <div className="mt-5 space-y-4">
      {stages.length === 0 ? (
        <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
          No stage timing recorded.
        </div>
      ) : (
        stages.map((stage, index) => (
          <div key={stage.name}>
            <div className="mb-2 flex items-center justify-between gap-3 text-xs">
              <span className="truncate text-sm text-card-foreground">
                {formatStageName(stage.name)}
              </span>
              <span className="shrink-0 text-sm text-muted-foreground">
                {formatPercent(stage.share)}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
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
  </Card>
);

const StatusCell = ({ status }) =>
  status === "done" ? (
    <Badge variant="outline" className="gap-1.5 px-1.5 font-normal">
      <CheckCircle2
        size={13}
        className="fill-emerald-500/15 text-emerald-500"
      />
      Done
    </Badge>
  ) : (
    <Badge variant="outline" className="gap-1.5 px-1.5 font-normal">
      <XCircle size={13} className="text-destructive" />
      Failed
    </Badge>
  );

const RecentRenders = ({
  recent,
  total,
  page,
  pageSize,
  status,
  mode,
  search,
  onPageChange,
  onPageSizeChange,
  onStatusChange,
  onModeChange,
  onSearchChange,
}) => {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const firstResult = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastResult = Math.min(page * pageSize, total);

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            Recent renders
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Newest completed and failed renders
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="sr-only" htmlFor="performance-render-search">
          Search renders
        </label>
        <div className="relative w-full sm:max-w-sm">
          <Search
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id="performance-render-search"
            aria-label="Search renders"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Filter renders..."
            className="h-9 pl-9"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor="performance-status-filter">
            Render status filter
          </label>
          <Select value={status} onValueChange={onStatusChange}>
            <SelectTrigger
              id="performance-status-filter"
              aria-label="Render status filter"
              className="w-[150px]"
            >
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="done">Completed</SelectItem>
              <SelectItem value="error">Failed</SelectItem>
            </SelectContent>
          </Select>
          <label className="sr-only" htmlFor="performance-mode-filter">
            Acceleration filter
          </label>
          <Select value={mode} onValueChange={onModeChange}>
            <SelectTrigger
              id="performance-mode-filter"
              aria-label="Acceleration filter"
              className="w-[140px]"
            >
              <SelectValue placeholder="All modes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All modes</SelectItem>
              <SelectItem value="gpu">GPU</SelectItem>
              <SelectItem value="cpu">CPU</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border">
        {recent.length === 0 ? (
          <div className="flex h-24 items-center justify-center bg-card text-sm text-muted-foreground">
            No renders match these filters.
          </div>
        ) : (
          <Table className="min-w-[720px]">
            <TableHeader className="sticky top-0 z-10 bg-muted">
              <TableRow>
                <TableHead>Render</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Mode</TableHead>
                <TableHead>Output</TableHead>
                <TableHead>Finished</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recent.map((render) => (
                <TableRow key={render.render_id}>
                  <TableCell>
                    <div className="font-medium text-foreground">
                      clip_
                      {String(Number(render.clip_index) + 1).padStart(2, "0")}
                    </div>
                    <div className="mt-1 max-w-[260px] truncate font-mono text-xs text-muted-foreground">
                      {render.version_id || render.render_id}
                    </div>
                  </TableCell>
                  <TableCell>
                    <StatusCell status={render.status} />
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {formatDuration(render.total_duration_ms)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className="gap-1.5 px-1.5 font-normal text-muted-foreground"
                    >
                      {render.acceleration_mode === "gpu" ? (
                        <Zap size={13} />
                      ) : (
                        <Cpu size={13} />
                      )}
                      {String(render.acceleration_mode || "—").toUpperCase()}
                    </Badge>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {render.output_bytes
                      ? formatBytes(render.output_bytes)
                      : "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatRecentDate(render.finished_at)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      <div className="flex flex-col gap-3 px-1 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted-foreground">
          {firstResult}–{lastResult} of {total} renders
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label
              htmlFor="performance-page-size"
              className="whitespace-nowrap text-sm font-medium"
            >
              Rows per page
            </label>
            <Select
              value={String(pageSize)}
              onValueChange={(value) => onPageSizeChange(Number(value))}
            >
              <SelectTrigger
                id="performance-page-size"
                aria-label="Rows per page"
                className="h-8 w-[72px]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent side="top">
                {[10, 25, 50].map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-center text-sm font-medium text-foreground">
            Page {page} of {totalPages}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              type="button"
              aria-label="First render page"
              disabled={page <= 1}
              onClick={() => onPageChange(1)}
              className="size-8"
            >
              <ChevronsLeft />
            </Button>
            <Button
              variant="outline"
              size="icon"
              type="button"
              aria-label="Previous render page"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
              className="size-8"
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="outline"
              size="icon"
              type="button"
              aria-label="Next render page"
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
              className="size-8"
            >
              <ChevronRight />
            </Button>
            <Button
              variant="outline"
              size="icon"
              type="button"
              aria-label="Last render page"
              disabled={page >= totalPages}
              onClick={() => onPageChange(totalPages)}
              className="size-8"
            >
              <ChevronsRight />
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
};

const DashboardSkeleton = () => (
  <div data-testid="performance-loading" className="space-y-4">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index} className="h-24 animate-pulse rounded-xl bg-muted" />
      ))}
    </div>
    <div className="grid gap-4 lg:grid-cols-[1.35fr_0.9fr]">
      <div className="h-72 animate-pulse rounded-xl bg-muted" />
      <div className="h-72 animate-pulse rounded-xl bg-muted" />
    </div>
    <div className="h-44 animate-pulse rounded-xl bg-muted" />
  </div>
);

export default function PerformanceDashboard() {
  const [range, setRange] = useState(DEFAULT_RENDER_METRIC_RANGE);
  const [refreshToken, setRefreshToken] = useState(0);
  const [recentPage, setRecentPage] = useState(1);
  const [recentPageSize, setRecentPageSize] = useState(
    DEFAULT_RENDER_PAGE_SIZE,
  );
  const [recentStatus, setRecentStatus] = useState("all");
  const [recentMode, setRecentMode] = useState("all");
  const [recentSearch, setRecentSearch] = useState("");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError("");

    fetch(
      buildRenderMetricsUrl(range, {
        page: recentPage,
        pageSize: recentPageSize,
        status: recentStatus,
        mode: recentMode,
        search: recentSearch,
      }),
      { signal: controller.signal },
    )
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
  }, [
    range,
    recentPage,
    recentPageSize,
    recentStatus,
    recentMode,
    recentSearch,
    refreshToken,
  ]);

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
              <div className="flex size-10 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Activity size={20} />
              </div>
              <div>
                <h1 className="text-2xl font-semibold tracking-tight text-foreground">
                  Performance
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Render performance across completed jobs.
                </p>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor="performance-range">
              Performance range
            </label>
            <Select
              value={range}
              onValueChange={(value) => {
                setRange(value);
                setRecentPage(1);
              }}
            >
              <SelectTrigger
                id="performance-range"
                aria-label="Performance range"
                className="w-36"
              >
                <SelectValue placeholder={rangeLabel} />
              </SelectTrigger>
              <SelectContent>
                {RENDER_METRIC_RANGES.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => setRefreshToken((current) => current + 1)}
              className="rounded-md border border-input bg-background text-foreground hover:bg-accent hover:text-accent-foreground"
              aria-label="Refresh performance metrics"
            >
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
          </div>
        </header>

        {error && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <span className="inline-flex items-center gap-2">
              <AlertTriangle size={16} /> {error}
            </span>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => setRefreshToken((current) => current + 1)}
              className="rounded-md border border-destructive/50 text-destructive hover:bg-destructive/10"
            >
              Retry
            </Button>
          </div>
        )}

        {loading && !data ? (
          <>
            <p className="sr-only">Loading performance metrics…</p>
            <DashboardSkeleton />
          </>
        ) : !hasMetrics ? (
          <Card className="rounded-xl border-dashed px-6 py-20 text-center shadow-none">
            <HardDrive className="mx-auto text-muted-foreground" size={28} />
            <h2 className="mt-4 text-lg font-semibold text-card-foreground">
              No render metrics yet
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              Completed renders will appear here. The selected period is{" "}
              {rangeLabel.toLowerCase()}.
            </p>
          </Card>
        ) : (
          <>
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
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
              <MetricCard
                label="Output volume"
                value={formatBytes(summary.summary.total_output_bytes)}
                detail="Total encoded output in this period"
                icon={HardDrive}
              />
            </section>

            <section className="grid gap-4 lg:grid-cols-[1.35fr_0.9fr]">
              <TrendChart trend={summary.trend} />
              <StageBreakdown stages={summary.stages} />
            </section>

            <RecentRenders
              recent={summary.recent}
              total={summary.recent_total}
              page={recentPage}
              pageSize={recentPageSize}
              status={recentStatus}
              mode={recentMode}
              search={recentSearch}
              onPageChange={setRecentPage}
              onPageSizeChange={(value) => {
                setRecentPageSize(value);
                setRecentPage(1);
              }}
              onStatusChange={(value) => {
                setRecentStatus(value);
                setRecentPage(1);
              }}
              onModeChange={(value) => {
                setRecentMode(value);
                setRecentPage(1);
              }}
              onSearchChange={(value) => {
                setRecentSearch(value);
                setRecentPage(1);
              }}
            />
          </>
        )}
      </div>
    </div>
  );
}
