"use client";

import { Switch as SwitchPrimitive, SwitchThumb } from "@ui-sdk/react/switch";
import { cn } from "@optimax-starter/ui/lib/utils";
import * as React from "react";

export interface SwitchProps
  extends Omit<
    React.ComponentProps<typeof SwitchPrimitive>,
    "checked" | "defaultChecked" | "onCheckedChange"
  > {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked, onCheckedChange, disabled, className, ...props }, ref) => (
    <SwitchPrimitive
      ref={ref}
      checked={checked}
      disabled={disabled}
      onCheckedChange={(next, details) => {
        if (disabled) {
          details.cancel();
          return;
        }
        onCheckedChange(next);
      }}
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-[0.5px] border-transparent p-0.5 transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 data-checked:bg-primary data-unchecked:border-input data-unchecked:bg-muted",
        className,
      )}
      {...props}
    >
      <SwitchThumb
        aria-hidden="true"
        className="pointer-events-none block size-4 rounded-full bg-white shadow-xs transition-transform duration-150 data-checked:translate-x-4 data-unchecked:translate-x-0"
      />
    </SwitchPrimitive>
  ),
);
Switch.displayName = "Switch";

export function SwitchField({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  className,
}: {
  id?: string;
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  const autoId = React.useId();
  const switchId = id ?? autoId;
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 rounded-lg border-[0.5px] border-border bg-[var(--surface-subtle)] px-3.5 py-2.5",
        disabled && "opacity-65",
        className,
      )}
    >
      <label htmlFor={switchId} className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5">
        <span className="text-sm font-medium leading-5 text-foreground">{label}</span>
        {description && (
          <span className="text-xs leading-[18px] text-muted-foreground">{description}</span>
        )}
      </label>
      <Switch
        id={switchId}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
    </div>
  );
}

export { Switch };
