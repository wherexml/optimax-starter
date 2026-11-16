import * as React from "react";
import { cn } from "@optimax-starter/ui/lib/utils";

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      ref={ref}
      data-slot="textarea"
      className={cn(
        "flex min-h-[88px] w-full min-w-0 resize-y rounded-md border-[0.5px] border-input bg-card px-3 py-2.5 text-sm leading-[22px] text-foreground transition-[border-color,background-color,box-shadow] duration-150 placeholder:text-muted-foreground hover:border-[color:var(--foreground)]/30 focus-visible:border-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring read-only:bg-[var(--surface-subtle)] read-only:text-muted-foreground read-only:hover:border-input disabled:cursor-not-allowed disabled:bg-muted/60 disabled:text-muted-foreground disabled:opacity-75 disabled:hover:border-input aria-[invalid=true]:border-destructive aria-[invalid=true]:focus-visible:outline-destructive",
        className,
      )}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
