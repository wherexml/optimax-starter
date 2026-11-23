import { cn } from "@optimax-starter/ui/lib/utils";
import * as React from "react";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type = "text", ...props }, ref) => {
    return (
      <input
        type={type}
        data-slot="input"
        className={cn(
          "flex h-9 w-full min-w-0 rounded-md border-[0.5px] border-input bg-card px-3 py-1.5 text-sm leading-5 text-foreground transition-[border-color,background-color,box-shadow] duration-150 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground hover:border-[color:var(--foreground)]/30 focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring read-only:bg-[var(--surface-subtle)] read-only:text-muted-foreground read-only:hover:border-input disabled:cursor-not-allowed disabled:bg-muted/60 disabled:text-muted-foreground disabled:opacity-75 disabled:hover:border-input aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:outline-destructive",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
