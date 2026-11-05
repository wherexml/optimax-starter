import { useEffect, useState } from "react";
import { z } from "zod";
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
import { request, type Account } from "@/console-client";

const schema = z.object({
  name: z.string().trim().min(1, "请输入姓名").max(80, "姓名最多 80 个字符"),
  role: z.enum(["member", "admin"]),
});
type Values = z.infer<typeof schema>;

export function EditAccountDialog({
  account,
  self,
  trigger,
  close,
}: {
  account: Account;
  self: boolean;
  trigger: HTMLElement | null;
  close: (message?: string) => void;
}) {
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: account.name,
      role: account.role === "admin" ? "admin" : "member",
    },
  });
  const cache = useQueryClient();
  const [confirmRole, setConfirmRole] = useState(false);
  const role = form.watch("role");
  const roleChanged = !self && role !== account.role;
  useEffect(() => {
    setConfirmRole(false);
  }, [role]);
  const save = useMutation({
    mutationFn: (values: Values) => {
      const body: { name?: string; role?: Values["role"] } = {};
      if (values.name.trim() !== account.name) body.name = values.name.trim();
      if (!self && values.role !== account.role) body.role = values.role;
      return Object.keys(body).length
        ? request<Account>("/accounts/" + account.id, "PATCH", body)
        : Promise.resolve(null);
    },
    onSuccess: async (result, values) => {
      if (!result) return close();
      await cache.invalidateQueries();
      close(`已更新 ${values.name.trim()}`);
    },
    onError: (error) => form.setError("root", { message: error.message }),
  });
  const submit = form.handleSubmit((values) => {
    if (roleChanged && !confirmRole) {
      setConfirmRole(true);
      return;
    }
    save.mutate(values);
  });
  return (
    <FormDialog
      open
      title={self ? "编辑当前账户" : "编辑账户"}
      size="md"
      submitText={confirmRole ? "确认更改角色" : "保存"}
      loading={save.isPending}
      formId="edit-account"
      onCloseAutoFocus={(e) => {
        if (trigger?.isConnected) {
          e.preventDefault();
          trigger.focus();
        }
      }}
      onOpenChange={(open) => {
        if (!open && !save.isPending) close();
      }}
    >
      <Form {...form}>
        <form
          noValidate
          id="edit-account"
          onSubmit={submit}
          className="grid gap-4 sm:grid-cols-2"
        >
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>姓名</FormLabel>
                <FormControl>
                  <Input {...field} autoFocus autoComplete="off" />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="role"
            render={({ field }) => (
              <FormItem>
                <FormLabel>角色</FormLabel>
                <Select
                  value={field.value}
                  onValueChange={field.onChange}
                  disabled={self}
                >
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
                {self && (
                  <p className="m-0 text-xs text-muted-foreground">
                    不能更改自己的角色
                  </p>
                )}
                <FormMessage />
              </FormItem>
            )}
          />
          <div className="sm:col-span-2">
            <p className="m-0 text-xs text-muted-foreground">账户名</p>
            <p className="m-0 font-mono text-sm">{account.username}</p>
          </div>
          {confirmRole && (
            <p
              role="alert"
              className="m-0 rounded-md bg-warning p-3 text-sm text-warning-foreground sm:col-span-2"
            >
              {role === "admin"
                ? `${account.name} 将可以管理全部账户、角色与会话。`
                : `${account.name} 将失去账户管理权限。`}
              再次点击“确认更改角色”生效。
            </p>
          )}
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
