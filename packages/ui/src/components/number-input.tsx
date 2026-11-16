import * as React from "react";
import { Minus, Plus } from "lucide-react";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@optimax-starter/ui/components/input-group";
import { cn } from "@optimax-starter/ui/lib/utils";

export interface NumberInputProps
  extends Omit<React.ComponentProps<"input">, "type" | "value" | "onChange"> {
  value: number | "";
  onValueChange: (value: number | "") => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  label?: string;
  containerClassName?: string;
}

const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
  (
    {
      value,
      onValueChange,
      min,
      max,
      step = 1,
      unit,
      label = "数值",
      disabled,
      containerClassName,
      className,
      ...props
    },
    ref,
  ) => {
    const clamp = (n: number) => {
      let next = n;
      if (min !== undefined) next = Math.max(min, next);
      if (max !== undefined) next = Math.min(max, next);
      return next;
    };

    const adjust = (delta: number) => {
      if (disabled) return;
      const base = typeof value === "number" && Number.isFinite(value) ? value : (min ?? 0);
      onValueChange(clamp(base + delta));
    };

    const atMin = min !== undefined && typeof value === "number" && value <= min;
    const atMax = max !== undefined && typeof value === "number" && value >= max;

    return (
      <InputGroup className={containerClassName}>
        <InputGroupInput
          ref={ref}
          type="text"
          inputMode="numeric"
          disabled={disabled}
          value={value === "" ? "" : String(value)}
          onChange={(e) => {
            const raw = e.target.value.trim();
            if (raw === "") {
              onValueChange("");
              return;
            }
            if (!/^-?\d+$/.test(raw)) return;
            const parsed = Number(raw);
            if (Number.isSafeInteger(parsed)) onValueChange(parsed);
          }}
          onBlur={(e) => {
            if (typeof value === "number") onValueChange(clamp(value));
            props.onBlur?.(e);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp") {
              e.preventDefault();
              adjust(step);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              adjust(-step);
            }
            props.onKeyDown?.(e);
          }}
          className={cn("tabular-nums", className)}
          {...props}
        />
        {unit && (
          <InputGroupAddon align="inline-end" className="pr-2.5 text-xs text-muted-foreground">
            {unit}
          </InputGroupAddon>
        )}
        <div className="order-last flex shrink-0 items-stretch border-l-[0.5px] border-border">
          <button
            type="button"
            aria-label={`减少${label}`}
            disabled={disabled || atMin}
            onClick={() => adjust(-step)}
            className="grid w-8 place-items-center bg-transparent text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            <Minus className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label={`增加${label}`}
            disabled={disabled || atMax}
            onClick={() => adjust(step)}
            className="grid w-8 place-items-center border-l-[0.5px] border-border bg-transparent text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            <Plus className="size-3.5" />
          </button>
        </div>
      </InputGroup>
    );
  },
);
NumberInput.displayName = "NumberInput";

export { NumberInput };
