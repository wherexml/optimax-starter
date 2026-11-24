import type * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// coss UI inspired compact status/label Badge mapped to starter semantic tokens.
const badgeVariants = cva(
  "inline-flex h-[22px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[5px] border-[0.5px] px-2 text-xs font-medium leading-none tabular-nums",
  {
    variants: {
      variant: {
        brand: "border-border bg-card text-foreground",
        success: "border-border bg-card text-foreground",
        warning: "border-border bg-card text-foreground",
        danger: "border-border bg-card text-foreground",
        outline: "border-border bg-card text-muted-foreground",
        neutral: "border-border bg-[var(--surface-subtle)] text-muted-foreground",
      },
    },
    defaultVariants: { variant: "neutral" },
  },
);

const STATUS_DOT_CLASSES: Partial<Record<NonNullable<BadgeProps["variant"]>, string>> = {
  brand: "bg-primary",
  success: "bg-[var(--success-solid)]",
  warning: "bg-[var(--warning-solid)]",
  danger: "bg-destructive",
};

export interface BadgeProps
  extends
    React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant = "neutral", children, ...props }: BadgeProps) {
  const dotClass = variant ? STATUS_DOT_CLASSES[variant] : undefined;
  return (
    <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props}>
      {dotClass ? <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full", dotClass)} /> : null}
      {children}
    </span>
  );
}
