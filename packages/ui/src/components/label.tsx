import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@optimax-starter/ui/lib/utils";

// Explicit inline-flex avoids Tailwind v4 space-y margin collapse on bare inline <label>.
const labelVariants = cva(
  "inline-flex items-center gap-1.5 text-sm font-medium leading-5 text-foreground select-none peer-disabled:cursor-not-allowed peer-disabled:opacity-60",
);

export interface LabelProps
  extends
    React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>,
    VariantProps<typeof labelVariants> {
  required?: boolean;
  optional?: boolean;
}

const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  LabelProps
>(({ className, children, required, optional, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    data-slot="label"
    className={cn(labelVariants(), className)}
    {...props}
  >
    <span>{children}</span>
    {required && (
      <span aria-hidden="true" className="text-destructive font-semibold leading-none">
        *
      </span>
    )}
    {!required && optional && (
      <span aria-hidden="true" className="text-xs font-normal leading-[18px] text-muted-foreground">
        选填
      </span>
    )}
  </LabelPrimitive.Root>
));
Label.displayName = LabelPrimitive.Root.displayName;

export { Label, labelVariants };
