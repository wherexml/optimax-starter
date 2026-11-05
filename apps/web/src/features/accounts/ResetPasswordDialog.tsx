import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { FormDialog } from "@/components/ui/FormDialog";
import {
  Form,
  FormField,
  FormItem,
  FormControl,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
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
  const reset = useMutation({
    mutationFn: (values: Values) =>
      request(`/accounts/${account.id}/password`, "POST", {
        password: values.password,
      }),
    onSuccess: () => close(`已重置 ${account.name} 的密码，并撤销其全部会话`),
    onError: (error) => form.setError("root", { message: error.message }),
  });
  return (
    <FormDialog
      open
      title="重置密码"
      description={`重置后 ${account.name} 的全部会话立即失效，需要使用新密码登录。`}
      size="md"
      submitText="重置密码"
      loading={reset.isPending}
      formId="reset-password"
      onCloseAutoFocus={(e) => {
        if (trigger?.isConnected) {
          e.preventDefault();
          trigger.focus();
        }
      }}
      onOpenChange={(open) => {
        if (!open && !reset.isPending) close();
      }}
    >
      <Form {...form}>
        <form
          noValidate
          id="reset-password"
          onSubmit={form.handleSubmit((v) => reset.mutate(v))}
          className="grid gap-4 sm:grid-cols-2"
        >
          {(["password", "confirm"] as const).map((key) => (
            <FormField
              key={key}
              control={form.control}
              name={key}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{key === "password" ? "新密码" : "确认新密码"}</FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="password"
                      autoComplete="new-password"
                      autoFocus={key === "password"}
                      placeholder={key === "password" ? "至少 10 位" : undefined}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ))}
          {form.formState.errors.root && (
            <p role="alert" className="m-0 text-sm text-destructive sm:col-span-2">
              {form.formState.errors.root.message}
            </p>
          )}
        </form>
      </Form>
    </FormDialog>
  );
}
