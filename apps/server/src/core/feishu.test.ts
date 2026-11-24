import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  buildFeishuAuthorizeUrl,
  getFeishuConfig,
  verifyFeishuCode,
  type FeishuConfig,
} from "./feishu";
import { OidcError } from "./oidc";

const BASE_ENV: NodeJS.ProcessEnv = {
  AUTH_FEISHU_ENABLED: "true",
  AUTH_FEISHU_APP_ID: "cli_a1b2c3d4",
  AUTH_FEISHU_APP_SECRET: "feishu-app-secret-value",
  AUTH_FEISHU_TENANT_KEY: "tenant-optimax-01",
  CORS_ORIGIN: "https://app.example.com",
  NODE_ENV: "production",
};

describe("feishu configuration", () => {
  it("is disabled by default and when required fields are missing", () => {
    expect(getFeishuConfig({})).toBeNull();
    expect(getFeishuConfig({ ...BASE_ENV, AUTH_FEISHU_ENABLED: "false" })).toBeNull();
    expect(getFeishuConfig({ ...BASE_ENV, AUTH_FEISHU_APP_ID: "" })).toBeNull();
    expect(getFeishuConfig({ ...BASE_ENV, AUTH_FEISHU_APP_SECRET: "" })).toBeNull();
    expect(getFeishuConfig({ ...BASE_ENV, AUTH_FEISHU_TENANT_KEY: "" })).toBeNull();
  });

  it("prefers AUTH_FEISHU_APP_SECRET_FILE over inline secret", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "starter-feishu-secret-"));
    try {
      const secretFile = path.join(dir, "secret.txt");
      writeFileSync(secretFile, "secret-from-file\n", "utf8");
      const cfg = getFeishuConfig({
        ...BASE_ENV,
        AUTH_FEISHU_APP_SECRET_FILE: secretFile,
        AUTH_FEISHU_APP_SECRET: "inline-fallback",
      });
      expect(cfg?.appSecret).toBe("secret-from-file");

      const fallback = getFeishuConfig({
        ...BASE_ENV,
        AUTH_FEISHU_APP_SECRET_FILE: path.join(dir, "missing.txt"),
        AUTH_FEISHU_APP_SECRET: "inline-fallback",
      });
      expect(fallback?.appSecret).toBe("inline-fallback");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("derives defaults and enforces HTTPS in production", () => {
    const cfg = getFeishuConfig(BASE_ENV)!;
    expect(cfg).not.toBeNull();
    expect(cfg.providerId).toBe("feishu");
    expect(cfg.label).toBe("使用飞书登录");
    expect(cfg.redirectUri).toBe("https://app.example.com/console/auth/sso/feishu/callback");
    expect(cfg.allowEmailLink).toBe(true);
    expect(cfg.autoProvision).toBe(false);
    expect(cfg.authorizeUrl).toBe("https://accounts.feishu.cn/open-apis/authen/v1/authorize");
    expect(cfg.apiBase).toBe("https://open.feishu.cn");

    expect(
      getFeishuConfig({
        ...BASE_ENV,
        CORS_ORIGIN: "http://app.example.com",
      }),
    ).toBeNull();
    expect(
      getFeishuConfig({
        ...BASE_ENV,
        AUTH_FEISHU_API_BASE: "http://mock-feishu.example.com",
      }),
    ).toBeNull();

    const devCfg = getFeishuConfig({
      ...BASE_ENV,
      NODE_ENV: "development",
      CORS_ORIGIN: "http://127.0.0.1:38140",
      AUTH_FEISHU_API_BASE: "http://host.docker.internal:38999",
      AUTH_FEISHU_AUTO_PROVISION: "true",
      AUTH_FEISHU_ALLOW_EMAIL_LINK: "false",
      AUTH_FEISHU_LABEL: "OptiMax 飞书",
    })!;
    expect(devCfg.redirectUri).toBe("http://127.0.0.1:38140/console/auth/sso/feishu/callback");
    expect(devCfg.apiBase).toBe("http://host.docker.internal:38999");
    expect(devCfg.autoProvision).toBe(true);
    expect(devCfg.allowEmailLink).toBe(false);
    expect(devCfg.label).toBe("OptiMax 飞书");
  });

  it("builds Feishu OAuth authorization URL with PKCE S256", () => {
    const cfg = getFeishuConfig(BASE_ENV)!;
    const url = new URL(
      buildFeishuAuthorizeUrl(cfg, {
        state: "state-123",
        codeChallenge: "challenge-abc",
      }),
    );
    expect(url.origin + url.pathname).toBe(
      "https://accounts.feishu.cn/open-apis/authen/v1/authorize",
    );
    expect(url.searchParams.get("client_id")).toBe("cli_a1b2c3d4");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("redirect_uri")).toBe(cfg.redirectUri);
    expect(url.searchParams.get("state")).toBe("state-123");
    expect(url.searchParams.get("code_challenge")).toBe("challenge-abc");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
  });
});

describe("verifyFeishuCode against Feishu OAuth endpoints", () => {
  type Scenario =
    | "ok"
    | "wrong_tenant"
    | "missing_openid"
    | "token_http_500"
    | "token_biz_error"
    | "token_bad_json"
    | "userinfo_biz_error";

  let scenario: Scenario = "ok";
  let lastTokenBody: Record<string, unknown> | null = null;
  let lastAuthHeader: string | undefined;

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const rawBody = Buffer.concat(chunks).toString("utf8");

    if (req.url === "/open-apis/authen/v2/oauth/token" && req.method === "POST") {
      lastTokenBody = JSON.parse(rawBody || "{}") as Record<string, unknown>;
      if (scenario === "token_http_500") {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ code: 500, msg: "internal" }));
        return;
      }
      if (scenario === "token_biz_error") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ code: 20003, error: "invalid_grant" }));
        return;
      }
      if (scenario === "token_bad_json") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("not-json");
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ code: 0, access_token: "u-secret-upstream-token" }));
      return;
    }

    if (req.url === "/open-apis/authen/v1/user_info" && req.method === "GET") {
      lastAuthHeader = req.headers.authorization;
      if (scenario === "userinfo_biz_error") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ code: 99991663, msg: "token invalid" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          code: 0,
          data: {
            tenant_key: scenario === "wrong_tenant" ? "other-tenant-99" : "tenant-optimax-01",
            open_id: scenario === "missing_openid" ? "" : "ou_user_001",
            union_id: "on_union_001",
            name: "张工程师",
            en_name: "Zhang",
            email: "personal@example.org",
            enterprise_email: "Zhang@Optimax.hk",
          },
        }),
      );
      return;
    }

    res.writeHead(404).end();
  });

  let baseCfg: FeishuConfig;

  const ready = new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("unexpected listen address");
      baseCfg = {
        providerId: "feishu",
        label: "使用飞书登录",
        appId: "cli_a1b2c3d4",
        appSecret: "super-secret-app-key",
        tenantKey: "tenant-optimax-01",
        redirectUri: "http://127.0.0.1:38140/console/auth/sso/feishu/callback",
        allowEmailLink: true,
        autoProvision: false,
        authorizeUrl: "https://accounts.feishu.cn/open-apis/authen/v1/authorize",
        apiBase: `http://127.0.0.1:${addr.port}`,
      };
      resolve();
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("exchanges code with PKCE verifier, checks tenant_key and strips upstream secrets", async () => {
    await ready;
    scenario = "ok";
    const identity = await verifyFeishuCode(baseCfg, "auth-code-1", "pkce-verifier-1");
    expect(lastTokenBody).toEqual({
      grant_type: "authorization_code",
      client_id: "cli_a1b2c3d4",
      client_secret: "super-secret-app-key",
      redirect_uri: baseCfg.redirectUri,
      code: "auth-code-1",
      code_verifier: "pkce-verifier-1",
    });
    expect(lastAuthHeader).toBe("Bearer u-secret-upstream-token");
    expect(identity).toEqual({
      openId: "ou_user_001",
      unionId: "on_union_001",
      name: "张工程师",
      email: "Zhang@Optimax.hk",
    });
    const serialized = JSON.stringify(identity);
    expect(serialized).not.toContain("u-secret-upstream-token");
    expect(serialized).not.toContain("super-secret-app-key");
  });

  it("rejects mismatched tenant_key with tenant_forbidden", async () => {
    await ready;
    scenario = "wrong_tenant";
    await expect(verifyFeishuCode(baseCfg, "code", "ver")).rejects.toMatchObject({
      name: "OidcError",
      code: "tenant_forbidden",
    } satisfies Partial<OidcError>);
  });

  it("maps upstream token/profile failures to token_failed", async () => {
    await ready;
    for (const s of [
      "missing_openid",
      "token_http_500",
      "token_biz_error",
      "token_bad_json",
      "userinfo_biz_error",
    ] as const) {
      scenario = s;
      await expect(verifyFeishuCode(baseCfg, "code", "ver")).rejects.toMatchObject({
        name: "OidcError",
        code: "token_failed",
      });
    }
  });
});
