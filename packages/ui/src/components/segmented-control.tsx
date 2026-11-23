import { cn } from "@optimax-starter/ui/lib/utils";
import * as React from "react";

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
  className?: string;
}

export function SegmentedControl<T extends string = string>({
  id,
  label,
  value,
  onValueChange,
  options,
  disabled,
  className,
}: SegmentedControlProps<T>) {
  const groupRef = React.useRef<HTMLDivElement>(null);

  const move = (delta: number) => {
    const enabled = options.filter((o) => !o.disabled);
    if (!enabled.length || disabled) return;
    const idx = enabled.findIndex((o) => o.value === value);
    const next = enabled[(Math.max(idx, 0) + delta + enabled.length) % enabled.length];
    if (!next) return;
    onValueChange(next.value);
    const btn = groupRef.current?.querySelector<HTMLButtonElement>(
      `[data-segment-value="${CSS.escape(next.value)}"]`,
    );
    btn?.focus();
  };

  return (
    <div
      ref={groupRef}
      id={id}
      role="radiogroup"
      aria-label={label}
      data-slot="segmented-control"
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          e.preventDefault();
          move(1);
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          e.preventDefault();
          move(-1);
        }
      }}
      className={cn(
        "inline-grid h-9 w-full auto-cols-fr grid-flow-col items-center gap-1 rounded-md border-[0.5px] border-input bg-[var(--surface-subtle)] p-1",
        disabled && "opacity-60",
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.value === value;
        const itemDisabled = Boolean(disabled || option.disabled);
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={itemDisabled}
            data-segment-value={option.value}
            onClick={() => {
              if (!itemDisabled) onValueChange(option.value);
            }}
            className={cn(
              "h-full min-w-0 truncate rounded-[5px] px-1.5 text-xs font-medium leading-[18px] transition-[background-color,color,box-shadow] duration-150 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-45 sm:px-2.5 sm:text-sm",
              selected
                ? "border-[0.5px] border-border bg-card text-foreground shadow-2xs"
                : "border-[0.5px] border-transparent bg-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
