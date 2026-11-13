import React, { createContext, useContext, useId } from "react";
import { ResponsiveContainer, Tooltip, Legend } from "recharts";
import { cn } from "../../lib/utils";

const ChartContext = createContext(null);

const useChart = () => {
  const context = useContext(ChartContext);
  if (!context) {
    throw new Error("Chart components must be used within ChartContainer.");
  }
  return context;
};

const ChartContainer = ({
  config,
  className,
  children,
  id,
  style,
  ...props
}) => {
  const reactId = useId().replace(/:/g, "");
  const chartId = `chart-${id || reactId}`;
  const chartStyles = Object.fromEntries(
    Object.entries(config).flatMap(([key, value]) =>
      value.color ? [[`--color-${key}`, value.color]] : [],
    ),
  );

  return (
    <ChartContext.Provider value={{ config }}>
      <div
        data-slot="chart"
        data-chart={chartId}
        className={cn(
          "flex justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line]:stroke-border/50 [&_.recharts-layer]:outline-none [&_.recharts-surface]:outline-none",
          className,
        )}
        style={{ ...chartStyles, ...style }}
        {...props}
      >
        <ResponsiveContainer width="100%" height="100%">
          {children}
        </ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  );
};

const ChartTooltip = Tooltip;
const ChartLegend = Legend;

const ChartTooltipContent = ({
  active,
  payload,
  label,
  labelFormatter,
  valueFormatter,
  className,
}) => {
  const { config } = useChart();
  if (!active || !payload?.length) return null;

  const visiblePayload = payload.filter((item) => item.type !== "none");
  if (!visiblePayload.length) return null;

  return (
    <div
      className={cn(
        "grid min-w-32 gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-xs shadow-xl",
        className,
      )}
    >
      {label != null && (
        <div className="font-medium text-foreground">
          {labelFormatter ? labelFormatter(label, payload) : label}
        </div>
      )}
      <div className="grid gap-1.5">
        {visiblePayload.map((item, index) => {
          const key = String(item.dataKey || item.name || "value");
          const itemConfig = config[key];
          const color = item.color || itemConfig?.color;
          return (
            <div key={`${key}-${index}`} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-[2px]"
                style={{ backgroundColor: color }}
              />
              <span className="text-muted-foreground">
                {itemConfig?.label || item.name || key}
              </span>
              <span className="ml-auto font-mono font-medium tabular-nums text-foreground">
                {valueFormatter
                  ? valueFormatter(item.value, key)
                  : Number(item.value).toLocaleString()}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const ChartLegendContent = ({ payload, className }) => {
  const { config } = useChart();
  if (!payload?.length) return null;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-center gap-x-4 gap-y-2 pt-3 text-xs text-muted-foreground",
        className,
      )}
    >
      {payload.map((item, index) => {
        const key = String(item.dataKey || item.value || "value");
        return (
          <span
            key={`${key}-${index}`}
            className="inline-flex items-center gap-1.5"
          >
            <span
              aria-hidden="true"
              className="size-2 rounded-[2px]"
              style={{ backgroundColor: item.color || config[key]?.color }}
            />
            {config[key]?.label || item.value || key}
          </span>
        );
      })}
    </div>
  );
};

export {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
};
