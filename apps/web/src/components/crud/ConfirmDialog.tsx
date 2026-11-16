import { useMutation } from "@tanstack/react-query";
import { FormDialog } from "@/components/ui/FormDialog";
import type { ButtonProps } from "@/components/ui/button";

export function ConfirmDialog({
  title,
  description,
  submitText,
  submitVariant = "destructive",
  action,
  close,
  trigger,
}: {
  title: string;
  description: string;
  submitText: string;
  submitVariant?: ButtonProps["variant"];
  action: () => Promise<unknown>;
  close: (done?: boolean) => void;
  trigger: HTMLElement | null;
}) {
  const run = useMutation({ mutationFn: action, onSuccess: () => close(true) });
  return (
    <FormDialog
      open
      title={title}
      description={description}
      size="sm"
      submitText={submitText}
      submitVariant={submitVariant}
      loading={run.isPending}
      onSubmit={() => run.mutate()}
      onCloseAutoFocus={(e) => {
        if (trigger?.isConnected) {
          e.preventDefault();
          trigger.focus();
        }
      }}
      onOpenChange={(open) => {
        if (!open && !run.isPending) close();
      }}
    >
      {run.error ? (
        <p role="alert" className="m-0 text-xs font-medium leading-[18px] text-destructive">
          {run.error.message}
        </p>
      ) : null}
    </FormDialog>
  );
}
