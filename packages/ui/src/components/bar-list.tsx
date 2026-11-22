import type { ReactNode } from "react";
import { DATA_TONE_STYLES, type DataTone } from "@optimax-starter/ui/lib/data-tone";
import { cn } from "@optimax-starter/ui/lib/utils";

export interface BarListItem {
  key: string;
  label: string;
  value: number;
  valueLabel?: string;
  tone?: DataTone;
  badge?: ReactNode;
}

export interface BarListProps {
  items: readonly BarListItem[];
  maxValue?: number;
  renderRow?: (item: BarListItem, content: ReactNode) => ReactNode;
  emptyLabel?: string;
  className?: string;
}

/** Tremor 风格紧凑水平排行条，以柔和浅色底条按比例表达分组体量。 */
export function BarList({
  items,
  maxValue,
  renderRow,
  emptyLabel = "暂无排行数据",
  className,
}: BarListProps) {
  if (!items.length) {
    return <p className={cn("m-0 text-xs text-muted-foreground", className)}>{emptyLabel}</p>;
  }

  const ceiling = Math.max(maxValue ?? Math.max(...items.map((item) => item.value), 1), 1);

  return (
    <ul data-slot="bar-list" className={cn("m-0 flex list-none flex-col gap-1.5 p-0", className)}>
      {items.map((item) => {
        const widthPct = item.value > 0 ? Math.max((item.value / ceiling) * 100, 4) : 0;
        const palette = DATA_TONE_STYLES[item.tone ?? "brand"];

        const barContent = (
          <div className="relative flex h-8 flex-1 items-center justify-between gap-3 overflow-hidden rounded-md px-2.5">
            <div
              aria-hidden="true"
              className="absolute inset-y-0 left-0 rounded-md transition-[width] duration-300 ease-out"
              style={{ width: `${widthPct}%`, backgroundColor: palette.barSoft }}
            />
            <span className="relative z-10 min-w-0 truncate text-sm font-medium text-foreground">
              {item.label}
            </span>
            <span className="relative z-10 flex-none text-xs font-semibold text-foreground tabular-nums">
              {item.valueLabel ?? item.value}
            </span>
          </div>
        );

        return (
          <li key={item.key} className="flex items-center gap-2">
            {renderRow ? renderRow(item, barContent) : barContent}
            {item.badge ? <div className="flex-none">{item.badge}</div> : null}
          </li>
        );
      })}
    </ul>
  );
}
