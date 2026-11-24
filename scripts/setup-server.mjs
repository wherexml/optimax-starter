#!/usr/bin/env node
// Local one-click setup wizard: serves docs/onboarding.html on 127.0.0.1 with a per-run token and
// runs a strict whitelist of repository scripts, streaming their output as Server-Sent Events.
// Pure Node built-ins. Never runs production deploys, git commit/push, or shell strings.
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findFreePortPair, readEnvFile, runDoctorChecks } from "./doctor.mjs";
import { parseFieldsSpec } from "./lib/gen-module-fields.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FALLBACK_DATABASE_URL = "postgres://starter:ci@127.0.0.1:5432/starter";
const MAX_BODY_BYTES = 64 * 1024;

export const CORE_MODULES = new Set([
  "accounts",
  "attachments",
  "audit",
  "auth",
  "jobs",
  "system",
  "tokens",
]);

// Mirrors RESERVED in scripts/gen-module.mjs (kept in sync by scripts/setup-server.test.ts).
export const GEN_MODULE_RESERVED = new Set([
  "auth",
  "accounts",
  "audit",
  "assets",
  "permissions",
  "system",
  "settings",
  "login",
  "demo",
  "console",
  "healthz",
  "contracts",
  "agent",
  "assistant",
]);

const SECRET_KEY_RE =
  /^(STARTER_DB_PASSWORD|STARTER_ADMIN_PASSWORD|STARTER_AI_.+|AUTH_OIDC_.+|AUTH_FEISHU_.+|STARTER_S3_.+)$/;
// Characters that never belong in a wizard parameter, even though argv is never shell-parsed.
const UNSAFE_CHARS_RE = /[`$;&<>\\"'\r\n\t\0]|\|\|/;

export class ActionError extends Error {
  constructor(message) {
    super(message);
    this.name = "ActionError";
  }
}

function shq(value) {
  const v = String(value);
  return /^[A-Za-z0-9_\-.:/@=+,]+$/.test(v) ? v : `'${v.replace(/'/g, "'\\''")}'`;
}

function assertKeys(params, allowed) {
  if (params === null || typeof params !== "object" || Array.isArray(params)) {
    throw new ActionError("params 必须是对象");
  }
  const unknown = Object.keys(params).filter((k) => !allowed.includes(k));
  if (unknown.length) throw new ActionError(`不支持的参数: ${unknown.join(", ")}`);
}

function optBool(params, key) {
  const v = params[key];
  if (v === undefined) return false;
  if (typeof v !== "boolean") throw new ActionError(`${key} 必须是布尔值`);
  return v;
}

function optString(params, key, { re, max = 120, message }) {
  const v = params[key];
  if (v === undefined || v === null || v === "") return "";
  if (typeof v !== "string") throw new ActionError(`${key} 必须是字符串`);
  const trimmed = v.trim();
  if (!trimmed) return "";
  if (trimmed.length > max || UNSAFE_CHARS_RE.test(trimmed) || (re && !re.test(trimmed))) {
    throw new ActionError(message);
  }
  return trimmed;
}

function reqString(params, key, rule) {
  const v = optString(params, key, rule);
  if (!v) throw new ActionError(rule.message);
  return v;
}

const TEXT_RE = /^[^\p{Cc}]+$/u;

function bootstrapArgs(params, { dryRun }) {
  assertKeys(params, [
    "slug",
    "title",
    "webPort",
    "noDemos",
    "noExample",
    "noAgent",
    "starterSha",
    "starterRepo",
    "force",
  ]);
  const slug = reqString(params, "slug", {
    re: /^[a-z][a-z0-9-]{1,39}$/,
    max: 40,
    message: "slug 必须以小写字母开头，仅含 a-z、0-9 和连字符（2-40 位）",
  });
  const args = [slug];
  const title = optString(params, "title", { re: TEXT_RE, max: 60, message: "项目名称不合法" });
  if (title) args.push("--title", title);
  if (params.webPort !== undefined && params.webPort !== null && params.webPort !== "") {
    const port = Number(params.webPort);
    if (!Number.isInteger(port) || port < 10000 || port > 65530) {
      throw new ActionError("webPort 必须为 10000-65530 的整数");
    }
    args.push("--web-port", String(port));
  }
  if (optBool(params, "noDemos")) args.push("--no-demos");
  if (optBool(params, "noExample")) args.push("--no-example");
  if (optBool(params, "noAgent")) args.push("--no-agent");
  const sha = optString(params, "starterSha", {
    re: /^[0-9a-f]{7,40}$/,
    max: 40,
    message: "starterSha 必须为 7-40 位小写十六进制",
  });
  if (sha) args.push("--starter-sha", sha);
  const repo = optString(params, "starterRepo", {
    re: /^(https:\/\/[A-Za-z0-9.-]+\/|git@[A-Za-z0-9.-]+:)[A-Za-z0-9._/-]+$/,
    max: 200,
    message: "starterRepo 必须是 https:// 或 git@ 仓库地址",
  });
  if (repo) args.push("--starter-repo", repo);
  if (optBool(params, "force")) args.push("--force");
  if (dryRun) args.push("--dry-run");
  return args;
}

function genModuleArgs(params, { dryRun }) {
  assertKeys(params, ["slug", "label", "singular", "fields"]);
  const slug = reqString(params, "slug", {
    re: /^[a-z][a-z0-9-]{1,28}$/,
    max: 29,
    message: "模块 slug 必须以小写字母开头，仅含 a-z、0-9 和连字符（2-29 位）",
  });
  if (GEN_MODULE_RESERVED.has(slug)) throw new ActionError(`${slug} 是保留标识`);
  const label = reqString(params, "label", {
    re: TEXT_RE,
    max: 40,
    message: "请填写合法的中文模块名",
  });
  const args = ["scripts/gen-module.mjs", slug, "--label", label];
  const singular = optString(params, "singular", {
    re: /^[a-z][a-z0-9_]{1,28}$/,
    max: 29,
    message: "singular 必须为小写英文",
  });
  if (singular) args.push("--singular", singular);
  const fields = optString(params, "fields", {
    re: TEXT_RE,
    max: 2000,
    message: "fields 含不允许的字符",
  });
  if (fields) {
    try {
      parseFieldsSpec(fields);
    } catch (error) {
      throw new ActionError(error instanceof Error ? error.message : String(error));
    }
    args.push("--fields", fields);
  }
  if (dryRun) args.push("--dry-run");
  return args;
}

/**
 * Validates `action` + `params` against the whitelist and returns an argv command. Throws
 * ActionError for anything not explicitly allowed.
 * @returns {{ action: string, bin: string, args: string[], cwd: string, env: Record<string,
 *   string>, display: string, mutates: boolean }}
 */
export function buildActionCommand(action, params = {}, { root = ROOT } = {}) {
  const node = process.execPath;
  const bootstrap = path.join(root, "scripts/bootstrap-project.sh");
  const base = { cwd: root, env: {}, mutates: false };
  const make = (bin, args, display, extra = {}) => ({
    action,
    bin,
    args,
    display,
    ...base,
    ...extra,
  });
  const showBootstrap = (args) => `./scripts/bootstrap-project.sh ${args.map(shq).join(" ")}`;
  const p = params ?? {};
  switch (action) {
    case "bootstrap_dry_run": {
      const args = bootstrapArgs(p, { dryRun: true });
      return make("bash", [bootstrap, ...args], showBootstrap(args));
    }
    case "bootstrap": {
      const args = bootstrapArgs(p, { dryRun: false });
      return make("bash", [bootstrap, ...args], showBootstrap(args), { mutates: true });
    }
    case "local_env":
      assertKeys(p, []);
      return make("bash", [bootstrap, "--local-env"], showBootstrap(["--local-env"]), {
        mutates: true,
      });
    case "gen_module_dry_run": {
      const args = genModuleArgs(p, { dryRun: true });
      return make(node, args, `node ${args.map(shq).join(" ")}`);
    }
    case "gen_module": {
      const args = genModuleArgs(p, { dryRun: false });
      return make(node, args, `node ${args.map(shq).join(" ")}`, { mutates: true });
    }
    case "db_generate": {
      assertKeys(p, ["name"]);
      const name = optString(p, "name", {
        re: /^[a-z0-9_]{1,40}$/,
        max: 40,
        message: "迁移名只能包含小写字母、数字和下划线（1-40 位）",
      });
      const args = ["drizzle-kit", "generate", ...(name ? ["--name", name] : [])];
      return make("bunx", args, `cd packages/db && bunx ${args.join(" ")}`, {
        cwd: path.join(root, "packages/db"),
        env: { DATABASE_URL: process.env.DATABASE_URL || FALLBACK_DATABASE_URL },
        mutates: true,
      });
    }
    case "db_check":
      assertKeys(p, []);
      return make(node, ["scripts/check-migrations.mjs"], "node scripts/check-migrations.mjs");
    case "doctor":
      assertKeys(p, []);
      return make(node, ["scripts/doctor.mjs"], "node scripts/doctor.mjs");
    case "compose_up":
      assertKeys(p, []);
      return make("docker", ["compose", "up", "-d", "--build"], "docker compose up -d --build", {
        mutates: true,
      });
    case "verify_console":
      assertKeys(p, []);
      return make("python3", ["scripts/verify-console.py"], "python3 scripts/verify-console.py");
    default:
      throw new ActionError(`不支持的操作: ${String(action)}`);
  }
}

// ---------------------------------------------------------------------------
// Repository status (read-only, secret-free)
// ---------------------------------------------------------------------------
function git(root, args) {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf-8" });
  return !r.error && r.status === 0 ? r.stdout.trim() : null;
}

/** Drops credentials embedded in remote URLs (https://user:token@host/...). */
function redactUrl(url) {
  return url ? url.replace(/^(https?:\/\/)[^@/]+@/, "$1") : url;
}

function listModules(root) {
  const dir = path.join(root, "apps/server/src/modules");
  if (!existsSync(dir)) return [];
  const names = readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith(".d.ts"))
    .map((f) => f.slice(0, -3));
  const set = new Set(names);
  return names
    .filter((n) => !CORE_MODULES.has(n))
    .filter((n) => ![...set].some((other) => other !== n && n.startsWith(`${other}-`)))
    .sort();
}

export async function collectStatus(root = ROOT) {
  let repoName = path.basename(root);
  try {
    repoName = JSON.parse(readFileSync(path.join(root, "package.json"), "utf-8")).name || repoName;
  } catch {
    // keep directory name
  }
  const versionMeta = readEnvFile(path.join(root, ".starter-version"));
  const starterVersion = versionMeta
    ? Object.fromEntries(
        ["STARTER_REPO", "STARTER_COMMIT", "STARTER_BOOTSTRAPPED_AT", "STARTER_SLUG"].map((k) => [
          k,
          k === "STARTER_REPO"
            ? redactUrl(versionMeta.get(k) ?? null)
            : (versionMeta.get(k) ?? null),
        ]),
      )
    : null;

  const originUrl = redactUrl(git(root, ["remote", "get-url", "origin"]));
  const headSha = git(root, ["rev-parse", "HEAD"]);
  const count = Number(git(root, ["rev-list", "--count", "HEAD"]));
  const porcelain = git(root, ["status", "--porcelain"]);
  const hasStarterRemote = git(root, ["remote", "get-url", "starter"]) !== null;
  const hasStarterRef =
    git(root, ["rev-parse", "--verify", "--quiet", "refs/remotes/starter/main"]) !== null;
  const baseline = starterVersion?.STARTER_COMMIT;
  const behind =
    baseline && hasStarterRef
      ? Number(git(root, ["rev-list", "--count", `${baseline}..starter/main`]))
      : Number.NaN;

  const env = readEnvFile(path.join(root, ".env"));
  return {
    ok: true,
    mode: "live",
    repoName,
    bootstrapped: Boolean(versionMeta),
    starterVersion,
    git: {
      originUrl: originUrl ?? null,
      isTemplateOrigin: Boolean(originUrl?.includes("optimax-starter")),
      headSha: headSha ?? null,
      headShort: headSha ? headSha.slice(0, 7) : null,
      commitCount: Number.isFinite(count) ? count : 0,
      branch: git(root, ["rev-parse", "--abbrev-ref", "HEAD"]),
      dirtyCount: porcelain ? porcelain.split(/\r?\n/).filter(Boolean).length : 0,
      hasStarterRemote,
      behindStarterCount: Number.isFinite(behind) ? behind : null,
    },
    exampleAssetsPresent: existsSync(path.join(root, "apps/server/src/modules/assets.ts")),
    existingModules: listModules(root),
    suggestedWebPort: await findFreePortPair(),
    envMeta: {
      exists: Boolean(env),
      webPort: env?.get("WEB_PORT") || null,
      apiPort: env?.get("API_PORT") || null,
      corsOrigin: env?.get("CORS_ORIGIN") || null,
      sessionCookieName: env?.get("SESSION_COOKIE_NAME") || null,
    },
    doctor: await runDoctorChecks(),
  };
}

/** Secret values from .env, used only to redact streamed output. */
function secretValues(root) {
  const env = readEnvFile(path.join(root, ".env"));
  if (!env) return [];
  return [...env.entries()]
    .filter(([k, v]) => SECRET_KEY_RE.test(k) && v && v.length >= 4)
    .map(([, v]) => v);
}

function redact(text, secrets) {
  let out = text;
  for (const s of secrets) out = out.split(s).join("<redacted>");
  return out;
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------
function sameSecret(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

function json(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(body));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new ActionError("请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const text = Buffer.concat(chunks).toString("utf-8");
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(new ActionError("请求体不是合法 JSON"));
      }
    });
    req.on("error", reject);
  });
}

const PAGE_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

// Read-only actions may be stopped when the page disconnects; writers always run to completion.
const STOP_ON_DISCONNECT = new Set([
  "bootstrap_dry_run",
  "gen_module_dry_run",
  "db_check",
  "doctor",
  "verify_console",
]);

/**
 * @param {{ port?: number, noOpen?: boolean, root?: string,
 *   log?: (line: string) => void }} [options]
 */
export function startSetupServer({ port = 0, noOpen = true, root = ROOT, log = () => {} } = {}) {
  const token = randomBytes(32).toString("hex");
  let actualPort = 0;
  let running = null;
  const origin = () => `http://127.0.0.1:${actualPort}`;

  const server = http.createServer(async (req, res) => {
    try {
      const host = req.headers.host ?? "";
      if (host !== `127.0.0.1:${actualPort}` && host !== `localhost:${actualPort}`) {
        return json(res, 403, { ok: false, error: "Host 不被允许" });
      }
      const url = new URL(req.url ?? "/", origin());

      if (req.method === "GET" && url.pathname === "/") {
        if (!sameSecret(url.searchParams.get("token") ?? "", token)) {
          res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
          return res.end("403 令牌无效：请使用 bun run setup 打印的链接");
        }
        const html = readFileSync(path.join(root, "docs/onboarding.html"), "utf-8");
        const bridge = JSON.stringify({ token, baseUrl: origin() }).replace(/</g, "\\u003c");
        const injected = html.replace(
          "</head>",
          `<script>window.__SETUP_BRIDGE__ = ${bridge};</script>\n</head>`,
        );
        res.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
          "Referrer-Policy": "no-referrer",
          "X-Frame-Options": "DENY",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": PAGE_CSP,
        });
        return res.end(injected);
      }

      if (!url.pathname.startsWith("/api/")) {
        return json(res, 404, { ok: false, error: "Not found" });
      }
      if (!sameSecret(req.headers["x-setup-token"] ?? "", token)) {
        return json(res, 403, { ok: false, error: "令牌无效" });
      }
      if (req.method === "POST" && req.headers.origin !== origin()) {
        return json(res, 403, { ok: false, error: "请求来源无效" });
      }

      if (req.method === "GET" && url.pathname === "/api/status") {
        return json(res, 200, await collectStatus(root));
      }

      if (req.method === "POST" && url.pathname === "/api/shutdown") {
        json(res, 200, { ok: true });
        setImmediate(() => void close());
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/run") {
        let body;
        try {
          body = await readJsonBody(req);
          if (body === null || typeof body !== "object" || Array.isArray(body)) {
            throw new ActionError("请求体必须是对象");
          }
          assertKeys(body, ["action", "params"]);
        } catch (error) {
          return json(res, 400, { ok: false, error: error.message });
        }
        let command;
        try {
          command = buildActionCommand(body.action, body.params ?? {}, { root });
        } catch (error) {
          if (error instanceof ActionError) {
            return json(res, 400, { ok: false, error: error.message });
          }
          throw error;
        }
        if (running) {
          return json(res, 409, { ok: false, error: `已有命令在运行: ${running.display}` });
        }
        return runCommand(command, res);
      }

      return json(res, 404, { ok: false, error: "Not found" });
    } catch (error) {
      log(`setup-server error: ${error instanceof Error ? error.name : "Error"}`);
      if (!res.headersSent) json(res, 500, { ok: false, error: "内部错误" });
      else res.end();
    }
  });

  function runCommand(command, res) {
    running = command;
    const secrets = secretValues(root);
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      Connection: "keep-alive",
    });
    const send = (event, data) => {
      if (res.writableEnded || res.destroyed) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    send("start", { cmd: command.display });
    log(`run: ${command.display}`);

    let finished = false;
    const child = spawn(command.bin, command.args, {
      cwd: command.cwd,
      shell: false,
      env: { ...process.env, ...command.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const finish = (exitCode, signal) => {
      if (finished) return;
      finished = true;
      running = null;
      send("done", { exitCode, signal: signal ?? null });
      if (!res.writableEnded) res.end();
    };
    for (const stream of ["stdout", "stderr"]) {
      child[stream].setEncoding("utf8");
      child[stream].on("data", (chunk) => send("log", { stream, chunk: redact(chunk, secrets) }));
    }
    child.on("error", (error) => {
      const reason = error.code ?? error.message;
      send("log", { stream: "stderr", chunk: `无法启动 ${command.bin}: ${reason}\n` });
      finish(127, null);
    });
    child.on("close", (code, signal) => finish(code, signal));

    // Never use req.on("close"): it fires once the request body is consumed.
    res.on("close", () => {
      if (!res.writableEnded && !finished && STOP_ON_DISCONNECT.has(command.action)) {
        child.kill("SIGTERM");
      }
    });
  }

  let closing = null;
  function close() {
    if (!closing) {
      closing = new Promise((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      });
    }
    return closing;
  }

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      actualPort = server.address().port;
      const url = `${origin()}/?token=${token}`;
      if (!noOpen) openBrowser(url);
      resolve({ server, port: actualPort, token, url, close });
    });
  });
}

function openBrowser(url) {
  const bins = { darwin: "open", linux: "xdg-open" };
  const bin = bins[process.platform] ?? null;
  if (!bin) return;
  try {
    const child = spawn(bin, [url], { detached: true, stdio: "ignore", shell: false });
    child.on("error", () => undefined);
    child.unref();
  } catch {
    // The URL is always printed; opening the browser is best effort.
  }
}

function usage() {
  console.log(`用法:
  bun run setup [-- --port <number>] [-- --no-open]
  node scripts/setup-server.mjs [--port <number>] [--no-open]

选项:
  --port <number>  监听 127.0.0.1 的端口（默认 0，由系统分配）
  --no-open        不自动打开浏览器（始终打印带令牌的访问链接）
  -h, --help       显示本帮助

只监听 127.0.0.1；每次启动生成新令牌。只能执行初始化、模块生成、迁移、自查、
本地 Docker 启动与接口验收等白名单命令，不执行生产部署、git commit 或 push。`);
}

const isMain = path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url);

if (isMain) {
  const args = process.argv.slice(2);
  let port = 0;
  let noOpen = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    } else if (arg === "--no-open") {
      noOpen = true;
    } else if (arg === "--port") {
      port = Number(args[++i]);
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        console.error("错误: --port 必须为 0-65535 的整数");
        process.exit(1);
      }
    } else {
      console.error(`未知参数: ${arg}`);
      usage();
      process.exit(1);
    }
  }
  const handle = await startSetupServer({ port, noOpen, log: (line) => console.log(line) });
  console.log("OptiMax Starter 初始化工作台已启动（仅本机可访问）:");
  console.log(`  ${handle.url}`);
  console.log("按 Ctrl+C 或在页面点击「关闭向导」退出。");
  const stop = () => {
    void handle.close().then(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  handle.server.on("close", () => {
    console.log("初始化工作台已关闭。");
  });
}
