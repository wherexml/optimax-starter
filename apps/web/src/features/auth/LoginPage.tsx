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
import { ProductMarkIcon } from "@/components/brand/ProductMarkIcon";
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
        src="/login-map.png"
        alt=""
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover object-left"
      />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(2,8,18,0.18)_0%,rgba(3,10,20,0.08)_38%,rgba(3,10,20,0.58)_64%,rgba(3,10,20,0.92)_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_72%_50%,rgba(47,111,237,0.13),transparent_34%)]" />

      <div className="relative z-10 grid min-h-screen grid-cols-1 gap-8 px-6 py-8 lg:grid-cols-[minmax(0,1fr)_460px] lg:gap-0 lg:px-12 xl:px-16">
        <section className="flex min-h-0 flex-col lg:min-h-[420px] justify-between pb-0 lg:pb-16 xl:pb-20">
          <div className="max-w-xl">
            <div className="border-white/12 inline-flex items-center gap-3 rounded-lg border bg-white/[0.06] px-4 py-3 shadow-lg shadow-black/20 backdrop-blur-md">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10">
                <ProductMarkIcon
                  className="h-6 w-6 text-cyan-200"
                  aria-hidden="true"
                />
              </div>
              <div>
                <h1 className="text-xl font-semibold leading-6 tracking-normal text-white">
                  OptiMax
                </h1>
              </div>
            </div>

            <div className="mt-14 max-w-2xl">
              <p className="max-w-[620px] text-4xl font-semibold leading-tight tracking-normal text-white drop-shadow-2xl xl:text-5xl">
                管理控制台
              </p>
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center lg:justify-end">
          <div className="border-white/18 w-full max-w-[420px] rounded-lg border bg-white/[0.96] p-8 text-neutral-950 shadow-2xl shadow-black/35 backdrop-blur-xl">
            <div>
              <h2 className="text-2xl font-bold tracking-normal text-neutral-950">
                登录
              </h2>
            </div>

            <form
              noValidate
              onSubmit={form.handleSubmit(submit)}
              className="mt-8 flex flex-col gap-5"
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
