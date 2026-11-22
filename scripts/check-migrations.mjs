#!/usr/bin/env node
// Read-only migration drift gate: fails when packages/db/src/schema has changes that are not yet
// captured by a committed migration under packages/db/src/migrations/. Never writes migration
// files and never connects to a live database (the URL only satisfies drizzle.config.ts).
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB_DIR = path.join(ROOT, "packages/db");
const FALLBACK_DATABASE_URL = "postgres://starter:ci@127.0.0.1:5432/starter";

function run(args) {
  const result = spawnSync("bunx", args, {
    cwd: DB_DIR,
    encoding: "utf-8",
    env: {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL || FALLBACK_DATABASE_URL,
    },
  });
  return {
    status: result.status,
    error: result.error,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** Parses every JSON object line printed by `drizzle-kit generate --explain --output json`. */
export function parseJsonLines(stdout) {
  const out = [];
  for (const line of String(stdout).split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      out.push(JSON.parse(trimmed));
    } catch {
      // Not a JSON line (progress output); ignore.
    }
  }
  return out;
}

function tail(text, lines = 20) {
  return String(text).trim().split(/\r?\n/).slice(-lines).join("\n");
}

/**
 * @typedef {"no_changes" | "pending" | "check_failed" | "tool_missing" | "unparsed"} Reason
 * @returns {{ ok: boolean, reason: Reason, detail: string }}
 */
export function checkMigrations() {
  const check = run(["drizzle-kit", "check"]);
  if (check.error) {
    return {
      ok: false,
      reason: "tool_missing",
      detail: `无法执行 bunx（${check.error.code ?? check.error.message}），请先安装 bun 并运行 bun install`,
    };
  }
  if (check.status !== 0) {
    return {
      ok: false,
      reason: "check_failed",
      detail: tail(`${check.stdout}\n${check.stderr}`),
    };
  }

  const explain = run(["drizzle-kit", "generate", "--explain", "--output", "json"]);
  if (explain.error || explain.status !== 0) {
    return {
      ok: false,
      reason: "check_failed",
      detail: tail(`${explain.stdout}\n${explain.stderr}`) || String(explain.error?.message ?? ""),
    };
  }
  const records = parseJsonLines(explain.stdout);
  if (!records.length) {
    return { ok: false, reason: "unparsed", detail: tail(explain.stdout || explain.stderr) };
  }
  if (records.some((r) => r?.status === "no_changes")) {
    return { ok: true, reason: "no_changes", detail: "schema 与已提交迁移一致" };
  }
  return {
    ok: false,
    reason: "pending",
    detail: records.map((r) => JSON.stringify(r, null, 2)).join("\n"),
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const result = checkMigrations();
  if (result.ok) {
    console.log("PASS db:check：schema 与 packages/db/src/migrations/ 一致，无待生成迁移");
    process.exit(0);
  }
  if (result.reason === "pending") {
    console.error("FAIL db:check：检测到 schema 变更尚未生成迁移 SQL。待生成摘要：");
    console.error(result.detail);
    console.error("");
    console.error("修复：运行 bun run db:generate，检查生成的 SQL 后提交 packages/db/src/migrations/，");
    console.error("      再运行 bun run db:check 确认通过。");
  } else if (result.reason === "check_failed") {
    console.error("FAIL db:check：drizzle-kit check 报告迁移目录不一致（可能存在冲突或被手改的快照）：");
    console.error(result.detail);
    console.error("修复：按提示修正 packages/db/src/migrations/ 后重新运行 bun run db:check。");
  } else if (result.reason === "tool_missing") {
    console.error(`FAIL db:check：${result.detail}`);
  } else {
    console.error("FAIL db:check：无法解析 drizzle-kit generate --explain 的 JSON 输出：");
    console.error(result.detail);
  }
  process.exit(1);
}
