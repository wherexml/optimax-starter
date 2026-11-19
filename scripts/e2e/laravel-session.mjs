// LB-05 验收：Laravel 栈会话与认证链路（对齐 laravel-session.mjs 计划）。
// 前置：本地 compose 栈运行；.env 有演示管理员密码；临时 member 由外部包装脚本创建/清理。
// 全部断言基于真实 HTTP 响应，失败即非零退出。
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const base = process.env.LARAVEL_BASE_URL ?? "http://127.0.0.1:38142";
const origin = process.env.E2E_WEB_ORIGIN ?? "http://127.0.0.1:38140";
const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [l.split("=")[0], l.split("=").slice(1).join("=")]),
);
const admin = { username: "demo@optimax.hk", password: env.STARTER_ADMIN_PASSWORD };
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, status: ok ? "PASS" : "FAIL" });
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail !== undefined ? ` -> ${JSON.stringify(detail)}` : ""}`);
  assert.ok(ok, name);
};

async function call(path, { method = "GET", body, cookie, originHeader = origin, json = true } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: {
      // 与 console-client.ts 一致：非 GET 恒发 JSON 头（即使无 body）。
      ...(method !== "GET" ? { "Content-Type": "application/json" } : {}),
      ...(originHeader ? { Origin: originHeader } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const text = await res.text();
  let data;
  try { data = json ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data, setCookie: res.headers.get("set-cookie") ?? "" };
}

// 1. 错误密码 → 401 账户或密码错误
{
  const r = await call("/console/login", { method: "POST", body: { username: admin.username, password: "wrong-pass-000" } });
  check("错误密码 401", r.status === 401 && r.data.error === "账户或密码错误", r.data);
}

// 2. 校验失败 → 400 请输入账户和密码（契约文案）
{
  const r = await call("/console/login", { method: "POST", body: { username: "", password: "" } });
  check("空凭证 400", r.status === 400 && r.data.error === "请输入账户和密码", r.data);
}

// 3. 非法 Origin → 403 请求来源无效
{
  const r = await call("/console/login", { method: "POST", body: admin, originHeader: "http://evil.example" });
  check("非法 Origin 403", r.status === 403 && r.data.error === "请求来源无效", r.data);
}

// 4. 正确登录 → 200 + Cookie 属性（HttpOnly / SameSite=Strict / Max-Age 8h）
let cookie;
{
  const r = await call("/console/login", { method: "POST", body: admin });
  const sc = r.setCookie;
  cookie = sc.split(";")[0];
  check("登录 200 {ok:true}", r.status === 200 && r.data.ok === true, r.data);
  check("Cookie HttpOnly+Strict+8h",
    /httponly/i.test(sc) && /samesite=strict/i.test(sc) && /max-age=28800/i.test(sc), sc.split(";").slice(1).join(";"));
}

// 5. 无 Cookie → 401 请登录
{
  const r = await call("/console/me");
  check("未认证 401", r.status === 401 && r.data.error === "请登录", r.data);
}

// 6. /me 形状（profile + permissions）
{
  const r = await call("/console/me", { cookie });
  const shapeOk = r.status === 200 && r.data.username === admin.username
    && ["member", "admin", "super_admin"].includes(r.data.role)
    && Array.isArray(r.data.permissions) && r.data.permissions.includes("accounts:manage");
  check("/me 200 形状+权限", shapeOk, { role: r.data.role, perms: r.data.permissions?.length });
}

// 7. 权限探针：超管 → 200
{
  const r = await call("/console/probe/accounts", { cookie });
  check("超管 accounts:manage 200", r.status === 200 && r.data.ok === true, r.data);
}

// 8. member 登录 → 探针 403 无权执行该操作（fixture 由包装脚本创建）
{
  const m = await call("/console/login", { method: "POST", body: { username: "lb05_member", password: "Member#2026x" } });
  const mc = m.setCookie.split(";")[0];
  const r = await call("/console/probe/accounts", { cookie: mc });
  check("member 403 无权执行该操作", r.status === 403 && r.data.error === "无权执行该操作", r.data);
}

// 9. 登出 → 会话失效
{
  const r = await call("/console/logout", { method: "POST", cookie });
  check("登出 200", r.status === 200 && r.data.ok === true, r.data);
  const after = await call("/console/me", { cookie });
  check("登出后会话失效 401", after.status === 401, after.data);
}

console.log(JSON.stringify({ status: "PASS", base, results }));
