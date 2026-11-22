// Bearer vs Cookie boundary helpers (core/bearer.ts imports no DB; guards.ts does, so it is not used here).
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import {
  API_TOKEN_RE,
  isInteractiveOnlyRoute,
  isWellFormedApiToken,
  originAllowed,
  originCheckRequired,
  parseAuthorization,
  requireCookieSession,
  resolveTokenPermissions,
} from "./bearer";
import type { Actor, Env } from "./guards";

const TOKEN = `optx_${"A".repeat(16)}${"b9_-".repeat(4)}`;
const CORS = "http://127.0.0.1:38140";

describe("resolveTokenPermissions", () => {
  it("returns the intersection of live role permissions and token scopes", () => {
    expect(
      resolveTokenPermissions(["assets:read", "assets:manage", "audit:read"], ["assets:read", "audit:read"]),
    ).toEqual(["assets:read", "audit:read"]);
  });

  it("never grants scopes the role no longer holds (live downgrade)", () => {
    const scopes = ["assets:read", "assets:manage", "accounts:manage"];
    expect(resolveTokenPermissions(["assets:read"], scopes)).toEqual(["assets:read"]);
    expect(resolveTokenPermissions([], scopes)).toEqual([]);
  });

  it("never grants role permissions missing from the token scopes", () => {
    expect(resolveTokenPermissions(["assets:read", "accounts:manage", "jobs:manage"], ["assets:read"])).toEqual([
      "assets:read",
    ]);
    expect(resolveTokenPermissions(["assets:read"], [])).toEqual([]);
  });

  it("ignores unknown scopes and keeps role order without duplicates", () => {
    expect(resolveTokenPermissions(["b", "a"], ["a", "b", "a", "root:*"])).toEqual(["b", "a"]);
  });
});

describe("parseAuthorization", () => {
  it("classifies missing and blank headers as none", () => {
    expect(parseAuthorization(undefined)).toEqual({ kind: "none" });
    expect(parseAuthorization(null)).toEqual({ kind: "none" });
    expect(parseAuthorization("   ")).toEqual({ kind: "none" });
  });

  it("extracts Bearer tokens case-insensitively", () => {
    expect(parseAuthorization(`Bearer ${TOKEN}`)).toEqual({ kind: "bearer", token: TOKEN });
    expect(parseAuthorization(`bearer   ${TOKEN}  `)).toEqual({ kind: "bearer", token: TOKEN });
    expect(parseAuthorization(`BEARER ${TOKEN}`)).toEqual({ kind: "bearer", token: TOKEN });
  });

  it("keeps malformed Bearer headers as bearer so they can never fall back to the cookie", () => {
    for (const header of [
      "Bearer",
      "Bearer ",
      "Bearer not-a-token",
      "Bearer optx_short",
      `Bearer ${TOKEN} extra`,
      `Bearer\t${TOKEN}x`,
    ]) {
      const auth = parseAuthorization(header);
      expect(auth.kind, header).toBe("bearer");
      if (auth.kind === "bearer") expect(isWellFormedApiToken(auth.token), header).toBe(false);
    }
  });

  it("classifies non-Bearer schemes as other", () => {
    expect(parseAuthorization("Basic dXNlcjpwYXNz")).toEqual({ kind: "other" });
    expect(parseAuthorization(`Bearerx ${TOKEN}`)).toEqual({ kind: "other" });
    expect(parseAuthorization(`Token ${TOKEN}`)).toEqual({ kind: "other" });
  });
});

describe("API token format", () => {
  it("accepts optx_ + 32 base64url chars only", () => {
    expect(API_TOKEN_RE.test(TOKEN)).toBe(true);
    expect(isWellFormedApiToken(`${TOKEN}x`)).toBe(false);
    expect(isWellFormedApiToken(TOKEN.slice(0, -1))).toBe(false);
    expect(isWellFormedApiToken(TOKEN.replace("optx_", "optz_"))).toBe(false);
    expect(isWellFormedApiToken(`optx_${"a".repeat(31)}=`)).toBe(false);
    expect(isWellFormedApiToken(`optx_${"a".repeat(31)}+`)).toBe(false);
  });
});

describe("CSRF Origin boundary", () => {
  const bearer = parseAuthorization(`Bearer ${TOKEN}`);
  const cookie = parseAuthorization(undefined);
  const other = parseAuthorization("Basic eA==");

  it("never checks Origin for safe methods", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) {
      expect(originCheckRequired(method, cookie), method).toBe(false);
      expect(originAllowed(method, cookie, undefined, CORS), method).toBe(true);
    }
  });

  it("exempts Bearer writes (including multipart uploads) from the Origin check", () => {
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      expect(originCheckRequired(method, bearer), method).toBe(false);
      expect(originAllowed(method, bearer, undefined, CORS), method).toBe(true);
      expect(originAllowed(method, bearer, "https://evil.example", CORS), method).toBe(true);
    }
  });

  it("requires an exact Origin match for Cookie and anonymous writes", () => {
    for (const auth of [cookie, other]) {
      expect(originCheckRequired("POST", auth)).toBe(true);
      expect(originAllowed("POST", auth, CORS, CORS)).toBe(true);
      expect(originAllowed("POST", auth, undefined, CORS)).toBe(false);
      expect(originAllowed("POST", auth, "null", CORS)).toBe(false);
      expect(originAllowed("DELETE", auth, "https://evil.example", CORS)).toBe(false);
      expect(originAllowed("POST", auth, `${CORS}.evil.example`, CORS)).toBe(false);
      expect(originAllowed("POST", auth, `${CORS}/`, CORS)).toBe(false);
    }
  });
});

describe("interactive-only routes", () => {
  it("marks password, sessions and token management as interactive-only", () => {
    for (const path of [
      "/console/me/password",
      "/console/me/sessions",
      "/console/me/sessions/revoke-others",
      "/console/me/sessions/12",
      "/console/me/tokens",
      "/console/me/tokens/3",
    ]) {
      expect(isInteractiveOnlyRoute(path), path).toBe(true);
    }
  });

  it("leaves Bearer-capable APIs reachable", () => {
    for (const path of [
      "/console/me",
      "/console/assets/page",
      "/console/attachments",
      "/console/jobs",
      "/console/me/tokensx",
      "/console/me/passwords",
    ]) {
      expect(isInteractiveOnlyRoute(path), path).toBe(false);
    }
  });
});

describe("requireCookieSession", () => {
  const actor = (authType: Actor["authType"]): Actor =>
    ({
      id: 1,
      username: "demo@optimax.hk",
      name: "Demo",
      role: "super_admin",
      active: true,
      permissions: ["assets:read"],
      authType,
      actorSource: authType === "cookie" ? "human" : "agent",
    }) as Actor;

  const appFor = (authType: Actor["authType"]) =>
    new Hono<Env>()
      .use("*", async (c, next) => {
        c.set("actor", actor(authType));
        await next();
      })
      .get("/console/me/tokens", requireCookieSession, (c) => c.json({ ok: true }))
      .post("/console/me/tokens", requireCookieSession, (c) => c.json({ ok: true }, 201));

  it("allows cookie sessions", async () => {
    const app = appFor("cookie");
    expect((await app.request("/console/me/tokens")).status).toBe(200);
    expect((await app.request("/console/me/tokens", { method: "POST" })).status).toBe(201);
  });

  it("rejects Bearer callers with 403 PERM_INTERACTIVE_REQUIRED", async () => {
    const app = appFor("bearer");
    for (const method of ["GET", "POST"]) {
      const res = await app.request("/console/me/tokens", { method });
      expect(res.status, method).toBe(403);
      const body = (await res.json()) as { code: string; error: string };
      expect(body.code).toBe("PERM_INTERACTIVE_REQUIRED");
      expect(body.error).toBe("此操作仅允许网页登录会话执行");
    }
  });
});
