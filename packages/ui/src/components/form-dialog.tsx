import * as React from "react";
import { Loader2 } from "lucide-react";

import { Button, type ButtonProps } from "@optimax-starter/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@optimax-starter/ui/components/dialog";
import { cn } from "@optimax-starter/ui/lib/utils";

export interface UnsavedChangesBannerProps {
  message?: string;
  keepText?: string;
  discardText?: string;
  onKeepEditing: () => void;
  onDiscard: () => void;
  className?: string;
}

export function UnsavedChangesBanner({
  message = "有未保存的改动，确定放弃吗？",
  keepText = "继续编辑",
  discardText = "放弃更改",
  onKeepEditing,
  onDiscard,
  className,
}: UnsavedChangesBannerProps) {
  const alertId = React.useId();
  return (
    <div
      role="group"
      aria-labelledby={alertId}
      data-slot="unsaved-banner"
      className={cn(
        "flex flex-wrap items-center justify-between gap-3 rounded-lg border-[0.5px] border-[color:var(--warning-foreground)]/25 bg-[var(--warning)] px-3.5 py-2.5 text-sm text-[var(--warning-foreground)]",
        className,
      )}
    >
      <p id={alertId} role="alert" className="m-0 text-sm font-medium leading-5">
        {message}
      </p>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          autoFocus
          onClick={onKeepEditing}
          className="h-8 bg-card text-foreground"
        >
          {keepText}
        </Button>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={onDiscard}
          className="h-8"
        >
          {discardText}
        </Button>
      </div>
    </div>
  );
}

export interface FormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  onSubmit?: () => void;
  onCancel?: () => void;
  submitText?: string;
  submitVariant?: ButtonProps["variant"];
  cancelText?: string;
  submitDisabled?: boolean;
  size?: "sm" | "md" | "lg" | "xl" | "full";
  loading?: boolean;
  formId?: string;
  footerStart?: React.ReactNode;
  unsaved?: UnsavedChangesBannerProps | null;
  bodyClassName?: string;
  onCloseAutoFocus?: React.ComponentProps<
    typeof DialogContent
  >["onCloseAutoFocus"];
}

export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  onSubmit,
  onCancel,
  submitText = "确认",
  submitVariant = "default",
  cancelText = "取消",
  submitDisabled = false,
  size = "lg",
  loading = false,
  formId,
  footerStart,
  unsaved,
  bodyClassName,
  onCloseAutoFocus,
}: FormDialogProps) {
  const hasBody = children !== null && children !== undefined && children !== false;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size={size}
        scrollable={false}
        closeClassName="right-4 top-3 size-9"
        className="flex flex-col gap-0 overflow-hidden p-0"
        onCloseAutoFocus={onCloseAutoFocus}
        {...(!description ? { "aria-describedby": undefined } : {})}
      >
        <DialogHeader
          className={cn(
            "shrink-0 px-6 py-4 pr-14",
            hasBody && "border-b-[0.5px] border-border",
          )}
        >
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        {hasBody && (
          <div
            data-slot="form-dialog-body"
            className={cn("min-h-0 flex-1 overflow-y-auto px-6 py-5", bodyClassName)}
          >
            {children}
          </div>
        )}

        <div className="shrink-0 border-t-[0.5px] border-border bg-[var(--surface-subtle)] px-6 py-3.5">
          {unsaved && <UnsavedChangesBanner {...unsaved} className="mb-3" />}
          <DialogFooter className="flex flex-wrap items-center justify-between gap-3 sm:justify-between">
            <div className="min-w-0 text-xs leading-[18px] text-muted-foreground">
              {footerStart}
            </div>
            <div className="flex shrink-0 items-center justify-end gap-2 ml-auto">
              <Button
                type="button"
                variant="outline"
                onClick={onCancel || (() => onOpenChange(false))}
                disabled={loading}
              >
                {cancelText}
              </Button>
              {(onSubmit || formId) && (
                <Button
                  type={formId ? "submit" : "button"}
                  variant={submitVariant}
                  form={formId}
                  onClick={onSubmit}
                  disabled={submitDisabled || loading}
                >
                  {loading && <Loader2 className="size-4 animate-spin" />}
                  {submitText}
                </Button>
              )}
            </div>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
