import { useState } from "react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { User } from "lucide-react";
import { useForm } from "react-hook-form";

import { FormDialog } from "@/components/ui/FormDialog";
import {
  FieldCharCount,
  FieldLabelRow,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { ClearableInput } from "@/components/ui/input-group";
import { toast } from "@/components/ui/toast";
import { request } from "@/console-client";

const schema = z.object({
  name: z.string().trim().min(1, "请输入显示名称").max(80, "最多 80 个字符"),
});
type Values = z.infer<typeof schema>;

export function ProfileDialog({
  name,
  trigger,
  close,
}: {
  name: string;
  trigger: HTMLElement | null;
  close: () => void;
}) {
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name },
  });
  const { isDirty } = form.formState;
  const [confirming, setConfirming] = useState(false);
  const currentName = form.watch("name");
  const cache = useQueryClient();

  const keepEditing = () => {
    setConfirming(false);
    form.setFocus("name");
  };

  const save = useMutation({
    mutationFn: (values: Values) =>
      request("/me", "PATCH", { name: values.name.trim() }),
    onSuccess: async () => {
      await cache.invalidateQueries();
      toast.success("显示名称已更新");
      close();
    },
    onError: (error) =>
      form.setError("name", { message: error.message }, { shouldFocus: true }),
  });

  const submit = form.handleSubmit((values) =>
    values.name.trim() === name ? close() : save.mutate(values),
  );

  return (
    <FormDialog
      open
      title="显示名称"
      size="sm"
      submitText="保存"
      loading={save.isPending}
      formId="profile-name"
      unsaved={
        confirming
          ? {
              onKeepEditing: keepEditing,
              onDiscard: () => close(),
            }
          : null
      }
      onCloseAutoFocus={(e) => {
        if (trigger?.isConnected) {
          e.preventDefault();
          trigger.focus();
        }
      }}
      onOpenChange={(open) => {
        if (open || save.isPending) return;
        if (confirming) keepEditing();
        else if (isDirty) setConfirming(true);
        else close();
      }}
    >
      <Form {...form}>
        <form noValidate id="profile-name" onSubmit={submit}>
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FieldLabelRow>
                  <FormLabel required>姓名</FormLabel>
                  <FieldCharCount current={currentName.length} max={80} />
                </FieldLabelRow>
                <FormControl>
                  <ClearableInput
                    {...field}
                    autoFocus
                    maxLength={80}
                    autoComplete="name"
                    startIcon={<User />}
                    onClear={() => form.setValue("name", "", { shouldDirty: true })}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </form>
      </Form>
    </FormDialog>
  );
}
