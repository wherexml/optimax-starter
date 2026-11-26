"use client";

import {
  AlertDialog as AlertDialogRoot,
  AlertDialogBackdrop,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogShortcut,
  AlertDialogTitle,
  AlertDialogTrigger,
  createAlertDialogController,
} from "@ui-sdk/react/alert-dialog";
import { cn } from "@optimax-starter/ui/lib/utils";
import type * as React from "react";

function AlertDialog({ ...props }: React.ComponentProps<typeof AlertDialogRoot>) {
  return <AlertDialogRoot data-slot="alert-dialog" {...props} />;
}

function StyledAlertDialogBackdrop({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogBackdrop>) {
  return (
    <AlertDialogBackdrop
      data-slot="alert-dialog-backdrop"
      className={cn("dialog-overlay fixed inset-0 z-50 bg-[rgb(33_32_28/0.42)]", className)}
      {...props}
    />
  );
}

function StyledAlertDialogContent({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogContent>) {
  return (
    <AlertDialogContent
      data-slot="alert-dialog-content"
      className={cn(
        "dialog-content fixed left-1/2 top-1/2 z-50 grid w-[calc(100vw-24px)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 rounded-xl border-[0.5px] border-border bg-card p-6 text-card-foreground shadow-[0_16px_48px_rgb(33_32_28/0.16),0_2px_8px_rgb(33_32_28/0.06)]",
        className,
      )}
      {...props}
    />
  );
}

function StyledAlertDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogTitle>) {
  return (
    <AlertDialogTitle
      data-slot="alert-dialog-title"
      className={cn("text-base font-semibold leading-6 text-foreground", className)}
      {...props}
    />
  );
}

function StyledAlertDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof AlertDialogDescription>) {
  return (
    <AlertDialogDescription
      data-slot="alert-dialog-description"
      className={cn("text-sm leading-5 text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  AlertDialog,
  AlertDialogTrigger,
  StyledAlertDialogBackdrop as AlertDialogBackdrop,
  StyledAlertDialogContent as AlertDialogContent,
  StyledAlertDialogTitle as AlertDialogTitle,
  StyledAlertDialogDescription as AlertDialogDescription,
  AlertDialogClose,
  AlertDialogShortcut,
  createAlertDialogController,
};
