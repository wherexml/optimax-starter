import { useCallback, useRef } from "react";
import {
  Toast as ToastPrimitive,
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastRegion,
  ToastTitle,
  createToaster,
  toast,
  type ToastData,
  type ToastOptions,
  type ToastRegionProps,
  type ToastType,
  type Toaster as ToasterController,
} from "@ui-sdk/react/toast";
import {
  CircleAlert,
  CircleCheck,
  Info,
  LoaderCircle,
  TriangleAlert,
  X,
} from "lucide-react";

function ToastStatusIcon({ type }: { type: ToastType }) {
  switch (type) {
    case "success":
      return <CircleCheck className="om-toast-icon" aria-hidden="true" />;
    case "info":
      return <Info className="om-toast-icon" aria-hidden="true" />;
    case "warning":
      return <TriangleAlert className="om-toast-icon" aria-hidden="true" />;
    case "error":
      return <CircleAlert className="om-toast-icon" aria-hidden="true" />;
    case "loading":
      return (
        <LoaderCircle
          className="om-toast-icon om-toast-spin"
          aria-hidden="true"
        />
      );
    default:
      return null;
  }
}

export interface ToasterProps
  extends Omit<ToastRegionProps, "children" | "side" | "align"> {
  side?: "bottom" | "top";
  align?: "end" | "center" | "start";
}

export function Toaster({
  side = "bottom",
  align = "end",
  maxVisible = 4,
  shortcut = "F6",
  pendingAnnouncement = "正在处理…",
  "aria-label": ariaLabel = "全局通知",
  ...props
}: ToasterProps) {
  const cleanupRef = useRef<(() => void) | null>(null);
  const attachRegionRef = useCallback((node: HTMLElement | null) => {
    cleanupRef.current?.();
    cleanupRef.current = null;
    if (!node) return;
    const clearModalAriaHidden = () => {
      if (node.hasAttribute("data-aria-hidden") || node.getAttribute("aria-hidden") === "true") {
        node.removeAttribute("aria-hidden");
        node.removeAttribute("data-aria-hidden");
      }
    };
    clearModalAriaHidden();
    const observer = new MutationObserver(clearModalAriaHidden);
    observer.observe(node, {
      attributes: true,
      attributeFilter: ["aria-hidden", "data-aria-hidden"],
    });
    const stopForModal = (ev: Event) => {
      if (document.querySelector('[data-slot="dialog-content"]')) {
        ev.stopPropagation();
      }
    };
    node.addEventListener("focusin", stopForModal);
    cleanupRef.current = () => {
      observer.disconnect();
      node.removeEventListener("focusin", stopForModal);
    };
  }, []);

  return (
    <ToastRegion
      ref={attachRegionRef}
      side={side}
      align={align}
      maxVisible={maxVisible}
      shortcut={shortcut}
      pendingAnnouncement={pendingAnnouncement}
      aria-label={ariaLabel}
      // Empty toast region drops its accessible label; hide from UI SDK agent snapshots.
      data-agent-hidden=""
      {...props}
    >
      {(item) => {
        const type = item.type ?? "default";
        const dismissible = item.dismissible !== false;
        const showClose = dismissible && type !== "loading";
        return (
          <ToastPrimitive
            render={(toastProps, state) => (
              <li
                {...toastProps}
                inert={
                  state.leaving ||
                  (!state.expanded && state.index > 0) ||
                  undefined
                }
              />
            )}
          >
            <div className="om-toast-body">
              <ToastStatusIcon type={type} />
              <div className="om-toast-copy">
                <ToastTitle className="om-toast-title" />
                <ToastDescription className="om-toast-description" />
              </div>
              {(item.action || item.cancel || showClose) && (
                <div className="om-toast-actions">
                  {item.action && <ToastAction className="om-toast-action" />}
                  {item.cancel ? (
                    <ToastClose
                      action={item.cancel.onCancel}
                      className="om-toast-cancel"
                    >
                      {item.cancel.label}
                    </ToastClose>
                  ) : (
                    showClose && (
                      <ToastClose
                        aria-label="关闭通知"
                        title="关闭通知"
                        className="om-toast-close"
                      >
                        <X aria-hidden="true" />
                      </ToastClose>
                    )
                  )}
                </div>
              )}
            </div>
          </ToastPrimitive>
        );
      }}
    </ToastRegion>
  );
}

export {
  ToastPrimitive,
  ToastAction,
  ToastClose,
  ToastDescription,
  ToastRegion,
  ToastTitle,
  createToaster,
  toast,
  type ToastData,
  type ToastOptions,
  type ToastRegionProps,
  type ToastType,
  type ToasterController,
};
