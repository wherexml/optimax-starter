import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

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
    className={cn("dialog-overlay fixed inset-0 z-50 bg-black/80", className)}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

// 居中只用 translate；进出场动效在 index.css 中只改 opacity 与独立的 scale 属性，二者互不覆盖。
const dialogContentVariants = cva(
  "dialog-content fixed left-1/2 top-1/2 z-50 grid w-full -translate-x-1/2 -translate-y-1/2 gap-4 border bg-background p-6 shadow-lg sm:rounded-lg",
  {
    variants: {
      size: {
        sm: "max-w-sm max-h-[80vh]", // 小弹窗 (384px)
        md: "max-w-2xl max-h-[85vh]", // 中等 (672px)
        lg: "max-w-3xl max-h-[90vh]", // 标准 (768px) - spec.md 推荐
        xl: "max-w-4xl max-h-[90vh]", // 大型 (896px)
        full: "max-w-7xl max-h-[95vh]", // 超大 (1280px)
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

interface DialogContentProps
  extends
    React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
    VariantProps<typeof dialogContentVariants> {}

/**
 * Rendered inside the Portal, so it mounts once per open. The opener is read
 * during the first render, before autofocus moves focus into the dialog.
 * Mouse/touch openers set the scale origin; keyboard or missing openers keep the center.
 */
const MotionContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  DialogContentProps
>(({ className, children, size, scrollable, ...props }, ref) => {
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
    // scale 以中心为默认原点，此时 rect 中心不受缩放影响。
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
  return (
    <DialogPrimitive.Content
      ref={setRefs}
      className={cn(dialogContentVariants({ size, scrollable }), className)}
      {...props}
    >
      {children}
      <DialogPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity data-[state=open]:bg-accent data-[state=open]:text-muted-foreground hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none">
        <X className="h-4 w-4" />
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
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className,
    )}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
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
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
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
    className={cn("text-sm text-muted-foreground", className)}
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
