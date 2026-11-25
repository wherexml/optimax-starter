// Whitelist validation and localhost security boundaries of scripts/setup-server.mjs.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as setup from "./setup-server.mjs";

type Command = { bin: string; args: string[]; display: string; cwd: string; mutates: boolean };
type Handle = { port: number; token: string; url: string; close: () => Promise<void> };

const { ActionError, GEN_MODULE_RESERVED, buildActionCommand, startSetupServer } = setup as {
  ActionError: new (message: string) => Error;
  GEN_MODULE_RESERVED: Set<string>;
  buildActionCommand: (action: unknown, params?: unknown) => Command;
  startSetupServer: (options: { port: number; noOpen: boolean }) => Promise<Handle>;
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const rejects = (action: unknown, params?: unknown) =>
  expect(() => buildActionCommand(action, params)).toThrow(ActionError);

describe("buildActionCommand", () => {
  it("rejects unknown or forbidden actions", () => {
    for (const action of ["deploy", "git_push", "git_commit", "shell", "", null, 42, "__proto__"]) {
      rejects(action);
    }
  });

  it("builds argv arrays for bootstrap without any shell", () => {
    const cmd = buildActionCommand("bootstrap", {
      slug: "vendor-portal",
      title: "供应商管理平台",
      webPort: 38160,
      noDemos: true,
      noExample: true,
      noAgent: true,
      starterSha: "abc1234",
    });
    expect(cmd.bin).toBe("bash");
    expect(cmd.args.slice(1)).toEqual([
      "vendor-portal",
      "--title",
      "供应商管理平台",
      "--web-port",
      "38160",
      "--no-demos",
      "--no-example",
      "--no-agent",
      "--starter-sha",
      "abc1234",
    ]);
    expect(cmd.mutates).toBe(true);
    const dry = buildActionCommand("bootstrap_dry_run", { slug: "vendor-portal" });
    expect(dry.args.at(-1)).toBe("--dry-run");
    expect(dry.mutates).toBe(false);
    const dryNoAgent = buildActionCommand("bootstrap_dry_run", {
      slug: "vendor-portal",
      noAgent: true,
    });
    expect(dryNoAgent.args.slice(1)).toEqual(["vendor-portal", "--no-agent", "--dry-run"]);
    expect(dryNoAgent.mutates).toBe(false);
    expect(buildActionCommand("local_env", {}).args.slice(1)).toEqual(["--local-env"]);
  });

  it("rejects bad slugs, shell metacharacters, unknown params and out-of-range ports", () => {
    rejects("bootstrap", {});
    rejects("bootstrap", { slug: "Vendor" });
    rejects("bootstrap", { slug: "a" });
    rejects("bootstrap", { slug: "vendor;rm -rf /" });
    rejects("bootstrap", { slug: "vendor", title: "x$(id)" });
    rejects("bootstrap", { slug: "vendor", title: "a`b`" });
    rejects("bootstrap", { slug: "vendor", title: "a\nb" });
    rejects("bootstrap", { slug: "vendor", webPort: 80 });
    rejects("bootstrap", { slug: "vendor", webPort: 65531 });
    rejects("bootstrap", { slug: "vendor", webPort: "38150; ls" });
    rejects("bootstrap", { slug: "vendor", starterSha: "HEAD" });
    rejects("bootstrap", { slug: "vendor", starterRepo: "file:///etc/passwd" });
    rejects("bootstrap", { slug: "vendor", noDemos: "yes" });
    rejects("bootstrap", { slug: "vendor", noAgent: "yes" });
    rejects("bootstrap", { slug: "vendor", extra: 1 });
    rejects("local_env", { slug: "vendor" });
    rejects("doctor", { verbose: true });
  });

  it("validates gen_module slug, label and --fields", () => {
    const cmd = buildActionCommand("gen_module", {
      slug: "vendors",
      label: "供应商台账",
      singular: "vendor",
      fields: "code:string:编号,kind:enum:采购|销售:类型,remark:text:备注?",
      detail: "page",
    });
    expect(cmd.bin).toBe(process.execPath);
    expect(cmd.args).toEqual([
      "scripts/gen-module.mjs",
      "vendors",
      "--label",
      "供应商台账",
      "--singular",
      "vendor",
      "--fields",
      "code:string:编号,kind:enum:采购|销售:类型,remark:text:备注?",
      "--detail",
      "page",
    ]);
    const withDrawer = buildActionCommand("gen_module", {
      slug: "vendors",
      label: "供应商台账",
      detail: "drawer",
    });
    expect(withDrawer.args).toEqual([
      "scripts/gen-module.mjs",
      "vendors",
      "--label",
      "供应商台账",
      "--detail",
      "drawer",
    ]);
    const dry = buildActionCommand("gen_module_dry_run", { slug: "vendors", label: "供应商" });
    expect(dry.args.at(-1)).toBe("--dry-run");
    for (const slug of GEN_MODULE_RESERVED) rejects("gen_module", { slug, label: "x" });
    rejects("gen_module", { slug: "vendors" });
    rejects("gen_module", { slug: "vendors", label: "供应商", detail: "modal" });
    rejects("gen_module", { slug: "vendors", label: "供应商", fields: "id:string" });
    rejects("gen_module", { slug: "vendors", label: "供应商", fields: "a:float" });
    rejects("gen_module", { slug: "vendors", label: "供应商", fields: "kind:enum:one" });
    rejects("gen_module", { slug: "vendors", label: "供应商", fields: "a:string;touch x" });
  });

  it("keeps the reserved slug list in sync with gen-module.mjs", () => {
    const src = readFileSync(path.join(ROOT, "scripts/gen-module.mjs"), "utf-8");
    const block = src.match(/const RESERVED = new Set\(\[([\s\S]*?)\]\)/)?.[1] ?? "";
    const names = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect([...GEN_MODULE_RESERVED].sort()).toEqual(names.sort());
  });

  it("validates db_generate migration names", () => {
    const cmd = buildActionCommand("db_generate", { name: "add_vendors" });
    expect(cmd.bin).toBe("bunx");
    expect(cmd.args).toEqual(["drizzle-kit", "generate", "--name", "add_vendors"]);
    expect(cmd.cwd).toBe(path.join(ROOT, "packages/db"));
    expect(buildActionCommand("db_generate", {}).args).toEqual(["drizzle-kit", "generate"]);
    rejects("db_generate", { name: "Add Vendors" });
    rejects("db_generate", { name: "x".repeat(41) });
  });
});

function readSecrets(): string[] {
  try {
    const text = readFileSync(path.join(ROOT, ".env"), "utf-8");
    return text
      .split(/\r?\n/)
      .map((line) => line.match(/^(STARTER_DB_PASSWORD|STARTER_ADMIN_PASSWORD)=(.+)$/)?.[2]?.trim())
      .filter((v): v is string => Boolean(v && v.length >= 4));
  } catch {
    return [];
  }
}

describe("setup server", () => {
  it("enforces token and origin, streams whitelisted runs and shuts down", async () => {
    const server = await startSetupServer({ port: 0, noOpen: true });
    const base = `http://127.0.0.1:${server.port}`;
    try {
      expect((await fetch(`${base}/`)).status).toBe(403);
      expect((await fetch(`${base}/?token=${"0".repeat(64)}`)).status).toBe(403);
      const page = await fetch(server.url);
      expect(page.status).toBe(200);
      const html = await page.text();
      expect(html).toContain("window.__SETUP_BRIDGE__");
      expect(html).toContain(server.token);

      expect((await fetch(`${base}/api/status`)).status).toBe(403);
      expect(
        (await fetch(`${base}/api/status`, { headers: { "X-Setup-Token": "wrong" } })).status,
      ).toBe(403);
      const status = await fetch(`${base}/api/status`, {
        headers: { "X-Setup-Token": server.token },
      });
      expect(status.status).toBe(200);
      const raw = await status.text();
      const body = JSON.parse(raw);
      expect(body.ok).toBe(true);
      expect(body.mode).toBe("live");
      expect(body.git).toBeTypeOf("object");
      expect(Array.isArray(body.doctor.checks)).toBe(true);
      expect(raw).not.toMatch(/PASSWORD"\s*:/);
      for (const secret of readSecrets()) expect(raw).not.toContain(secret);

      const runBody = JSON.stringify({ action: "db_check", params: {} });
      const headers = { "Content-Type": "application/json", "X-Setup-Token": server.token };
      const noOrigin = await fetch(`${base}/api/run`, { method: "POST", headers, body: runBody });
      expect(noOrigin.status).toBe(403);
      expect(
        (
          await fetch(`${base}/api/run`, {
            method: "POST",
            headers: { ...headers, Origin: "https://evil.example" },
            body: runBody,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await fetch(`${base}/api/run`, {
            method: "POST",
            headers: { ...headers, Origin: base, "X-Setup-Token": "wrong" },
            body: runBody,
          })
        ).status,
      ).toBe(403);
      const bad = await fetch(`${base}/api/run`, {
        method: "POST",
        headers: { ...headers, Origin: base },
        body: JSON.stringify({ action: "deploy", params: {} }),
      });
      expect(bad.status).toBe(400);

      const run = await fetch(`${base}/api/run`, {
        method: "POST",
        headers: { ...headers, Origin: base },
        body: runBody,
      });
      expect(run.status).toBe(200);
      expect(run.headers.get("content-type")).toContain("text/event-stream");
      const stream = await run.text();
      expect(stream).toContain("event: start");
      const done = stream.match(/event: done\ndata: (.+)\n/);
      expect(done).not.toBeNull();
      expect(JSON.parse(done![1]!).exitCode).toBe(0);

      const shutdown = await fetch(`${base}/api/shutdown`, {
        method: "POST",
        headers: { ...headers, Origin: base },
      });
      expect(shutdown.status).toBe(200);
      expect(await shutdown.json()).toEqual({ ok: true });
    } finally {
      await server.close();
    }
  }, 180_000);
});
