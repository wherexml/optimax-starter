"use client";

import {
  Tooltip as TooltipPrimitive,
  TooltipArrow as TooltipArrowPrimitive,
  TooltipContent as TooltipContentPrimitive,
  TooltipTrigger as TooltipTriggerPrimitive,
} from "@ui-sdk/react/tooltip";
import { cn } from "@optimax-starter/ui/lib/utils";
import * as React from "react";

const TooltipDelayContext = React.createContext<number | undefined>(undefined);

function TooltipProvider({ delay = 0, children }: { delay?: number; children?: React.ReactNode }) {
  return <TooltipDelayContext.Provider value={delay}>{children}</TooltipDelayContext.Provider>;
}

function Tooltip({ delay, ...props }: React.ComponentProps<typeof TooltipPrimitive>) {
  const inheritedDelay = React.useContext(TooltipDelayContext);
  return <TooltipPrimitive data-slot="tooltip" delay={delay ?? inheritedDelay} {...props} />;
}

function TooltipTrigger({ ...props }: React.ComponentProps<typeof TooltipTriggerPrimitive>) {
  return <TooltipTriggerPrimitive data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  side = "top",
  sideOffset = 6,
  align = "center",
  alignOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipContentPrimitive>) {
  return (
    <TooltipContentPrimitive
      data-slot="tooltip-content"
      align={align}
      alignOffset={alignOffset}
      side={side}
      sideOffset={sideOffset}
      className={cn(
        "z-50 inline-flex w-fit max-w-xs origin-(--transform-origin) items-center gap-1.5 rounded-md bg-foreground px-2.5 py-1.5 text-xs text-background shadow-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
        className,
      )}
      {...props}
    >
      {(state) => (
        <>
          {typeof children === "function" ? children(state) : children}
          <TooltipArrowPrimitive className="z-50 size-2 translate-y-[calc(-50%-1px)] rotate-45 rounded-[1px] bg-foreground fill-foreground data-[side=bottom]:top-0.5 data-[side=left]:top-1/2 data-[side=left]:-right-1 data-[side=left]:-translate-y-1/2 data-[side=right]:top-1/2 data-[side=right]:-left-1 data-[side=right]:-translate-y-1/2 data-[side=top]:-bottom-1.5" />
        </>
      )}
    </TooltipContentPrimitive>
  );
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
