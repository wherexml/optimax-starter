import * as React from "react";
import { cn } from "@optimax-starter/ui/lib/utils";

export function FieldLayout({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="field"
      className={cn("flex min-w-0 flex-col gap-2", className)}
      {...props}
    />
  );
}

export function FieldLabelRow({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="field-label-row"
      className={cn("flex min-h-5 items-center justify-between gap-2", className)}
      {...props}
    />
  );
}

export function FieldCharCount({
  current,
  max,
  className,
}: {
  current: number;
  max: number;
  className?: string;
}) {
  const over = current > max;
  return (
    <span
      data-slot="field-char-count"
      aria-hidden="true"
      className={cn(
        "text-xs leading-[18px] tabular-nums text-muted-foreground",
        over && "font-medium text-destructive",
        className,
      )}
    >
      {current} / {max}
    </span>
  );
}

export function FieldHint({
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p
      data-slot="field-hint"
      className={cn("m-0 text-xs leading-[18px] text-muted-foreground", className)}
      {...props}
    />
  );
}

export function FieldError({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  if (!children) return null;
  return (
    <p
      role="alert"
      data-slot="field-error"
      className={cn("m-0 text-xs font-medium leading-[18px] text-destructive", className)}
      {...props}
    >
      {children}
    </p>
  );
}

export function FormSection({
  title,
  description,
  children,
  className,
  contentClassName,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <section
      data-slot="form-section"
      className={cn(
        "flex flex-col gap-4 border-t-[0.5px] border-border pt-5 first:border-t-0 first:pt-0",
        className,
      )}
    >
      <div className="flex flex-col gap-0.5">
        <h3 className="m-0 text-sm font-semibold leading-5 text-foreground">
          {title}
        </h3>
        {description && (
          <p className="m-0 text-xs leading-[18px] text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <div className={cn("grid gap-x-4 gap-y-4 sm:grid-cols-2", contentClassName)}>
        {children}
      </div>
    </section>
  );
}
