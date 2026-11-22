// One-time account activation page (/invite/$token). Same split visual style as LoginPage.
import { useEffect, useState, type ReactNode } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { useParams } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { APP_CONFIG } from "@/config/app-config";
import { request, type InvitePreview } from "@/console-client";

const schema = z
  .object({
    password: z.string().min(10, "密码至少 10 位").max(256, "密码最多 256 位"),
    confirm: z.string().min(1, "请再次输入密码"),
  })
  .refine((v) => v.password === v.confirm, {
    path: ["confirm"],
    message: "两次输入的密码不一致",
  });
type Values = z.infer<typeof schema>;

type State =
  | { kind: "loading" }
  | { kind: "ready"; invite: InvitePreview }
  | { kind: "invalid"; message: string };

function formatExpiry(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("zh-CN", { hour12: false });
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[#06111d] text-white">
      <img
        src="/login-background-4k.webp"
        alt=""
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover object-left"
      />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(2,8,18,0.18)_0%,rgba(3,10,20,0.08)_38%,rgba(3,10,20,0.58)_64%,rgba(3,10,20,0.92)_100%)]" />
      <div className="relative z-10 flex min-h-screen flex-col gap-8 px-4 py-6 sm:px-8 sm:py-8 lg:grid lg:grid-cols-[minmax(0,1fr)_460px] lg:gap-12 lg:px-12 xl:px-16">
        <section className="min-w-0">
          <div className="inline-flex items-center gap-3">
            <img
              src="/brand/optimax-product-logo.png"
              alt="OptiMax"
              width={48}
              height={48}
              className="h-10 w-10 object-contain sm:h-12 sm:w-12"
            />
            <span aria-hidden="true" className="text-2xl font-semibold leading-none text-white">
              OptiMax
            </span>
          </div>
          <h1 className="mt-8 max-w-[540px] text-3xl font-semibold leading-tight text-white sm:text-4xl lg:mt-10">
            {APP_CONFIG.loginTitle}
          </h1>
        </section>
        <section className="flex items-center justify-center lg:justify-end">
          <div className="w-full max-w-[420px] rounded-lg border border-white/20 bg-white/[0.96] p-6 text-neutral-950 shadow-2xl shadow-black/35 backdrop-blur-xl sm:p-8">
            {children}
          </div>
        </section>
      </div>
    </main>
  );
}

function ErrorAlert({ message }: { message: string }) {
  return (
    <div
      role="alert"
      aria-live="polite"
      className="flex gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-red-800"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p className="m-0 text-sm font-medium">{message}</p>
    </div>
  );
}

export function InviteAcceptPage() {
  const { token } = useParams({ from: "/invite/$token" });
  const [state, setState] = useState<State>({ kind: "loading" });
  const [error, setError] = useState("");
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { password: "", confirm: "" },
  });
  const { errors, isSubmitting } = form.formState;

  useEffect(() => {
    const controller = new AbortController();
    request<InvitePreview>(`/auth/invites/${encodeURIComponent(token)}`, "GET", undefined, {
      signal: controller.signal,
    })
      .then((invite) => setState({ kind: "ready", invite }))
      .catch((err: Error) => {
        if (controller.signal.aborted) return;
        setState({ kind: "invalid", message: err.message || "邀请链接无效" });
      });
    return () => controller.abort();
  }, [token]);

  async function submit(values: Values) {
    setError("");
    try {
      await request<{ ok: true; username: string }>(
        `/auth/invites/${encodeURIComponent(token)}/accept`,
        "POST",
        { password: values.password },
      );
      location.replace("/login?activated=1");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (state.kind === "loading") {
    return (
      <Panel>
        <p role="status" className="m-0 flex items-center gap-2 text-sm text-neutral-600">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          正在校验激活链接…
        </p>
      </Panel>
    );
  }

  if (state.kind === "invalid") {
    return (
      <Panel>
        <h2 className="m-0 text-2xl font-bold text-neutral-950">无法激活账户</h2>
        <div className="mt-6">
          <ErrorAlert message={state.message} />
        </div>
        <p className="mt-4 text-sm leading-6 text-neutral-600">
          激活链接仅可使用一次，有效期 72 小时。如需继续，请联系管理员重新生成。
        </p>
        <Button asChild className="mt-6 h-11 w-full">
          <a href="/login">返回登录</a>
        </Button>
      </Panel>
    );
  }

  const { invite } = state;
  return (
    <Panel>
      <h2 className="m-0 text-2xl font-bold text-neutral-950">激活账户</h2>
      <p className="mt-2 text-sm text-neutral-600">设置登录密码后即可使用账户。</p>
      <dl className="mt-6 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm">
        <dt className="text-neutral-500">姓名</dt>
        <dd className="m-0 break-all font-medium">{invite.name}</dd>
        <dt className="text-neutral-500">账户名</dt>
        <dd className="m-0 break-all font-medium">{invite.username}</dd>
        <dt className="text-neutral-500">有效期至</dt>
        <dd className="m-0">{formatExpiry(invite.expiresAt)}</dd>
      </dl>
      <form
        noValidate
        onSubmit={form.handleSubmit(submit)}
        className="mt-6 flex flex-col gap-4 sm:gap-5"
      >
        {/* Hidden username helps password managers associate the new credential. */}
        <input type="text" autoComplete="username" value={invite.username} readOnly hidden />
        <div className="flex flex-col gap-2">
          <Label htmlFor="invite-password" className="text-sm text-neutral-700">
            新密码
          </Label>
          <PasswordInput
            id="invite-password"
            {...form.register("password")}
            toggleLabel="新密码"
            autoComplete="new-password"
            placeholder="10–256 位，可一键生成"
            aria-invalid={!!errors.password}
            onGenerate={(generated) => {
              form.setValue("password", generated, { shouldDirty: true, shouldValidate: true });
              form.setValue("confirm", generated, { shouldDirty: true, shouldValidate: true });
            }}
          />
          {errors.password && (
            <p role="alert" className="m-0 text-sm text-destructive">
              {errors.password.message}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="invite-confirm" className="text-sm text-neutral-700">
            确认密码
          </Label>
          <PasswordInput
            id="invite-confirm"
            {...form.register("confirm")}
            toggleLabel="确认密码"
            autoComplete="new-password"
            placeholder="再次输入新密码"
            aria-invalid={!!errors.confirm}
          />
          {errors.confirm && (
            <p role="alert" className="m-0 text-sm text-destructive">
              {errors.confirm.message}
            </p>
          )}
        </div>
        {error && <ErrorAlert message={error} />}
        <Button type="submit" disabled={isSubmitting} className="h-11 w-full">
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {isSubmitting ? "激活中..." : "设置密码并激活"}
        </Button>
        <a href="/login" className="text-center text-sm text-neutral-600 hover:text-neutral-900">
          返回登录
        </a>
      </form>
    </Panel>
  );
}
