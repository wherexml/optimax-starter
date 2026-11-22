import type { ReactNode } from "react";
import { DATA_TONE_STYLES, type DataTone } from "@optimax-starter/ui/lib/data-tone";
import { cn } from "@optimax-starter/ui/lib/utils";

export interface CategoryBarSegment {
  key: string;
  label: string;
  value: number;
  tone?: DataTone;
}

export interface CategoryBarProps {
  segments: readonly CategoryBarSegment[];
  showLegend?: boolean;
  showPercentage?: boolean;
  renderLegendItem?: (segment: CategoryBarSegment & { percent: number }, content: ReactNode) => ReactNode;
  emptyLabel?: string;
  className?: string;
}

/** Tremor 风格分段占比条与交互式图例，适合展示状态或分类结构。 */
export function CategoryBar({
  segments,
  showLegend = true,
  showPercentage = true,
  renderLegendItem,
  emptyLabel = "暂无分布数据",
  className,
}: CategoryBarProps) {
  const total = segments.reduce((sum, seg) => sum + Math.max(seg.value, 0), 0);

  if (!segments.length) {
    return <p className={cn("m-0 text-xs text-muted-foreground", className)}>{emptyLabel}</p>;
  }

  const normalized = segments.map((seg) => {
    const safeValue = Math.max(seg.value, 0);
    const percent = total > 0 ? Math.round((safeValue / total) * 100) : 0;
    return { ...seg, value: safeValue, percent };
  });

  return (
    <div data-slot="category-bar" className={cn("flex flex-col gap-2.5", className)}>
      <div
        className="flex h-2 w-full items-center gap-[2px] overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={normalized.map((s) => `${s.label} ${s.value}`).join(" ")}
      >
        {total > 0
          ? normalized
              .filter((s) => s.value > 0)
              .map((seg) => {
                const palette = DATA_TONE_STYLES[seg.tone ?? "brand"];
                return (
                  <div
                    key={seg.key}
                    className="h-full rounded-full transition-[width] duration-300 ease-out"
                    style={{
                      width: `${(seg.value / total) * 100}%`,
                      backgroundColor: palette.solid,
                    }}
                    title={`${seg.label}: ${seg.value}`}
                  />
                );
              })
          : null}
      </div>

      {showLegend ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
          {normalized.map((seg) => {
            const palette = DATA_TONE_STYLES[seg.tone ?? "brand"];
            const itemNode = (
              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                <span
                  aria-hidden="true"
                  className="size-2 flex-none rounded-full"
                  style={{ backgroundColor: palette.solid }}
                />
                <span className="text-foreground">{seg.label}</span>
                <span className="font-medium text-foreground tabular-nums">{seg.value}</span>
                {showPercentage && total > 0 ? (
                  <span className="tabular-nums">({seg.percent}%)</span>
                ) : null}
              </span>
            );

            return (
              <span key={seg.key}>
                {renderLegendItem ? renderLegendItem(seg, itemNode) : itemNode}
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
