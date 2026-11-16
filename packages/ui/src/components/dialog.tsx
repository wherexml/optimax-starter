import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@optimax-starter/ui/lib/utils";

const Dialog = DialogPrimitive.Root;
const DialogTrigger = DialogPrimitive.Trigger;
const DialogPortal = DialogPrimitive.Portal;
const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "dialog-overlay fixed inset-0 z-50 bg-[rgb(33_32_28/0.42)]",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

// Centered via translate only; CSS animates opacity + standalone scale so position never shifts.
const dialogContentVariants = cva(
  "dialog-content fixed left-1/2 top-1/2 z-50 grid w-[calc(100vw-24px)] sm:w-[calc(100vw-48px)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border-[0.5px] border-border bg-card p-6 text-card-foreground shadow-[0_16px_48px_rgb(33_32_28/0.16),0_2px_8px_rgb(33_32_28/0.06)]",
  {
    variants: {
      size: {
        sm: "max-w-md max-h-[85dvh]",
        md: "max-w-[580px] max-h-[88dvh]",
        lg: "max-w-3xl max-h-[90dvh]",
        xl: "max-w-4xl max-h-[90dvh]",
        full: "max-w-6xl max-h-[92dvh]",
      },
      scrollable: {
        true: "overflow-y-auto",
        false: "",
      },
    },
    defaultVariants: {
      size: "lg",
      scrollable: true,
    },
  },
);

export interface DialogContentProps
  extends
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
    VariantProps<typeof dialogContentVariants> {
  closeClassName?: string;
}

const isToastRegionTarget = (target: EventTarget | null) =>
  target instanceof Element &&
  Boolean(target.closest('[data-slot="toast-region"]'));

// Reads document.activeElement on initial mount inside Portal (before autofocus moves focus)
// so pointer openers set the scale origin while keyboard openers keep center origin.
const MotionContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(
  (
    {
      className,
      closeClassName,
      children,
      size,
      scrollable,
      onPointerDownOutside,
      onFocusOutside,
      onInteractOutside,
      onEscapeKeyDown,
      ...props
    },
    ref,
  ) => {
  const [opener] = React.useState<Element | null>(() =>
    typeof document === "undefined" ? null : document.activeElement,
  );
  const box = React.useRef<HTMLDivElement | null>(null);
  const setRefs = React.useCallback(
    (node: HTMLDivElement | null) => {
      box.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );
  React.useLayoutEffect(() => {
    const node = box.current;
    if (
      !node ||
      !(opener instanceof HTMLElement) ||
      opener === document.body ||
      !opener.isConnected ||
      opener.matches(":focus-visible")
    )
      return;
    const from = opener.getBoundingClientRect();
    if (!from.width && !from.height) return;
    const to = node.getBoundingClientRect();
    const clamp = (v: number, half: number) =>
      Math.round(Math.max(-half, Math.min(half, v)));
    const dx = clamp(from.left + from.width / 2 - (to.left + to.width / 2), to.width / 2);
    const dy = clamp(from.top + from.height / 2 - (to.top + to.height / 2), to.height / 2);
    node.style.setProperty(
      "--dialog-origin",
      `calc(50% + ${dx}px) calc(50% + ${dy}px)`,
    );
  }, [opener]);
    React.useEffect(() => {
      const node = box.current;
      if (!node) return;
      const allowToastFocus = (ev: FocusEvent) => {
        if (isToastRegionTarget(ev.relatedTarget)) {
          ev.stopPropagation();
        }
      };
      node.addEventListener("focusout", allowToastFocus);
      return () => node.removeEventListener("focusout", allowToastFocus);
    }, []);
    return (
      <DialogPrimitive.Content
        ref={setRefs}
        data-slot="dialog-content"
        className={cn(dialogContentVariants({ size, scrollable }), className)}
        onPointerDownOutside={(e) => {
          if (isToastRegionTarget(e.detail.originalEvent.target) || isToastRegionTarget(e.target)) {
            e.preventDefault();
            return;
          }
          onPointerDownOutside?.(e);
        }}
        onFocusOutside={(e) => {
          if (isToastRegionTarget(e.detail.originalEvent.target) || isToastRegionTarget(e.target)) {
            e.preventDefault();
            return;
          }
          onFocusOutside?.(e);
        }}
        onInteractOutside={(e) => {
          if (isToastRegionTarget(e.detail.originalEvent.target) || isToastRegionTarget(e.target)) {
            e.preventDefault();
            return;
          }
          onInteractOutside?.(e);
        }}
        onEscapeKeyDown={(e) => {
          const active = document.activeElement;
          if (isToastRegionTarget(active) || isToastRegionTarget(e.target)) {
            e.preventDefault();
            const toastEl =
              (active instanceof HTMLElement
                ? active.closest('[data-slot="toast"]')
                : null) ??
              (e.target instanceof HTMLElement
                ? e.target.closest('[data-slot="toast"]')
                : null);
            toastEl
              ?.querySelector<HTMLButtonElement>('[data-slot="toast-close"]')
              ?.click();
            return;
          }
          onEscapeKeyDown?.(e);
        }}
        {...props}
      >
      {children}
      <DialogPrimitive.Close
        className={cn(
          "absolute right-3.5 top-3.5 grid size-8 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none",
          closeClassName,
        )}
      >
        <X className="size-4" />
        <span className="sr-only">关闭</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  );
});
MotionContent.displayName = "DialogMotionContent";

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>((props, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <MotionContent ref={ref} {...props} />
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    data-slot="dialog-header"
    className={cn("flex flex-col gap-1 text-left", className)}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    data-slot="dialog-footer"
    className={cn(
      "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    data-slot="dialog-title"
    className={cn(
      "m-0 text-[18px] font-semibold leading-7 tracking-normal text-foreground",
      className,
    )}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    data-slot="dialog-description"
    className={cn("m-0 text-sm leading-5 text-muted-foreground", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
