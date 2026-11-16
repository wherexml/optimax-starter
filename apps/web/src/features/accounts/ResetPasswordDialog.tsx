import { useState } from "react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";

import { FormDialog } from "@/components/ui/FormDialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { PasswordInput } from "@/components/ui/password-input";
import { request, type Account } from "@/console-client";

const schema = z
  .object({
    password: z.string().min(10, "密码至少 10 位").max(256, "密码最多 256 位"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ["confirm"],
    message: "两次输入的密码不一致",
  });
type Values = z.infer<typeof schema>;

export function ResetPasswordDialog({
  account,
  trigger,
  close,
}: {
  account: Account;
  trigger: HTMLElement | null;
  close: (message?: string) => void;
}) {
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { password: "", confirm: "" },
  });
  const values = form.watch();
  const dirty = Boolean(values.password || values.confirm);
  const [confirming, setConfirming] = useState(false);

  const keepEditing = () => {
    setConfirming(false);
    form.setFocus("password");
  };

  const reset = useMutation({
    mutationFn: (v: Values) =>
      request(`/accounts/${account.id}/password`, "POST", {
        password: v.password,
      }),
    onSuccess: () => close(`已重置 ${account.name} 的密码，并撤销其全部会话`),
    onError: (error) => form.setError("root", { message: error.message }),
  });

  const match =
    values.password && values.confirm
      ? values.password === values.confirm
        ? "ok"
        : "bad"
      : null;

  return (
    <FormDialog
      open
      title="重置密码"
      description={`重置后 ${account.name} 的全部会话立即失效，需要使用新密码登录。`}
      size="md"
      submitText="重置密码"
      loading={reset.isPending}
      formId="reset-password"
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
        if (open || reset.isPending) return;
        if (confirming) keepEditing();
        else if (dirty) setConfirming(true);
        else close();
      }}
    >
      <Form {...form}>
        <form
          noValidate
          id="reset-password"
          onSubmit={form.handleSubmit((v) => reset.mutate(v))}
          className="grid gap-4 sm:grid-cols-2"
        >
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>新密码</FormLabel>
                <FormControl>
                  <PasswordInput
                    {...field}
                    autoFocus
                    toggleLabel="新密码"
                    autoComplete="new-password"
                    placeholder="至少 10 位"
                    onGenerate={(generated) => {
                      form.setValue("password", generated, {
                        shouldDirty: true,
                        shouldValidate: true,
                      });
                      form.setValue("confirm", generated, {
                        shouldDirty: true,
                        shouldValidate: true,
                      });
                    }}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="confirm"
            render={({ field }) => (
              <FormItem>
                <FormLabel required>确认新密码</FormLabel>
                <FormControl>
                  <PasswordInput
                    {...field}
                    toggleLabel="确认新密码"
                    autoComplete="new-password"
                    placeholder="再次输入新密码"
                  />
                </FormControl>
                {match && (
                  <p
                    className="settings-match"
                    data-state={match}
                    aria-live="polite"
                  >
                    {match === "ok" ? "两次输入一致" : "两次输入不一致"}
                  </p>
                )}
                <FormMessage />
              </FormItem>
            )}
          />
          {form.formState.errors.root && (
            <p
              role="alert"
              className="m-0 text-xs font-medium leading-[18px] text-destructive sm:col-span-2"
            >
              {form.formState.errors.root.message}
            </p>
          )}
        </form>
      </Form>
    </FormDialog>
  );
}
