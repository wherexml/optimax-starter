import { useId, useState, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { SegmentedControl, type SegmentedOption } from "@optimax-starter/ui/components/segmented-control";
import { DATA_TONE_STYLES, type DataTone } from "@optimax-starter/ui/lib/data-tone";
import { cn } from "@optimax-starter/ui/lib/utils";

export interface TrendSeries {
  key: string;
  label: string;
  tone?: DataTone;
}

export interface TrendRangeOption<T extends string = string> extends SegmentedOption<T> {}

export type TrendChartType = "area" | "bar";

export interface TrendSummaryMetric {
  label: string;
  value: string | number;
  hint?: string;
}

export interface TrendAreaChartProps<T extends string = string> {
  title: string;
  subtitle?: string;
  data: readonly Record<string, string | number>[];
  xKey?: string;
  series: readonly TrendSeries[];
  range?: T;
  rangeOptions?: readonly TrendRangeOption<T>[];
  onRangeChange?: (next: T) => void;
  chartType?: TrendChartType;
  onChartTypeChange?: (next: TrendChartType) => void;
  summaryMetrics?: readonly TrendSummaryMetric[];
  height?: number;
  emptyLabel?: string;
  footer?: ReactNode;
  className?: string;
}

interface TooltipPayloadEntry {
  dataKey?: string | number;
  name?: string;
  value?: unknown;
  color?: string;
}

interface ChartTooltipProps {
  active?: boolean;
  label?: unknown;
  payload?: readonly TooltipPayloadEntry[];
  seriesMap: Map<string, TrendSeries>;
}

function ChartTooltipContent({ active, label, payload, seriesMap }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;

  return (
    <div className="min-w-[140px] rounded-lg border-[0.5px] border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      {label !== undefined && label !== "" ? (
        <div className="mb-1.5 font-medium text-foreground tabular-nums">{String(label)}</div>
      ) : null}
      <div className="flex flex-col gap-1">
        {payload.map((entry) => {
          const key = String(entry.dataKey ?? "");
          const meta = seriesMap.get(key);
          const color = meta
            ? DATA_TONE_STYLES[meta.tone ?? "brand"].solid
            : entry.color || "var(--primary)";
          return (
            <div key={key} className="flex items-center justify-between gap-4">
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <span
                  aria-hidden="true"
                  className="size-2 flex-none rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span>{meta?.label ?? entry.name ?? key}</span>
              </span>
              <span className="font-semibold text-foreground tabular-nums">
                {typeof entry.value === "number" ? entry.value : String(entry.value ?? 0)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 交互式多序列趋势图表，支持面积/柱状视图与时间区间切换、概览摘要条及自适应悬浮提示。 */
export function TrendAreaChart<T extends string = string>({
  title,
  subtitle,
  data,
  xKey = "label",
  series,
  range,
  rangeOptions,
  onRangeChange,
  chartType,
  onChartTypeChange,
  summaryMetrics,
  height = 200,
  emptyLabel = "所选时间范围内暂无记录",
  footer,
  className,
}: TrendAreaChartProps<T>) {
  const headingId = useId();
  const baseGradId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const [innerChartType, setInnerChartType] = useState<TrendChartType>("area");
  const activeChartType = chartType ?? innerChartType;
  const handleChartTypeChange = (next: TrendChartType) => {
    if (onChartTypeChange) {
      onChartTypeChange(next);
    } else {
      setInnerChartType(next);
    }
  };
  const showTypeSwitch =
    chartType !== undefined || onChartTypeChange !== undefined || series.length > 0;
  const seriesMap = new Map(series.map((s) => [s.key, s]));

  const totals = new Map<string, number>();
  for (const s of series) totals.set(s.key, 0);
  for (const row of data) {
    for (const s of series) {
      const val = Number(row[s.key] ?? 0);
      if (Number.isFinite(val)) totals.set(s.key, (totals.get(s.key) ?? 0) + val);
    }
  }

  return (
    <section
      data-slot="trend-area-chart"
      aria-labelledby={headingId}
      className={cn(
        "flex flex-col gap-3 rounded-xl border-[0.5px] border-border bg-card p-4 sm:p-5",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={headingId} className="m-0 text-[15px] leading-6 font-semibold text-foreground">
            {title}
          </h2>
          {subtitle ? <p className="m-0 mt-0.5 text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {showTypeSwitch ? (
            <div className="w-auto min-w-[104px]">
              <SegmentedControl
                label="图表形态"
                value={activeChartType}
                onValueChange={handleChartTypeChange}
                options={[
                  { value: "area", label: "面积" },
                  { value: "bar", label: "柱状" },
                ]}
                className="h-8"
              />
            </div>
          ) : null}
          {range && rangeOptions?.length && onRangeChange ? (
            <div className="w-auto min-w-[120px]">
              <SegmentedControl
                label="时间范围"
                value={range}
                onValueChange={onRangeChange}
                options={rangeOptions}
                className="h-8"
              />
            </div>
          ) : null}
        </div>
      </div>

      {summaryMetrics && summaryMetrics.length > 0 ? (
        <div
          className={cn(
            "grid grid-cols-2 gap-px overflow-hidden rounded-lg border-[0.5px] border-border bg-border",
            summaryMetrics.length >= 4
              ? "sm:grid-cols-4"
              : summaryMetrics.length === 3
                ? "sm:grid-cols-3"
                : "sm:grid-cols-2",
          )}
        >
          {summaryMetrics.map((metric) => (
            <div key={metric.label} className="bg-card px-3 py-2">
              <div className="text-[11px] text-muted-foreground">{metric.label}</div>
              <div className="mt-0.5 flex items-baseline gap-1.5">
                <span className="text-[15px] font-semibold text-foreground tabular-nums">
                  {metric.value}
                </span>
                {metric.hint ? (
                  <span className="truncate text-[11px] text-muted-foreground">{metric.hint}</span>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {series.length > 0 ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {series.map((s) => {
            const palette = DATA_TONE_STYLES[s.tone ?? "brand"];
            return (
              <span key={s.key} className="inline-flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="size-2 flex-none rounded-full"
                  style={{ backgroundColor: palette.solid }}
                />
                <span>{s.label}</span>
                <span className="font-semibold text-foreground tabular-nums">
                  {totals.get(s.key) ?? 0}
                </span>
              </span>
            );
          })}
        </div>
      ) : null}

      {!data.length ? (
        <div
          className="grid place-items-center text-sm text-muted-foreground"
          style={{ height }}
        >
          {emptyLabel}
        </div>
      ) : (
        <div className="min-w-0 w-full select-none" style={{ height }}>
          <ResponsiveContainer width="100%" height={height} minWidth={0}>
            {activeChartType === "bar" ? (
              <BarChart data={[...data]} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid
                  vertical={false}
                  stroke="var(--border)"
                  strokeDasharray="3 3"
                  strokeOpacity={0.65}
                />
                <XAxis
                  dataKey={xKey}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={24}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                />
                <YAxis
                  allowDecimals={false}
                  width={38}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                />
                <Tooltip
                  cursor={{ fill: "var(--muted)", fillOpacity: 0.35 }}
                  content={(props) => (
                    <ChartTooltipContent
                      active={props.active}
                      label={props.label}
                      payload={props.payload as readonly TooltipPayloadEntry[] | undefined}
                      seriesMap={seriesMap}
                    />
                  )}
                />
                {series.map((s, idx) => {
                  const palette = DATA_TONE_STYLES[s.tone ?? "brand"];
                  const isTop = idx === series.length - 1;
                  return (
                    <Bar
                      key={s.key}
                      dataKey={s.key}
                      name={s.label}
                      stackId="trend"
                      fill={palette.solid}
                      maxBarSize={26}
                      radius={isTop ? [3, 3, 0, 0] : [0, 0, 0, 0]}
                      isAnimationActive={false}
                    />
                  );
                })}
              </BarChart>
            ) : (
              <AreaChart data={[...data]} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                <defs>
                  {series.map((s) => {
                    const palette = DATA_TONE_STYLES[s.tone ?? "brand"];
                    return (
                      <linearGradient
                        key={s.key}
                        id={`${baseGradId}-${s.key}`}
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop offset="5%" stopColor={palette.solid} stopOpacity={0.24} />
                        <stop offset="95%" stopColor={palette.solid} stopOpacity={0.02} />
                      </linearGradient>
                    );
                  })}
                </defs>
                <CartesianGrid
                  vertical={false}
                  stroke="var(--border)"
                  strokeDasharray="3 3"
                  strokeOpacity={0.65}
                />
                <XAxis
                  dataKey={xKey}
                  tickLine={false}
                  axisLine={false}
                  minTickGap={24}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                />
                <YAxis
                  allowDecimals={false}
                  width={38}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                />
                <Tooltip
                  cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
                  content={(props) => (
                    <ChartTooltipContent
                      active={props.active}
                      label={props.label}
                      payload={props.payload as readonly TooltipPayloadEntry[] | undefined}
                      seriesMap={seriesMap}
                    />
                  )}
                />
                {series.map((s) => {
                  const palette = DATA_TONE_STYLES[s.tone ?? "brand"];
                  return (
                    <Area
                      key={s.key}
                      type="monotone"
                      dataKey={s.key}
                      name={s.label}
                      stroke={palette.solid}
                      strokeWidth={1.85}
                      fill={`url(#${baseGradId}-${s.key})`}
                      isAnimationActive={false}
                      activeDot={{ r: 3.5, strokeWidth: 0, fill: palette.solid }}
                    />
                  );
                })}
              </AreaChart>
            )}
          </ResponsiveContainer>
        </div>
      )}

      {footer ? <div className="text-xs text-muted-foreground">{footer}</div> : null}
    </section>
  );
}
