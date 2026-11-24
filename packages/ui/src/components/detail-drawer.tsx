import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

import { Button } from "@optimax-starter/ui/components/button";
import {
  Dialog,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@optimax-starter/ui/components/dialog";
import { cn } from "@optimax-starter/ui/lib/utils";

const drawerContentVariants = cva(
  "drawer-content fixed inset-y-0 right-0 z-50 flex h-full w-full flex-col border-l-[0.5px] border-border bg-card text-card-foreground shadow-[0_16px_48px_rgb(33_32_28/0.16),0_2px_8px_rgb(33_32_28/0.06)] outline-none",
  {
    variants: {
      size: {
        sm: "sm:max-w-[420px]",
        md: "sm:max-w-[520px]",
        lg: "sm:max-w-[640px]",
      },
    },
    defaultVariants: {
      size: "md",
    },
  },
);

const isToastRegionTarget = (target: EventTarget | null) =>
  target instanceof Element &&
  Boolean(target.closest('[data-slot="toast-region"]'));

export interface DetailDrawerNavigation {
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
  current?: number;
  total?: number;
}

export interface DetailDrawerProps
  extends VariantProps<typeof drawerContentVariants> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  navigation?: DetailDrawerNavigation;
  footer?: React.ReactNode;
  children: React.ReactNode;
  bodyClassName?: string;
  onCloseAutoFocus?: React.ComponentProps<
    typeof DialogPrimitive.Content
  >["onCloseAutoFocus"];
}

export function DetailDrawer({
  open,
  onOpenChange,
  title,
  description,
  badge,
  actions,
  navigation,
  footer,
  size,
  children,
  bodyClassName,
  onCloseAutoFocus,
}: DetailDrawerProps) {
  const box = React.useRef<HTMLDivElement | null>(null);

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
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          ref={box}
          data-slot="detail-drawer"
          className={cn(drawerContentVariants({ size }))}
          onCloseAutoFocus={onCloseAutoFocus}
          onPointerDownOutside={(e) => {
            if (
              isToastRegionTarget(e.detail.originalEvent.target) ||
              isToastRegionTarget(e.target)
            ) {
              e.preventDefault();
            }
          }}
          onFocusOutside={(e) => {
            if (
              isToastRegionTarget(e.detail.originalEvent.target) ||
              isToastRegionTarget(e.target)
            ) {
              e.preventDefault();
            }
          }}
          onInteractOutside={(e) => {
            if (
              isToastRegionTarget(e.detail.originalEvent.target) ||
              isToastRegionTarget(e.target)
            ) {
              e.preventDefault();
            }
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
            }
          }}
          {...(!description ? { "aria-describedby": undefined } : {})}
        >
          <div className="shrink-0 border-b-[0.5px] border-border px-6 py-4 pr-14">
            <div className="flex flex-wrap items-center gap-2">
              <DialogTitle>{title}</DialogTitle>
              {badge}
            </div>
            {description && (
              <DialogDescription className="mt-1">
                {description}
              </DialogDescription>
            )}
          </div>

          {actions && (
            <div
              data-slot="detail-drawer-actions"
              className="flex shrink-0 flex-wrap items-center gap-1.5 border-b-[0.5px] border-border bg-[var(--surface-subtle)] px-6 py-2.5"
            >
              {actions}
            </div>
          )}

          <DialogPrimitive.Close
            type="button"
            className="absolute right-4 top-3.5 grid size-9 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <X className="size-4" />
            <span className="sr-only">关闭</span>
          </DialogPrimitive.Close>

          <div
            data-slot="detail-drawer-body"
            className={cn(
              "min-h-0 flex-1 overflow-y-auto px-6 py-5",
              bodyClassName,
            )}
          >
            <div className="flex flex-col gap-5">{children}</div>
          </div>

          {(navigation || footer) && (
            <div
              data-slot="detail-drawer-footer"
              className="shrink-0 border-t-[0.5px] border-border bg-[var(--surface-subtle)] px-6 py-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                {navigation ? (
                  <div
                    data-slot="detail-drawer-nav"
                    className="flex items-center gap-1.5"
                  >
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!navigation.hasPrev}
                      aria-label="上一个"
                      onClick={navigation.onPrev}
                    >
                      <ChevronLeft className="size-4" aria-hidden="true" />
                      <span>上一个</span>
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={!navigation.hasNext}
                      aria-label="下一个"
                      onClick={navigation.onNext}
                    >
                      <span>下一个</span>
                      <ChevronRight className="size-4" aria-hidden="true" />
                    </Button>
                    {navigation.current !== undefined &&
                      navigation.total !== undefined &&
                      navigation.total > 0 && (
                        <span className="ml-1 text-xs tabular-nums text-muted-foreground">
                          {navigation.current} / {navigation.total}
                        </span>
                      )}
                  </div>
                ) : null}
                {footer ? (
                  <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
                    {footer}
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

export function DetailSection({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      data-slot="detail-section"
      className={cn("flex flex-col gap-3", className)}
    >
      <h3 className="m-0 border-b-[0.5px] border-border pb-2 text-sm font-semibold leading-5 text-foreground">
        {title}
      </h3>
      <dl className="m-0 grid gap-3 sm:grid-cols-2">{children}</dl>
    </section>
  );
}

export function DetailField({
  label,
  children,
  fullWidth = false,
}: {
  label: string;
  children: React.ReactNode;
  fullWidth?: boolean;
}) {
  return (
    <div
      data-slot="detail-field"
      className={cn("min-w-0", fullWidth && "sm:col-span-2")}
    >
      <dt className="text-xs leading-[18px] text-muted-foreground">{label}</dt>
      <dd className="m-0 mt-1 text-sm leading-[22px] text-foreground break-words">
        {children}
      </dd>
    </div>
  );
}
