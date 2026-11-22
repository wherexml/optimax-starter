// Covers the pure HTTP helpers that guards.ts re-exports (guards.ts itself imports the DB singleton).
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_ERROR_CODES,
  Refusal,
  defaultErrorCode,
  errorJson,
  getClientIp,
  normalizeIp,
  refusalJson,
  resolveClientIp,
  resolveRequestId,
} from "./http";

describe("error codes", () => {
  it("maps HTTP statuses to API_CONVENTIONS §5 prefixes", () => {
    expect(defaultErrorCode(400)).toBe("VALIDATION_BAD_REQUEST");
    expect(defaultErrorCode(401)).toBe("AUTH_REQUIRED");
    expect(defaultErrorCode(403)).toBe("PERM_DENIED");
    expect(defaultErrorCode(404)).toBe("DATA_NOT_FOUND");
    expect(defaultErrorCode(409)).toBe("DATA_CONFLICT");
    expect(defaultErrorCode(410)).toBe("DATA_EXPIRED");
    expect(defaultErrorCode(413)).toBe("FILE_TOO_LARGE");
    expect(defaultErrorCode(422)).toBe("VALIDATION_FAILED");
    expect(defaultErrorCode(429)).toBe("RATE_LIMITED");
    expect(defaultErrorCode(500)).toBe("SYS_INTERNAL_ERROR");
    expect(defaultErrorCode(418)).toBe("SYS_INTERNAL_ERROR");
    for (const code of Object.values(DEFAULT_ERROR_CODES)) {
      expect(code).toMatch(/^(VALIDATION|AUTH|PERM|DATA|FILE|RATE|SYS)_[A-Z_]+$/);
    }
  });

  it("Refusal keeps message/status and defaults code by status", () => {
    const r = new Refusal(409, "账户名已存在");
    expect(r).toBeInstanceOf(Error);
    expect(r.status).toBe(409);
    expect(r.message).toBe("账户名已存在");
    expect(r.code).toBe("DATA_CONFLICT");
    expect(new Refusal(429, "x", "AUTH_LOCKED", { "Retry-After": "60" }).headers).toEqual({
      "Retry-After": "60",
    });
  });
});

describe("errorJson", () => {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("requestId", "req-test-0001");
    await next();
  });
  app.get("/plain", (c) => errorJson(c, 403, "无权执行该操作"));
  app.get("/locked", (c) =>
    refusalJson(c, new Refusal(429, "登录失败次数过多", "AUTH_LOCKED", { "Retry-After": "120" })),
  );

  it("returns backward-compatible { error } plus code and requestId", async () => {
    const res = await app.request("/plain");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "无权执行该操作",
      code: "PERM_DENIED",
      requestId: "req-test-0001",
    });
  });

  it("passes explicit code and headers", async () => {
    const res = await app.request("/locked");
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("120");
    expect(((await res.json()) as { code?: string }).code).toBe("AUTH_LOCKED");
  });
});

describe("resolveRequestId", () => {
  it("accepts safe incoming ids", () => {
    expect(resolveRequestId("abcDEF12")).toBe("abcDEF12");
    expect(resolveRequestId("trace-1.2_3")).toBe("trace-1.2_3");
  });

  it("replaces missing, short, long or unsafe ids with a UUID", () => {
    const uuid = /^[0-9a-f-]{36}$/;
    expect(resolveRequestId(undefined)).toMatch(uuid);
    expect(resolveRequestId("short")).toMatch(uuid);
    expect(resolveRequestId("a".repeat(65))).toMatch(uuid);
    expect(resolveRequestId("bad id with spaces")).toMatch(uuid);
    expect(resolveRequestId("inject\r\nX-Evil: 1")).toMatch(uuid);
    expect(resolveRequestId("<script>alert(1)</script>")).toMatch(uuid);
  });
});

describe("client IP trust boundary", () => {
  afterEach(() => {
    delete process.env.TRUST_PROXY;
  });

  it("normalizes IPv4, IPv6 and IPv4-mapped IPv6", () => {
    expect(normalizeIp("10.0.0.1")).toBe("10.0.0.1");
    expect(normalizeIp("::ffff:127.0.0.1")).toBe("127.0.0.1");
    expect(normalizeIp("2001:DB8::1")).toBe("2001:db8::1");
    expect(normalizeIp("[::1]")).toBe("::1");
    expect(normalizeIp("not-an-ip")).toBeNull();
    expect(normalizeIp("1.2.3.4, 5.6.7.8")).toBeNull();
    expect(normalizeIp("")).toBeNull();
  });

  it("ignores forwarding headers unless TRUST_PROXY is enabled", () => {
    expect(
      resolveClientIp({ trustProxy: false, forwardedFor: "1.1.1.1", remoteAddress: "::ffff:10.0.0.5" }),
    ).toBe("10.0.0.5");
    expect(
      resolveClientIp({ trustProxy: true, forwardedFor: "1.1.1.1, 10.0.0.9", remoteAddress: "10.0.0.5" }),
    ).toBe("1.1.1.1");
    expect(resolveClientIp({ trustProxy: true, realIp: "2.2.2.2", remoteAddress: "10.0.0.5" })).toBe(
      "2.2.2.2",
    );
  });

  it("falls back to socket address on invalid forwarded values, then to unknown", () => {
    expect(
      resolveClientIp({ trustProxy: true, forwardedFor: "evil<script>", remoteAddress: "10.0.0.5" }),
    ).toBe("10.0.0.5");
    expect(resolveClientIp({ trustProxy: false })).toBe("unknown");
  });

  it("reads the Hono node-server socket address from c.env.incoming", async () => {
    const app = new Hono();
    app.get("/", (c) => c.text(getClientIp(c)));
    const env = { incoming: { socket: { remoteAddress: "::ffff:192.168.1.20" } } };
    const res = await app.request("/", { headers: { "X-Forwarded-For": "8.8.8.8" } }, env);
    expect(await res.text()).toBe("192.168.1.20");
    process.env.TRUST_PROXY = "true";
    const proxied = await app.request("/", { headers: { "X-Forwarded-For": "8.8.8.8" } }, env);
    expect(await proxied.text()).toBe("8.8.8.8");
  });
});
