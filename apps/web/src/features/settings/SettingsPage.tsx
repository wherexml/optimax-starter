// Adapted from the skylance-easm Settings page: an Account Settings card and a Security Settings card.
// Not ported: billing, tenant, notification and AI options, and the uppercase/digit password checklist (this project only requires 10–256 characters).
import { useEffect, useId, useRef, useState } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Eye, EyeOff, Loader2, Shield, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormDialog } from "@/components/ui/FormDialog";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { PageHeader } from "@/components/ui/page-header";
import { request, type Account } from "@/console-client";
import { useAccount } from "@/features/auth/session";
import { useUnsavedGuard } from "./useUnsavedGuard";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const profileSchema = z.object({
  name: z.string().trim().min(1, "请输入显示名称").max(80, "最多 80 个字符"),
  email: z
    .string()
    .trim()
    .max(254, "最多 254 个字符")
    .refine((v) => v === "" || EMAIL.test(v), "邮箱格式不正确"),
  company: z.string().trim().max(120, "最多 120 个字符"),
});
type ProfileValues = z.infer<typeof profileSchema>;
const toValues = (a: Account): ProfileValues => ({
  name: a.name,
  email: a.email ?? "",
  company: a.company ?? "",
});

const passwordSchema = z
  .object({
    current: z.string().min(1, "请输入当前密码").max(256, "密码最多 256 位"),
    password: z.string().min(10, "新密码至少 10 位").max(256, "密码最多 256 位"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    path: ["confirm"],
    message: "两次输入的密码不一致",
  })
  .refine((v) => !v.current || v.current !== v.password, {
    path: ["password"],
    message: "新密码不能与当前密码相同",
  });
type PasswordValues = z.infer<typeof passwordSchema>;
const PASSWORD_LABELS: Record<keyof PasswordValues, string> = {
  current: "当前密码",
  password: "新密码",
  confirm: "确认新密码",
};

export function SettingsPage() {
  const me = useAccount();
  const [profileDirty, setProfileDirty] = useState(false);
  const [passwordDirty, setPasswordDirty] = useState(false);
  const leaving = useRef(false);
  const guard = useUnsavedGuard(
    () => !leaving.current && (profileDirty || passwordDirty),
  );
  if (!me.data) return null;
  return (
    <>
      <PageHeader title="个人设置" />
      <div className="settings-grid">
        <ProfileCard account={me.data} onDirty={setProfileDirty} />
        <SecurityCard
          username={me.data.username}
          onDirty={setPasswordDirty}
          onChanged={() => {
            leaving.current = true;
          }}
        />
      </div>
      {guard.blocked && (
        <FormDialog
          open
          title="离开此页面？"
          description="未保存的更改将会丢失。"
          size="sm"
          submitText="离开"
          cancelText="留下"
          onSubmit={guard.leave}
          onOpenChange={(open) => {
            if (!open) guard.stay();
          }}
        >
          {null}
        </FormDialog>
      )}
    </>
  );
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  const id = useId();
  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium leading-none">
        {label}
      </label>
      <Input id={id} value={value} readOnly className="readonly-input" />
    </div>
  );
}

function ProfileCard({
  account,
  onDirty,
}: {
  account: Account;
  onDirty: (dirty: boolean) => void;
}) {
  const id = useId();
  const cache = useQueryClient();
  const [saved, setSaved] = useState(false);
  const form = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: toValues(account),
  });
  const dirty = form.formState.isDirty;
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  // When the session refetches, pick up the new server values unless the user is editing.
  const sig = [account.name, account.email ?? "", account.company ?? ""].join("\u0000");
  useEffect(() => {
    if (!form.formState.isDirty) form.reset(toValues(account));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  const save = useMutation({
    mutationFn: (v: ProfileValues) =>
      request<Account>("/me", "PATCH", {
        name: v.name.trim(),
        email: v.email.trim(),
        company: v.company.trim(),
      }),
    onSuccess: (row) => {
      cache.setQueryData(["session"], row);
      form.reset(toValues(row));
      setSaved(true);
      void cache.invalidateQueries({ queryKey: ["accounts"] });
    },
    onError: (e) => form.setError("root", { message: e.message }),
  });
  const fields: { key: keyof ProfileValues; label: string; type?: string; auto: string }[] = [
    { key: "name", label: "显示名称", auto: "name" },
    { key: "email", label: "邮箱", type: "email", auto: "email" },
    { key: "company", label: "公司", auto: "organization" },
  ];
  return (
    <section className="settings-card" aria-labelledby={id}>
      <h2 id={id}>
        <User size={18} aria-hidden="true" />
        账户信息
      </h2>
      <Form {...form}>
        <form
          noValidate
          onSubmit={form.handleSubmit((v) => {
            setSaved(false);
            save.mutate(v);
          })}
        >
          <fieldset className="settings-fieldset" disabled={save.isPending}>
            <ReadOnly label="账户名" value={account.username} />
            {fields.map((f) => (
              <FormField
                key={f.key}
                control={form.control}
                name={f.key}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{f.label}</FormLabel>
                    <FormControl>
                      <Input {...field} type={f.type ?? "text"} autoComplete={f.auto} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ))}
            <ReadOnly label="角色" value={account.role === "admin" ? "管理员" : "成员"} />
            {form.formState.errors.root && (
              <p role="alert" className="m-0 text-sm text-destructive">
                {form.formState.errors.root.message}
              </p>
            )}
            <div className="settings-actions">
              <Button type="submit" disabled={save.isPending || !dirty}>
                {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                保存更改
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={save.isPending || !dirty}
                onClick={() => {
                  form.reset(toValues(account));
                  setSaved(false);
                }}
              >
                重置
              </Button>
              <p role="status" className="settings-status">
                {saved && !dirty ? "已保存" : ""}
              </p>
            </div>
          </fieldset>
        </form>
      </Form>
    </section>
  );
}

function SecurityCard({
  username,
  onDirty,
  onChanged,
}: {
  username: string;
  onDirty: (dirty: boolean) => void;
  onChanged: () => void;
}) {
  const id = useId();
  const cache = useQueryClient();
  const [show, setShow] = useState<Record<keyof PasswordValues, boolean>>({
    current: false,
    password: false,
    confirm: false,
  });
  const form = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { current: "", password: "", confirm: "" },
  });
  const values = form.watch();
  const dirty = Boolean(values.current || values.password || values.confirm);
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  const change = useMutation({
    mutationFn: (v: PasswordValues) =>
      request<{ ok: true }>("/me/password", "POST", {
        current: v.current,
        password: v.password,
      }),
    onSuccess: () => {
      // The server has revoked every session for this account, including this one, and cleared the cookie.
      onChanged();
      form.reset();
      cache.clear();
      location.replace("/login");
    },
    onError: (e) => {
      if (e.message === "当前密码错误")
        form.setError("current", { message: e.message }, { shouldFocus: true });
      else form.setError("root", { message: e.message });
    },
  });
  const match =
    values.password && values.confirm
      ? values.password === values.confirm
        ? "ok"
        : "bad"
      : null;
  return (
    <section className="settings-card" aria-labelledby={id}>
      <h2 id={id}>
        <Shield size={18} aria-hidden="true" />
        安全设置
      </h2>
      <Form {...form}>
        <form noValidate onSubmit={form.handleSubmit((v) => change.mutate(v))}>
          <fieldset className="settings-fieldset" disabled={change.isPending}>
            <input
              type="text"
              name="username"
              autoComplete="username"
              value={username}
              readOnly
              hidden
            />
            {(["current", "password", "confirm"] as const).map((key) => (
              <FormField
                key={key}
                control={form.control}
                name={key}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{PASSWORD_LABELS[key]}</FormLabel>
                    <div className="password-field">
                      <FormControl>
                        <Input
                          {...field}
                          type={show[key] ? "text" : "password"}
                          autoComplete={
                            key === "current" ? "current-password" : "new-password"
                          }
                          placeholder={key === "password" ? "至少 10 位" : undefined}
                          className="pr-10"
                        />
                      </FormControl>
                      <button
                        type="button"
                        className="password-toggle"
                        aria-label={`${show[key] ? "隐藏" : "显示"}${PASSWORD_LABELS[key]}`}
                        aria-pressed={show[key]}
                        onClick={() => setShow((s) => ({ ...s, [key]: !s[key] }))}
                      >
                        {show[key] ? (
                          <EyeOff size={16} aria-hidden="true" />
                        ) : (
                          <Eye size={16} aria-hidden="true" />
                        )}
                      </button>
                    </div>
                    {key === "confirm" && match && (
                      <p className="settings-match" data-state={match} aria-live="polite">
                        {match === "ok" ? "两次输入一致" : "两次输入不一致"}
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
            ))}
            {form.formState.errors.root && (
              <p role="alert" className="m-0 text-sm text-destructive">
                {form.formState.errors.root.message}
              </p>
            )}
            <div className="settings-actions">
              <Button type="submit" disabled={change.isPending || !dirty}>
                {change.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                更新密码
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={change.isPending || !dirty}
                onClick={() => form.reset()}
              >
                清空
              </Button>
            </div>
          </fieldset>
        </form>
      </Form>
    </section>
  );
}
