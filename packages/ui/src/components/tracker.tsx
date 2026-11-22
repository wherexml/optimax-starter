import { DATA_TONE_STYLES, type DataTone } from "@optimax-starter/ui/lib/data-tone";
import { cn } from "@optimax-starter/ui/lib/utils";

export type TrackerStatus = "ok" | "warning" | "danger" | "active" | "idle";

export interface TrackerSlot {
  key: string;
  status: TrackerStatus;
  label?: string;
}

export interface TrackerProps {
  slots: readonly TrackerSlot[];
  ariaLabel?: string;
  className?: string;
}

const STATUS_TONE: Record<TrackerStatus, DataTone> = {
  ok: "success",
  warning: "warning",
  danger: "danger",
  active: "brand",
  idle: "neutral",
};

/** 监控式状态格条，用等宽细柱按时间序列展示健康度与任务结果。 */
export function Tracker({ slots, ariaLabel = "运行状态序列", className }: TrackerProps) {
  return (
    <div
      data-slot="tracker"
      role="group"
      aria-label={ariaLabel}
      className={cn("flex h-7 w-full items-center gap-[3px]", className)}
    >
      {slots.map((slot) => {
        const tone = STATUS_TONE[slot.status];
        const color =
          slot.status === "idle" ? DATA_TONE_STYLES.neutral.barSoft : DATA_TONE_STYLES[tone].solid;
        return (
          <div
            key={slot.key}
            title={slot.label}
            className="h-full min-w-[3px] flex-1 rounded-[3px] transition-opacity duration-150 hover:opacity-80"
            style={{ backgroundColor: color }}
          />
        );
      })}
    </div>
  );
}
