import { useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { request } from "@/console-client";

const schema = z.object({
  name: z.string().trim().min(1, "请输入姓名").max(80, "姓名最多 80 个字符"),
  username: z
    .string()
    .trim()
    .min(1, "请输入账户名")
    .max(64, "账户名最多 64 个字符"),
  password: z.string().min(10, "密码至少 10 位").max(256, "密码最多 256 位"),
  role: z.enum(["member", "admin"]),
});
type Values = z.infer<typeof schema>;
export function CreateAccountDialog({
  close,
  trigger,
}: {
  close: (createdName?: string) => void;
  trigger: HTMLButtonElement | null;
}) {
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", username: "", password: "", role: "member" },
  });
  const { isDirty } = form.formState;
  const [confirming, setConfirming] = useState(false);
  const keepEditing = () => {
    setConfirming(false);
    form.setFocus("name");
  };
  const cache = useQueryClient();
  const add = useMutation({
    mutationFn: (values: Values) => request("/accounts", "POST", values),
    onSuccess: async (_data, values) => {
      await cache.invalidateQueries({ queryKey: ["accounts"] });
      close(values.name.trim());
    },
    onError: (error) =>
      form.setError(
        error.message === "账户名已存在" ? "username" : "root",
        { message: error.message },
        { shouldFocus: true },
      ),
  });
  const submit = form.handleSubmit((values) => add.mutate(values));
  return (
    <FormDialog
      open
      title="新增账户"
      size="md"
      submitText="创建账户"
      loading={add.isPending}
      formId="create-account"
      onCloseAutoFocus={(e) => {
        if (trigger) {
          e.preventDefault();
          trigger.focus();
        }
      }}
      onOpenChange={(open) => {
        if (open || add.isPending) return;
        if (confirming) keepEditing();
        else if (isDirty) setConfirming(true);
        else close();
      }}
    >
      <Form {...form}>
        <form
          noValidate
          id="create-account"
          onSubmit={submit}
          className="grid gap-4 sm:grid-cols-2"
        >
          {(["name", "username", "password"] as const).map((key) => (
            <FormField
              key={key}
              control={form.control}
              name={key}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>
                    {
                      {
                        name: "姓名",
                        username: "账户名",
                        password: "初始密码",
                      }[key]
                    }
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type={key === "password" ? "password" : "text"}
                      autoComplete={key === "password" ? "new-password" : "off"}
                      autoFocus={key === "name"}
                      placeholder={
                        key === "password" ? "至少 10 位" : undefined
                      }
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          ))}
          <FormField
            control={form.control}
            name="role"
            render={({ field }) => (
              <FormItem>
                <FormLabel>角色</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="member">成员</SelectItem>
                    <SelectItem value="admin">管理员</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          {form.formState.errors.root && (
            <p role="alert" className="text-sm text-destructive">
              {form.formState.errors.root.message}
            </p>
          )}
          {confirming && (
            <div
              role="group"
              aria-labelledby="create-account-discard"
              className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted p-3"
            >
              <p id="create-account-discard" role="alert" className="text-sm">
                有未保存的内容
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  autoFocus
                  onClick={keepEditing}
                >
                  继续编辑
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={() => close()}
                >
                  放弃更改
                </Button>
              </div>
            </div>
          )}
        </form>
      </Form>
    </FormDialog>
  );
}
