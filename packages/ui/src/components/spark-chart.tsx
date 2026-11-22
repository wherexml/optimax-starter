import { useId } from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { DATA_TONE_STYLES, type DataTone } from "@optimax-starter/ui/lib/data-tone";
import { cn } from "@optimax-starter/ui/lib/utils";

export interface SparkChartDatum {
  label?: string;
  value: number;
}

export interface SparkChartProps {
  data: readonly SparkChartDatum[];
  tone?: DataTone;
  height?: number;
  ariaLabel?: string;
  className?: string;
}

/** 轻量迷你面积折线图，用于 KPI 卡片内展示近期趋势。 */
export function SparkChart({
  data,
  tone = "brand",
  height = 36,
  ariaLabel,
  className,
}: SparkChartProps) {
  const rawId = useId();
  const gradId = `spark-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const palette = DATA_TONE_STYLES[tone];

  if (!data.length) return null;

  const a11yProps = ariaLabel
    ? { role: "img" as const, "aria-label": ariaLabel }
    : { "aria-hidden": true as const };

  return (
    <div
      data-slot="spark-chart"
      {...a11yProps}
      className={cn("min-w-0 w-full select-none", className)}
      style={{ height }}
    >
      <ResponsiveContainer width="100%" height={height} minWidth={0}>
        <AreaChart data={[...data]} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={palette.solid} stopOpacity={0.26} />
              <stop offset="95%" stopColor={palette.solid} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="value"
            stroke={palette.solid}
            strokeWidth={1.75}
            fill={`url(#${gradId})`}
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
