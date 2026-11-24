import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { configureFeishuAuth } from "./configure-feishu-auth.mjs";

const dirs: string[] = [];
function makeTmpRoot(initialEnv: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "starter-feishu-skill-"));
  dirs.push(dir);
  writeFileSync(path.join(dir, ".env"), initialEnv, "utf8");
  return dir;
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("configure-feishu-auth CLI helper", () => {
  it("reports default disabled status and derived callback URL without exposing secret values", () => {
    const root = makeTmpRoot(
      [
        "WEB_PORT=38150",
        "API_PORT=38151",
        "CORS_ORIGIN=http://127.0.0.1:38150",
        "AUTH_FEISHU_ENABLED=false",
        "",
      ].join("\n"),
    );
    const status = configureFeishuAuth(["--root", root, "--status"]);
    expect(status.enabled).toBe(false);
    expect(status.passwordLoginEnabled).toBe(true);
    expect(status.callbackUrl).toBe("http://127.0.0.1:38150/console/auth/sso/feishu/callback");
    expect(status.autoProvision).toBe(false);
  });

  it("enables Feishu OAuth with private 0600 secret file and optional auto-provision / feishu-only", () => {
    const root = makeTmpRoot(
      [
        "CORS_ORIGIN=https://demo.example.com",
        "STARTER_ADMIN_PASSWORD=keep-me",
        "",
      ].join("\n"),
    );
    const secretFile = path.join(root, ".local", "feishu-app-secret");
    writeFileSync(
      path.join(root, ".env"),
      "CORS_ORIGIN=https://demo.example.com\nSTARTER_ADMIN_PASSWORD=keep-me\n",
      "utf8",
    );

    const res = configureFeishuAuth(
      [
        "--root",
        root,
        "--enable",
        "--app-id",
        "cli_demo_123",
        "--tenant-key",
        "tenant_optimax",
        "--secret-file",
        ".local/feishu-app-secret",
        "--auto-provision",
        "--feishu-only",
        "--label",
        "使用飞书登录",
      ],
      { secretInput: "very-secret-feishu-value" },
    );

    expect(res.enabled).toBe(true);
    expect(res.passwordLoginEnabled).toBe(false);
    expect(res.autoProvision).toBe(true);
    expect(res.callbackUrl).toBe("https://demo.example.com/console/auth/sso/feishu/callback");
    expect(JSON.stringify(res)).not.toContain("very-secret-feishu-value");

    const mode = statSync(secretFile).mode & 0o777;
    expect(mode).toBe(0o600);
    expect(readFileSync(secretFile, "utf8").trim()).toBe("very-secret-feishu-value");

    const envText = readFileSync(path.join(root, ".env"), "utf8");
    expect(envText).toContain("AUTH_FEISHU_ENABLED=true");
    expect(envText).toContain("AUTH_FEISHU_APP_ID=cli_demo_123");
    expect(envText).toContain("AUTH_FEISHU_TENANT_KEY=tenant_optimax");
    expect(envText).toContain("AUTH_FEISHU_APP_SECRET_FILE=.local/feishu-app-secret");
    expect(envText).toContain("AUTH_FEISHU_AUTO_PROVISION=true");
    expect(envText).toContain("AUTH_PASSWORD_LOGIN_ENABLED=false");
    expect(envText).not.toContain("very-secret-feishu-value");
  });

  it("restores default disabled and password-enabled state via --disable", () => {
    const root = makeTmpRoot(
      [
        "CORS_ORIGIN=http://127.0.0.1:38140",
        "AUTH_FEISHU_ENABLED=true",
        "AUTH_PASSWORD_LOGIN_ENABLED=false",
        "AUTH_FEISHU_AUTO_PROVISION=true",
        "",
      ].join("\n"),
    );

    const res = configureFeishuAuth(["--root", root, "--disable"]);
    expect(res.enabled).toBe(false);
    expect(res.passwordLoginEnabled).toBe(true);
    const envText = readFileSync(path.join(root, ".env"), "utf8");
    expect(envText).toContain("AUTH_FEISHU_ENABLED=false");
    expect(envText).toContain("AUTH_PASSWORD_LOGIN_ENABLED=true");
  });
});
