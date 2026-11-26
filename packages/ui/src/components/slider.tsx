"use client";

import {
  Slider as SliderRoot,
  SliderControl,
  SliderIndicator,
  SliderThumb,
  SliderTrack,
  SliderValue,
} from "@ui-sdk/react/slider";
import { cn } from "@optimax-starter/ui/lib/utils";
import type * as React from "react";

function Slider<Value extends number | number[] = number | number[]>({
  className,
  ...props
}: React.ComponentProps<typeof SliderRoot<Value>>) {
  return (
    <SliderRoot
      data-slot="slider"
      className={cn("relative flex w-full touch-none select-none flex-col gap-1.5", className)}
      {...props}
    />
  );
}

function StyledSliderControl({ className, ...props }: React.ComponentProps<typeof SliderControl>) {
  return (
    <SliderControl
      data-slot="slider-control"
      className={cn(
        "flex w-full cursor-pointer items-center py-2 data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

function StyledSliderTrack({ className, ...props }: React.ComponentProps<typeof SliderTrack>) {
  return (
    <SliderTrack
      data-slot="slider-track"
      className={cn("relative h-1.5 w-full grow rounded-full bg-muted", className)}
      {...props}
    />
  );
}

function StyledSliderIndicator({
  className,
  ...props
}: React.ComponentProps<typeof SliderIndicator>) {
  return (
    <SliderIndicator
      data-slot="slider-indicator"
      className={cn("absolute h-full rounded-full bg-primary", className)}
      {...props}
    />
  );
}

function StyledSliderThumb({ className, ...props }: React.ComponentProps<typeof SliderThumb>) {
  return (
    <SliderThumb
      data-slot="slider-thumb"
      className={cn(
        "block size-4 -translate-x-1/2 rounded-full border-2 border-primary bg-card shadow-xs transition-[transform,box-shadow] hover:scale-110 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/35 data-dragging:scale-110",
        className,
      )}
      {...props}
    />
  );
}

function StyledSliderValue({ className, ...props }: React.ComponentProps<typeof SliderValue>) {
  return (
    <SliderValue
      data-slot="slider-value"
      className={cn("font-mono text-xs font-semibold tabular-nums text-primary", className)}
      {...props}
    />
  );
}

export {
  Slider,
  StyledSliderControl as SliderControl,
  StyledSliderTrack as SliderTrack,
  StyledSliderIndicator as SliderIndicator,
  StyledSliderThumb as SliderThumb,
  StyledSliderValue as SliderValue,
};
