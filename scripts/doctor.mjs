#!/usr/bin/env node
// Read-only local environment doctor. Never fixes anything, never prints secret values, and does
// not replace `./scripts/deploy-production.sh --check` (production precheck).
// `runDoctorChecks()` is shared with scripts/setup-server.mjs; the CLI only formats its result.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkMigrations } from "./check-migrations.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sh(cmd, args, options = {}) {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: "utf-8", ...options });
  return { ok: !r.error && r.status === 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** Parses KEY=VALUE lines; values are only used for presence/port checks and never printed. */
export function readEnvFile(file) {
  const out = new Map();
  if (!existsSync(file)) return null;
  for (const raw of readFileSync(file, "utf-8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    out.set(key, value);
  }
  return out;
}

export function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const done = (used) => {
      socket.destroy();
      resolve(used);
    };
    socket.setTimeout(800, () => done(false));
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
  });
}

/** First adjacent free pair (port, port + 1) on 127.0.0.1, scanning in steps of 10; or null. */
export async function findFreePortPair(start = 38150, end = 38990) {
  for (let port = start; port < end; port += 10) {
    if (!(await portInUse(port)) && !(await portInUse(port + 1))) return port;
  }
  return null;
}

/** Host ports published by this project's compose containers (empty when unavailable). */
function composePublishedPorts() {
  const r = sh("docker", ["compose", "ps", "--format", "json"]);
  const ports = new Set();
  if (!r.ok) return ports;
  const text = r.stdout.trim();
  let rows = [];
  try {
    rows = text.startsWith("[")
      ? JSON.parse(text)
      : text
          .split(/\r?\n/)
          .filter(Boolean)
          .map((l) => JSON.parse(l));
  } catch {
    return ports;
  }
  for (const row of rows) {
    for (const pub of row?.Publishers ?? []) {
      if (pub?.PublishedPort) ports.add(Number(pub.PublishedPort));
    }
  }
  return ports;
}

/**
 * Runs the 5 read-only checks. `detail` / `fix` never contain secret values.
 * @returns {Promise<{ checks: Array<{ id: string, status: string, title: string,
 *   detail: string, fix: string[], note?: string }>, failedCount: number }>}
 */
export async function runDoctorChecks() {
  const checks = [];
  const add = (id, status, title, detail, fix, note) => {
    const entry = { id, status, title, detail: detail ?? "", fix: fix ? [].concat(fix) : [] };
    if (note) entry.note = note;
    checks.push(entry);
  };

  // 1) Docker CLI, compose plugin and daemon
  let dockerReady = false;
  const cli = sh("docker", ["--version"]);
  const compose = cli.ok ? sh("docker", ["compose", "version"]) : { ok: false };
  const daemon = compose.ok
    ? sh("docker", ["info", "--format", "{{.ServerVersion}}"])
    : { ok: false, stdout: "" };
  if (!cli.ok) {
    add("docker", "FAIL", "Docker", "未找到 docker 命令", "安装 Docker Desktop 或 Docker Engine 后重试");
  } else if (!compose.ok) {
    add("docker", "FAIL", "Docker", "缺少 docker compose 插件", "安装 Docker Compose v2 插件");
  } else if (!daemon.ok) {
    add("docker", "FAIL", "Docker", "无法连接 Docker 守护进程", [
      "启动 Docker Desktop，或执行 sudo systemctl start docker",
    ]);
  } else {
    dockerReady = true;
    const server = daemon.stdout.trim();
    add("docker", "PASS", "Docker", `CLI、compose 与守护进程可用（Server ${server}）`);
  }

  // 2) WEB_PORT / API_PORT
  const env = readEnvFile(path.join(ROOT, ".env"));
  const ports = [
    ["port_web", "WEB_PORT", Number(env?.get("WEB_PORT") || 38140)],
    ["port_api", "API_PORT", Number(env?.get("API_PORT") || 38141)],
  ];
  const owned = dockerReady ? composePublishedPorts() : new Set();
  for (const [id, key, port] of ports) {
    const title = `端口 ${key}`;
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      add(id, "FAIL", title, ".env 中的值不是有效端口", `修正 .env 的 ${key}，例如 ${key}=38150`);
    } else if (!(await portInUse(port))) {
      add(id, "PASS", title, `127.0.0.1:${port} 空闲`);
    } else if (owned.has(port)) {
      add(id, "PASS", title, `127.0.0.1:${port} 由本项目 compose 容器占用`);
    } else {
      add(id, "FAIL", title, `127.0.0.1:${port} 被未知外部进程占用`, [
        `查看占用者: lsof -nP -iTCP:${port} -sTCP:LISTEN`,
        `或在 .env 中改用其他端口（WEB_PORT 与 API_PORT 相邻），同时更新 CORS_ORIGIN`,
      ]);
    }
  }

  // 3) .env required keys
  const required = ["STARTER_DB_PASSWORD", "STARTER_ADMIN_PASSWORD"];
  if (existsSync(path.join(ROOT, ".starter-version"))) {
    required.push("WEB_PORT", "API_PORT", "CORS_ORIGIN", "SESSION_COOKIE_NAME");
  }
  if (!env) {
    add("env", "FAIL", ".env", "文件不存在", [
      "运行 ./scripts/bootstrap-project.sh --local-env（派生项目先运行初始化）",
    ]);
  } else {
    const missing = required.filter((key) => !env.get(key));
    if (missing.length) {
      add("env", "FAIL", ".env", `缺少或为空: ${missing.join(", ")}`, [
        "运行 ./scripts/bootstrap-project.sh --local-env 补齐本地密码",
        "端口、CORS_ORIGIN、SESSION_COOKIE_NAME 参照 .env.example 手工补齐",
      ]);
    } else {
      add("env", "PASS", ".env", `必需键均已设置（${required.length} 项，值已隐藏）`);
    }
  }

  // 4) Migration drift
  const migration = checkMigrations();
  if (migration.ok) {
    add("migrations", "PASS", "迁移漂移", "schema 与 packages/db/src/migrations/ 一致");
  } else if (migration.reason === "pending") {
    add("migrations", "FAIL", "迁移漂移", "schema 有未生成迁移的变更", [
      "bun run db:generate，检查 SQL 后提交 packages/db/src/migrations/",
      "再运行 bun run db:check",
    ]);
  } else if (migration.reason === "tool_missing") {
    add("migrations", "FAIL", "迁移漂移", migration.detail, "安装 bun 1.3.14 后执行 bun install");
  } else {
    add("migrations", "FAIL", "迁移漂移", "drizzle-kit 检查失败", "运行 bun run db:check 查看完整输出");
  }

  // 5) Upstream lag (informational, never fails offline)
  const meta = readEnvFile(path.join(ROOT, ".starter-version"));
  const commit = meta?.get("STARTER_COMMIT");
  const hasRef = sh("git", ["rev-parse", "--verify", "--quiet", "refs/remotes/starter/main"]).ok;
  if (!meta || !commit) {
    add("upstream", "INFO", "上游差距", "未找到 .starter-version（模板仓库本身或尚未初始化）");
  } else if (!hasRef) {
    add(
      "upstream",
      "INFO",
      "上游差距",
      "本地没有 starter/main，跳过",
      [
        "git remote add starter https://github.com/wherexml/optimax-starter.git",
        "git fetch starter，然后重新运行 bun run doctor",
      ],
      "以上命令需联网，离线时可忽略本项",
    );
  } else {
    const count = sh("git", ["rev-list", "--count", `${commit}..starter/main`]);
    if (count.ok) {
      const n = Number(count.stdout.trim());
      const fix = "按 docs/UPGRADE.md 选择性同步";
      add("upstream", n > 0 ? "WARN" : "PASS", "上游差距", `落后 starter/main ${n} 个提交`, fix);
    } else {
      const short = commit.slice(0, 12);
      add("upstream", "WARN", "上游差距", `本地找不到 STARTER_COMMIT ${short}`, [
        "git fetch starter 后重试",
      ]);
    }
  }

  return { checks, failedCount: checks.filter((c) => c.status === "FAIL").length };
}

const isMain = path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url);

if (isMain) {
  const { checks, failedCount } = await runDoctorChecks();
  for (const check of checks) {
    const { status, title, detail, fix, note } = check;
    console.log(`${status.padEnd(4)}  ${title}${detail ? `：${detail}` : ""}`);
    if (fix.length && status !== "PASS") {
      for (const line of fix) console.log(`      修复: ${line}`);
    }
    if (note) console.log(`      提示: ${note}`);
  }
  console.log("");
  if (failedCount) {
    console.log(`doctor: ${failedCount} 项 FAIL，请按上方修复命令处理后重新运行 bun run doctor`);
    process.exit(1);
  }
  console.log("doctor: 全部必需检查通过");
}
