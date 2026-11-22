import { useId, useState, type ReactNode } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { DATA_TONE_STYLES, type DataTone } from "@optimax-starter/ui/lib/data-tone";
import { cn } from "@optimax-starter/ui/lib/utils";

export interface DonutSegment {
  key: string;
  label: string;
  value: number;
  tone?: DataTone;
}

export interface DonutChartProps {
  title: string;
  segments: readonly DonutSegment[];
  centerLabel?: string;
  centerValue?: string | number;
  emptyLabel?: string;
  footer?: ReactNode;
  className?: string;
}

interface DonutTooltipPayloadItem {
  name?: string;
  value?: unknown;
  payload?: DonutSegment & { pct: number };
}

function DonutTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: readonly DonutTooltipPayloadItem[];
}) {
  if (!active || !payload?.length) return null;
  const item = payload[0]?.payload;
  if (!item) return null;
  const color = DATA_TONE_STYLES[item.tone ?? "neutral"].solid;

  return (
    <div className="min-w-[128px] rounded-lg border-[0.5px] border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <div className="flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <span
            aria-hidden="true"
            className="size-2 flex-none rounded-full"
            style={{ backgroundColor: color }}
          />
          <span>{item.label}</span>
        </span>
        <span className="font-semibold text-foreground tabular-nums">
          {item.value}（{item.pct}%）
        </span>
      </div>
    </div>
  );
}

/** 环形构成分布图，支持中心指标展示与图例联动高亮。 */
export function DonutChart({
  title,
  segments,
  centerLabel,
  centerValue,
  emptyLabel = "暂无分布数据",
  footer,
  className,
}: DonutChartProps) {
  const headingId = useId();
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const positiveSegments = segments.filter((s) => s.value > 0);
  const total = positiveSegments.reduce((acc, s) => acc + s.value, 0);
  const chartData = positiveSegments.map((s) => ({
    ...s,
    pct: total > 0 ? Math.round((s.value / total) * 100) : 0,
  }));

  const focusedSegment = activeKey
    ? chartData.find((s) => s.key === activeKey) ?? null
    : null;
  const displayCenterValue = focusedSegment
    ? `${focusedSegment.pct}%`
    : (centerValue ?? total);
  const displayCenterLabel = focusedSegment
    ? focusedSegment.label
    : (centerLabel ?? "总计");

  return (
    <section
      data-slot="donut-chart"
      aria-labelledby={headingId}
      className={cn(
        "flex flex-col gap-3 rounded-xl border-[0.5px] border-border bg-card p-4 sm:p-5",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id={headingId} className="m-0 text-[15px] leading-6 font-semibold text-foreground">
          {title}
        </h2>
        <span className="text-xs font-medium text-muted-foreground tabular-nums">
          合计 {total}
        </span>
      </div>

      {total === 0 ? (
        <div className="grid min-h-[156px] place-items-center text-sm text-muted-foreground">
          {emptyLabel}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="relative mx-auto h-[156px] w-[156px]">
            <ResponsiveContainer width="100%" height={156} minWidth={0}>
              <PieChart>
                <Pie
                  data={chartData}
                  dataKey="value"
                  nameKey="label"
                  cx="50%"
                  cy="50%"
                  innerRadius={48}
                  outerRadius={68}
                  paddingAngle={chartData.length > 1 ? 2 : 0}
                  strokeWidth={0}
                  isAnimationActive={false}
                >
                  {chartData.map((entry) => {
                    const color = DATA_TONE_STYLES[entry.tone ?? "neutral"].solid;
                    const dimmed = activeKey !== null && activeKey !== entry.key;
                    return (
                      <Cell
                        key={entry.key}
                        fill={color}
                        fillOpacity={dimmed ? 0.28 : 1}
                        onMouseEnter={() => setActiveKey(entry.key)}
                        onMouseLeave={() => setActiveKey(null)}
                      />
                    );
                  })}
                </Pie>
                <Tooltip
                  content={(props) => (
                    <DonutTooltip
                      active={props.active}
                      payload={props.payload as readonly DonutTooltipPayloadItem[] | undefined}
                    />
                  )}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
              <strong className="text-xl leading-none font-semibold tracking-tight text-foreground tabular-nums">
                {displayCenterValue}
              </strong>
              <span className="mt-1 max-w-[82px] truncate text-[11px] leading-tight text-muted-foreground">
                {displayCenterLabel}
              </span>
            </div>
          </div>

          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {segments.map((seg) => {
              const palette = DATA_TONE_STYLES[seg.tone ?? "neutral"];
              const pct = total > 0 ? Math.round((seg.value / total) * 100) : 0;
              const isFocused = activeKey === seg.key;
              return (
                <li key={seg.key}>
                  <button
                    type="button"
                    onMouseEnter={() => (seg.value > 0 ? setActiveKey(seg.key) : undefined)}
                    onMouseLeave={() => setActiveKey(null)}
                    onClick={() =>
                      setActiveKey((prev) => (prev === seg.key ? null : seg.value > 0 ? seg.key : null))
                    }
                    className={cn(
                      "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-xs transition-colors",
                      isFocused ? "bg-muted text-foreground" : "hover:bg-muted/60",
                    )}
                  >
                    <span className="inline-flex min-w-0 items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="size-2 flex-none rounded-full"
                        style={{ backgroundColor: palette.solid }}
                      />
                      <span className="truncate text-foreground">{seg.label}</span>
                    </span>
                    <span className="shrink-0 font-medium text-foreground tabular-nums">
                      {seg.value}
                      <span className="ml-1.5 text-muted-foreground">{pct}%</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {footer ? <div className="mt-auto text-xs text-muted-foreground">{footer}</div> : null}
    </section>
  );
}
