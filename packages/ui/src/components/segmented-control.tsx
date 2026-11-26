"use client";

import {
  SegmentedControl as SegmentedControlRoot,
  SegmentedControlIndicator,
  SegmentedControlItem,
} from "@ui-sdk/react/segmented-control";
import { cn } from "@optimax-starter/ui/lib/utils";

export interface SegmentedOption<T extends string = string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string = string> {
  id?: string;
  label?: string;
  value: T;
  onValueChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  disabled?: boolean;
  size?: "default" | "sm";
  className?: string;
}

export function SegmentedControl<T extends string = string>({
  id,
  label,
  value,
  onValueChange,
  options,
  disabled,
  size = "default",
  className,
}: SegmentedControlProps<T>) {
  return (
    <SegmentedControlRoot
      id={id}
      aria-label={label}
      value={value}
      onValueChange={(next, details) => {
        if (next === null || disabled) {
          details.cancel();
          return;
        }
        onValueChange(next);
      }}
      disabled={disabled}
      className={cn(
        "relative isolate inline-grid w-full auto-cols-fr grid-flow-col items-center gap-1 rounded-md border-[0.5px] border-input bg-[var(--surface-subtle)] p-1",
        size === "sm" ? "h-8" : "h-9",
        disabled && "opacity-60",
        className,
      )}
    >
      <SegmentedControlIndicator className="pointer-events-none absolute top-(--segmented-control-indicator-top) left-(--segmented-control-indicator-left) -z-10 h-(--segmented-control-indicator-height) w-(--segmented-control-indicator-width) rounded-[5px] border-[0.5px] border-border bg-card shadow-2xs transition-[top,left,width,height] duration-150 data-[activation-direction=none]:transition-none" />
      {options.map((option) => (
        <SegmentedControlItem
          key={option.value}
          value={option.value}
          disabled={Boolean(disabled || option.disabled)}
          data-segment-value={option.value}
          className={cn(
            "h-full min-w-0 truncate rounded-[5px] border-[0.5px] border-transparent px-1.5 font-medium leading-[18px] text-muted-foreground transition-colors duration-150 hover:text-foreground data-checked:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-45",
            size === "sm" ? "text-xs sm:px-2" : "text-xs sm:px-2.5 sm:text-sm",
          )}
        >
          {option.label}
        </SegmentedControlItem>
      ))}
    </SegmentedControlRoot>
  );
}
