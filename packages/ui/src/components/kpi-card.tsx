import type { ReactNode } from "react";
import { Button } from "@optimax-starter/ui/components/button";
import { SparkChart, type SparkChartDatum } from "@optimax-starter/ui/components/spark-chart";
import { DATA_TONE_STYLES, type DataTone } from "@optimax-starter/ui/lib/data-tone";
import { cn } from "@optimax-starter/ui/lib/utils";

export interface KpiCardProps {
  label: string;
  value: number | string;
  unit?: string;
  icon?: ReactNode;
  tone?: DataTone;
  badge?: ReactNode;
  sparkline?: readonly SparkChartDatum[];
  renderMain?: (content: ReactNode) => ReactNode;
  links?: readonly ReactNode[];
  note?: ReactNode;
  className?: string;
}

/** 标准化总览指标卡：支持图标、数字对比、迷你趋势线与底部下钻入口。 */
export function KpiCard({
  label,
  value,
  unit,
  icon,
  tone = "brand",
  badge,
  sparkline,
  renderMain,
  links = [],
  note,
  className,
}: KpiCardProps) {
  const style = DATA_TONE_STYLES[tone];

  const mainContent = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium text-muted-foreground">
          {icon ? (
            <span
              aria-hidden="true"
              className="flex size-4 flex-none items-center justify-center text-muted-foreground opacity-80 [&_svg]:size-4"
            >
              {icon}
            </span>
          ) : null}
          <span className="truncate">{label}</span>
        </span>
        {badge ? <span className="flex-none">{badge}</span> : null}
      </div>

      <div className="mt-1 flex items-end justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <span
            className="text-[28px] leading-[34px] font-semibold tracking-tight text-foreground tabular-nums"
            style={tone === "danger" ? { color: style.text } : undefined}
          >
            {value}
          </span>
          {unit ? <span className="text-xs text-muted-foreground">{unit}</span> : null}
        </div>
        {sparkline && sparkline.length > 1 ? (
          <div className="w-24 flex-none pb-0.5">
            <SparkChart data={sparkline} tone={tone} height={34} />
          </div>
        ) : null}
      </div>
    </>
  );

  return (
    <section
      data-slot="kpi-card"
      aria-label={label}
      className={cn(
        "flex min-h-[108px] flex-col justify-between gap-2 rounded-xl border-[0.5px] border-border bg-card p-4 transition-colors duration-150 ease-out hover:border-[color:var(--foreground)]/20",
        className,
      )}
    >
      {renderMain ? renderMain(mainContent) : mainContent}

      {links.length > 0 || note ? (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs leading-[18px] text-muted-foreground">
          {links.length > 0 ? (
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              {links.map((link, index) => (
                <span key={index} className="inline-flex items-center gap-1.5">
                  {index > 0 ? (
                    <span aria-hidden="true" className="text-border">
                      /
                    </span>
                  ) : null}
                  {link}
                </span>
              ))}
            </div>
          ) : null}
          {note ? <span>{note}</span> : null}
        </div>
      ) : null}
    </section>
  );
}

/** 指标卡加载占位骨架。 */
export function KpiCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      role="status"
      aria-label="正在加载指标"
      className={cn(
        "flex min-h-[120px] flex-col justify-between gap-3 rounded-xl border-[0.5px] border-border bg-card p-4 sm:p-5",
        className,
      )}
    >
      <div className="h-4 w-24 animate-pulse rounded bg-muted" />
      <div className="h-8 w-20 animate-pulse rounded bg-muted" />
      <div className="h-3.5 w-32 animate-pulse rounded bg-muted" />
    </div>
  );
}

/** 指标卡错误重试状态。 */
export function KpiCardError({
  message,
  onRetry,
  className,
}: {
  message?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex min-h-[120px] flex-col items-start justify-center gap-2 rounded-xl border-[0.5px] border-border bg-card p-4 text-sm text-muted-foreground sm:p-5",
        className,
      )}
    >
      <p className="m-0">{message || "加载失败"}</p>
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          重试
        </Button>
      ) : null}
    </div>
  );
}
