import { useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AtSign, Building2, Mail, User } from "lucide-react";
import { useForm } from "react-hook-form";

import {
  accountCreateSchema,
  type AccountCreateInput,
} from "@optimax-starter/api";
import { FormDialog } from "@/components/ui/FormDialog";
import {
  FieldCharCount,
  FieldHint,
  FieldLabelRow,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormSection,
} from "@/components/ui/form";
import { ClearableInput } from "@/components/ui/input-group";
import { PasswordInput } from "@/components/ui/password-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { request } from "@/console-client";
import { useAccount } from "@/features/auth/session";

export function CreateAccountDialog({
  close,
  trigger,
}: {
  close: (createdName?: string) => void;
  trigger: HTMLButtonElement | null;
}) {
  const me = useAccount();
  const isSuperAdmin = me.data?.role === "super_admin";
  const form = useForm<AccountCreateInput>({
    resolver: zodResolver(accountCreateSchema),
    defaultValues: {
      name: "",
      username: "",
      password: "",
      role: "member",
      email: "",
      company: "",
    },
  });
  const { isDirty } = form.formState;
  const [confirming, setConfirming] = useState(false);
  const nameValue = form.watch("name");

  const keepEditing = () => {
    setConfirming(false);
    form.setFocus("name");
  };

  const cache = useQueryClient();
  const add = useMutation({
    mutationFn: (values: AccountCreateInput) => request("/accounts", "POST", values),
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
      footerStart="带 * 项为必填，初始密码至少 10 位"
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
          className="flex flex-col gap-5"
        >
          <FormSection title="身份与组织">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FieldLabelRow>
                    <FormLabel required>姓名</FormLabel>
                    <FieldCharCount current={nameValue.length} max={80} />
                  </FieldLabelRow>
                  <FormControl>
                    <ClearableInput
                      {...field}
                      autoFocus
                      autoComplete="off"
                      maxLength={80}
                      placeholder="例如：张敏"
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
              name="username"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>账户名</FormLabel>
                  <FormControl>
                    <ClearableInput
                      {...field}
                      autoComplete="off"
                      maxLength={64}
                      placeholder="登录标识，创建后不可修改"
                      startIcon={<AtSign />}
                      onClear={() => form.setValue("username", "", { shouldDirty: true })}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
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

          <FormSection title="凭证与角色">
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel required>初始密码</FormLabel>
                  <FormControl>
                    <PasswordInput
                      {...field}
                      toggleLabel="初始密码"
                      autoComplete="new-password"
                      placeholder="至少 10 位，可一键生成"
                      onGenerate={(generated) =>
                        form.setValue("password", generated, {
                          shouldDirty: true,
                          shouldValidate: true,
                        })
                      }
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
                    disabled={!isSuperAdmin}
                  >
                    <FormControl>
                      <SelectTrigger aria-label="角色">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="member">成员</SelectItem>
                      {isSuperAdmin && (
                        <>
                          <SelectItem value="admin">管理员</SelectItem>
                          <SelectItem value="super_admin">超级管理员</SelectItem>
                        </>
                      )}
                    </SelectContent>
                  </Select>
                  {!isSuperAdmin && (
                    <FieldHint>管理员角色仅可由超级管理员分配</FieldHint>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
          </FormSection>

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
