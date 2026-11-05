import { useMutation } from "@tanstack/react-query";
import { FormDialog } from "@/components/ui/FormDialog";

export function ConfirmDialog({
  title,
  description,
  submitText,
  action,
  close,
  trigger,
}: {
  title: string;
  description: string;
  submitText: string;
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
        <p role="alert" className="m-0 text-sm text-destructive">
          {run.error.message}
        </p>
      ) : null}
    </FormDialog>
  );
}
