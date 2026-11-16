// Page composition ported from optimax-riskops/src/pages/Login.tsx.
import { useState } from "react";
import { AlertCircle, Eye, EyeOff, Loader2 } from "lucide-react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { request } from "@/console-client";
const schema = z.object({
  username: z.string().trim().min(1, "请输入账户名").max(64),
  password: z.string().min(1, "请输入密码").max(256),
});
const rememberKey = "optimax.rememberedUsername";
export function LoginPage() {
  const initial = localStorage.getItem(rememberKey) || "";
  const [remember, setRemember] = useState(!!initial),
    [showPassword, setShowPassword] = useState(false),
    [error, setError] = useState("");
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { username: initial, password: "" },
  });
  const { errors, isSubmitting: loading } = form.formState;
  async function submit(values: z.infer<typeof schema>) {
    setError("");
    try {
      await request("/login", "POST", values);
      if (remember) localStorage.setItem(rememberKey, values.username);
      else localStorage.removeItem(rememberKey);
      location.replace("/");
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <main className="relative min-h-screen overflow-x-hidden bg-[#06111d] text-white">
      <img
        src="/login-background-4k.png"
        data-login-background
        alt=""
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover object-left"
      />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(2,8,18,0.18)_0%,rgba(3,10,20,0.08)_38%,rgba(3,10,20,0.58)_64%,rgba(3,10,20,0.92)_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_72%_50%,rgba(47,111,237,0.13),transparent_34%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,8,18,0.25)_0%,rgba(2,8,18,0.58)_38%,transparent_65%)]" />

      <div className="relative z-10 flex min-h-screen flex-col gap-8 px-6 py-6 sm:px-8 sm:py-8 lg:grid lg:grid-cols-[minmax(0,1fr)_460px] lg:gap-12 lg:px-12 xl:px-16">
        <section className="min-w-0">
          <div className="max-w-xl">
            <div className="inline-flex items-center gap-3">
              <img
                data-login-logo
                src="/brand/optimax-product-logo.png"
                alt="OptiMax"
                width={48}
                height={48}
                className="h-10 w-10 object-contain sm:h-12 sm:w-12"
              />
              <span aria-hidden="true" className="text-2xl font-semibold leading-none tracking-normal text-white">OptiMax</span>
            </div>

            <div className="mt-8 max-w-[540px] lg:mt-10 xl:mt-12">
              <h1 className="m-0 text-3xl font-semibold leading-tight tracking-normal text-white drop-shadow-2xl sm:text-4xl xl:text-5xl">
                Optimax Starter
              </h1>
              <p data-login-intro className="mt-4 text-sm leading-7 text-white/85 sm:text-base sm:leading-8">
                Optimax Starter 为企业应用提供可直接运行的管理底座，整合账户权限、资产台账、操作日志与个人设置，让团队把时间投入真正的业务。统一的界面组件、工程规范和本地运行方式，帮助开发者快速启动新项目；可选的自然语言筛选试点将 AI 接入实际操作，在保留清晰权限边界与可核对结果的同时，逐步扩展业务能力。
              </p>
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center lg:justify-end">
          <div data-login-panel className="border-white/18 w-full max-w-[420px] rounded-lg border bg-white/[0.96] p-6 sm:p-8 text-neutral-950 shadow-2xl shadow-black/35 backdrop-blur-xl">
            <div>
              <h2 className="text-2xl font-bold tracking-normal text-neutral-950">
                登录
              </h2>
            </div>

            <form
              noValidate
              onSubmit={form.handleSubmit(submit)}
              className="mt-6 flex flex-col gap-4 sm:mt-8 sm:gap-5"
            >
              <div className="flex flex-col gap-2">
                <Label htmlFor="username" className="text-sm text-neutral-700">
                  账户名
                </Label>
                <Input
                  id="username"
                  type="text"
                  placeholder="输入账户名"
                  {...form.register("username")}
                  aria-invalid={!!errors.username}
                  aria-describedby={
                    errors.username ? "username-error" : undefined
                  }
                  autoComplete="username"
                  className="h-11 border-neutral-200 bg-white text-neutral-950 shadow-sm"
                />
                {errors.username && (
                  <p
                    id="username-error"
                    role="alert"
                    className="text-sm text-destructive"
                  >
                    {errors.username.message}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="password" className="text-sm text-neutral-700">
                  密码
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="输入密码"
                    {...form.register("password")}
                    aria-invalid={!!errors.password}
                    aria-describedby={
                      errors.password ? "password-error" : undefined
                    }
                    autoComplete="current-password"
                    className="h-11 border-neutral-200 bg-white pr-10 text-neutral-950 shadow-sm"
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? "隐藏密码" : "显示密码"}
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 transition-colors hover:text-neutral-700"
                  >
                    {showPassword ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                {errors.password && (
                  <p
                    id="password-error"
                    role="alert"
                    className="text-sm text-destructive"
                  >
                    {errors.password.message}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="remember"
                    checked={remember}
                    onCheckedChange={(v) => setRemember(v === true)}
                  />
                  <Label
                    htmlFor="remember"
                    className="text-sm font-normal text-neutral-600"
                  >
                    记住账户名
                  </Label>
                </div>
              </div>

              {error && (
                <div
                  role="alert"
                  aria-live="polite"
                  className="flex gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-red-800"
                >
                  <AlertCircle
                    className="mt-0.5 h-4 w-4 shrink-0"
                    aria-hidden="true"
                  />
                  <div>
                    <p className="text-sm font-medium">{error}</p>
                  </div>
                </div>
              )}

              <Button
                type="submit"
                disabled={loading}
                className={cn(
                  "h-11 w-full bg-primary text-white shadow-lg hover:bg-primary/90",
                  "transition-colors duration-200",
                )}
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                {loading ? "登录中..." : "登录"}
              </Button>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}
