"use client";

import {
  Resizable as ResizableRoot,
  ResizableHandle,
  ResizablePanel,
} from "@ui-sdk/react/resizable";
import { cn } from "@optimax-starter/ui/lib/utils";
import type * as React from "react";

function Resizable({ className, ...props }: React.ComponentProps<typeof ResizableRoot>) {
  return (
    <ResizableRoot data-slot="resizable" className={cn("flex w-full", className)} {...props} />
  );
}

function StyledResizablePanel({
  className,
  ...props
}: React.ComponentProps<typeof ResizablePanel>) {
  return (
    <ResizablePanel data-slot="resizable-panel" className={cn("min-w-0", className)} {...props} />
  );
}

function StyledResizableHandle({
  className,
  withHandle = true,
  ...props
}: React.ComponentProps<typeof ResizableHandle> & {
  withHandle?: boolean;
}) {
  return (
    <ResizableHandle
      data-slot="resizable-handle"
      className={cn(
        "group relative flex w-2 shrink-0 cursor-col-resize items-center justify-center select-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-border after:transition-colors hover:after:w-0.5 hover:after:bg-primary/60 data-dragging:after:w-0.5 data-dragging:after:bg-primary focus-visible:outline-none data-[orientation=vertical]:h-2 data-[orientation=vertical]:w-full data-[orientation=vertical]:cursor-row-resize data-[orientation=vertical]:after:inset-x-0 data-[orientation=vertical]:after:top-1/2 data-[orientation=vertical]:after:left-0 data-[orientation=vertical]:after:h-px data-[orientation=vertical]:after:w-full data-[orientation=vertical]:after:translate-x-0 data-[orientation=vertical]:after:-translate-y-1/2",
        className,
      )}
      {...props}
    >
      {withHandle ? (
        <span
          aria-hidden="true"
          className="relative z-10 h-8 w-1 rounded-full bg-border transition-colors group-hover:bg-primary/70 group-data-dragging:bg-primary"
        />
      ) : null}
    </ResizableHandle>
  );
}

export {
  Resizable,
  StyledResizablePanel as ResizablePanel,
  StyledResizableHandle as ResizableHandle,
};
