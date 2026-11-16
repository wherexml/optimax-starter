import { useEffect, useId, useState } from "react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AtSign, Building2, Mail, User } from "lucide-react";
import { useForm } from "react-hook-form";

import {
  ROLE_VALUES,
  optionalCompanySchema,
  optionalEmailSchema,
} from "@optimax-starter/api";
import { FormDialog } from "@/components/ui/FormDialog";
import {
  FieldHint,
  FieldLayout,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormSection,
} from "@/components/ui/form";
import { ClearableInput, CopyableInput } from "@/components/ui/input-group";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { request, type Account } from "@/console-client";

const schema = z.object({
  name: z.string().trim().min(1, "请输入姓名").max(80, "姓名最多 80 个字符"),
  role: z.enum(ROLE_VALUES),
  email: optionalEmailSchema,
  company: optionalCompanySchema,
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
  const usernameId = useId();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: account.name,
      role: account.role === "admin" ? "admin" : "member",
      email: account.email ?? "",
      company: account.company ?? "",
    },
  });
  const { isDirty } = form.formState;
  const cache = useQueryClient();
  const [confirmRole, setConfirmRole] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  const role = form.watch("role");
  const roleChanged = !self && role !== account.role;

  useEffect(() => {
    setConfirmRole(false);
  }, [role]);

  const keepEditing = () => {
    setConfirmingDiscard(false);
    form.setFocus("name");
  };

  const save = useMutation({
    mutationFn: (values: Values) => {
      const body: {
        name?: string;
        role?: Values["role"];
        email?: string;
        company?: string;
      } = {};
      if (values.name.trim() !== account.name) body.name = values.name.trim();
      if (!self && values.role !== account.role) body.role = values.role;
      const nextEmail = (values.email ?? "").trim();
      if (nextEmail !== (account.email ?? "")) body.email = nextEmail;
      const nextCompany = (values.company ?? "").trim();
      if (nextCompany !== (account.company ?? "")) body.company = nextCompany;
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
      submitText={confirmRole ? "确认更改角色" : "保存修改"}
      loading={save.isPending}
      formId="edit-account"
      unsaved={
        confirmingDiscard
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
        if (confirmingDiscard) keepEditing();
        else if (isDirty) setConfirmingDiscard(true);
        else close();
      }}
    >
      <Form {...form}>
        <form
          noValidate
          id="edit-account"
          onSubmit={submit}
          className="flex flex-col gap-5"
        >
          <FormSection title="身份与角色">
            <FieldLayout className="sm:col-span-2">
              <Label htmlFor={usernameId}>账户名</Label>
              <CopyableInput
                id={usernameId}
                value={account.username}
                copyLabel="复制账户名"
                startIcon={<AtSign />}
              />
              <FieldHint>登录唯一标识，创建后不可修改</FieldHint>
            </FieldLayout>

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>姓名</FormLabel>
                  <FormControl>
                    <ClearableInput
                      {...field}
                      autoFocus
                      autoComplete="off"
                      maxLength={80}
                      startIcon={<User />}
                      onClear={() => form.setValue("name", "", { shouldDirty: true })}
                    />
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
                  <FormLabel required>角色</FormLabel>
                  <Select
                    value={field.value}
                    onValueChange={field.onChange}
                    disabled={self}
                  >
                    <FormControl>
                      <SelectTrigger aria-label="角色">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="member">成员</SelectItem>
                      <SelectItem value="admin">管理员</SelectItem>
                    </SelectContent>
                  </Select>
                  {self && <FieldHint>不能更改自己的角色</FieldHint>}
                  <FormMessage />
                </FormItem>
              )}
            />
          </FormSection>

          <FormSection title="联系与归属">
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel optional>邮箱</FormLabel>
                  <FormControl>
                    <ClearableInput
                      {...field}
                      value={field.value ?? ""}
                      type="email"
                      autoComplete="off"
                      placeholder="name@company.com"
                      startIcon={<Mail />}
                      onClear={() => form.setValue("email", "", { shouldDirty: true })}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="company"
              render={({ field }) => (
                <FormItem>
                  <FormLabel optional>公司或团队</FormLabel>
                  <FormControl>
                    <ClearableInput
                      {...field}
                      value={field.value ?? ""}
                      autoComplete="off"
                      maxLength={120}
                      placeholder="例如：安全运营中心"
                      startIcon={<Building2 />}
                      onClear={() => form.setValue("company", "", { shouldDirty: true })}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </FormSection>

          {confirmRole && (
            <p
              role="alert"
              className="m-0 rounded-lg border-[0.5px] border-[color:var(--warning-foreground)]/25 bg-[var(--warning)] px-3.5 py-2.5 text-sm leading-5 text-[var(--warning-foreground)]"
            >
              {role === "admin"
                ? `${account.name} 将可以管理全部账户、角色与会话。`
                : `${account.name} 将失去账户管理权限。`}
              再次点击“确认更改角色”生效。
            </p>
          )}
          {form.formState.errors.root && (
            <p role="alert" className="m-0 text-xs font-medium leading-[18px] text-destructive">
              {form.formState.errors.root.message}
            </p>
          )}
        </form>
      </Form>
    </FormDialog>
  );
}
