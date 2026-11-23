#!/usr/bin/env node
// Removes the optional AI assistant (packages/agent, server agent module, web assistant panel).
// Usage: node scripts/lib/strip-agent.mjs [--dry-run]
// Invoked by `./scripts/bootstrap-project.sh --no-agent`. The assistant adds no tables, so no
// migration is needed. Works before or after strip-example.mjs (--no-example).
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const AGENT_PATHS = [
  "packages/agent/",
  "packages/api/src/agent.ts",
  "apps/server/src/agent/",
  "apps/web/src/features/assistant/",
];

/** Must exist and contain at least one agent block. */
export const AGENT_MARKED_FILES = [
  "packages/api/src/index.ts",
  "packages/api/src/contracts.ts",
  "packages/api/src/permissions.ts",
  "apps/server/src/console.ts",
  "apps/server/src/core/bearer.ts",
  "apps/server/.env.schema",
  "apps/web/src/routes/__root.tsx",
  "apps/web/src/features/system/SystemPage.tsx",
  "Dockerfile",
  "Dockerfile.prod",
  "compose.yaml",
  "compose.override.yaml",
];

/** Stripped only when present (AssetsPage is gone after --no-example). */
export const AGENT_OPTIONAL_MARKED_FILES = ["apps/web/src/features/assets/AssetsPage.tsx"];

export const AGENT_DEPENDENCIES = {
  "package.json": {
    "workspaces.catalog": [
      "ai",
      "@ai-sdk/openai-compatible",
      "@ai-sdk/anthropic",
      "@ai-sdk/react",
      "jsonrepair",
      "@opentelemetry/api",
      "undici",
    ],
  },
  "apps/server/package.json": { dependencies: ["@optimax-starter/agent"] },
  "apps/web/package.json": {
    dependencies: ["@optimax-starter/agent", "react-markdown", "remark-gfm"],
  },
};

// `// @starter:agent-start`, JSX `{/* @starter:agent-start */}`, `# @starter:agent-start` and
// `# [starter:agent-start]` (.env.schema, where Varlock would parse `# @...` as a decorator).
// A block may open with one comment style and close with another (JSX wrapper elements).
const marker = (edge) =>
  String.raw`(?://|#|\{/\*)[ \t]*(?:@starter:agent-${edge}|\[starter:agent-${edge}\])(?:[ \t]*\*/\})?`;
const START = marker("start");
const END = marker("end");
const BLOCK_RE = new RegExp(
  `^[ \\t]*${START}[ \\t]*\\r?\\n[\\s\\S]*?^[ \\t]*${END}[ \\t]*(?:\\r?\\n|$)`,
  "gm",
);
const ANY_MARKER_RE = /@starter:agent-(?:start|end)|\[starter:agent-(?:start|end)\]/;

/** Removes every agent block; throws when a required file has none or a marker is left dangling. */
export function removeAgentBlocks(content, fileLabel, { optional = false } = {}) {
  const matches = content.match(BLOCK_RE) ?? [];
  if (!matches.length) {
    if (optional && !ANY_MARKER_RE.test(content)) return { content, blocks: 0 };
    throw new Error(`${fileLabel} 中未找到 @starter:agent-start ... end 助理块`);
  }
  const next = content.replace(BLOCK_RE, "");
  if (ANY_MARKER_RE.test(next)) {
    throw new Error(`${fileLabel} 中助理块标记不成对，请手工检查`);
  }
  return { content: next, blocks: matches.length };
}

function stripDependencies(rel, raw, spec) {
  const pkg = JSON.parse(raw);
  const removed = [];
  for (const [field, names] of Object.entries(spec)) {
    const holder = field.split(".").reduce((node, key) => node?.[key], pkg);
    if (!holder || typeof holder !== "object") continue;
    for (const name of names) {
      if (Object.hasOwn(holder, name)) {
        delete holder[name];
        removed.push(name);
      }
    }
  }
  if (!removed.length) return null;
  return {
    rel,
    content: `${JSON.stringify(pkg, null, 2)}\n`,
    note: `移除依赖 ${removed.join(", ")}`,
  };
}

/**
 * @param {{ root?: string, dryRun?: boolean, log?: (line: string) => void }} [options]
 * @returns {{ deleted: string[], edited: string[] }}
 */
export function stripAgent({ root = DEFAULT_ROOT, dryRun = false, log = console.log } = {}) {
  const abs = (rel) => path.join(root, rel);
  const plannedEdits = [];

  // Validate every edit before touching the tree so a failure never leaves a half-stripped repo.
  for (const rel of AGENT_MARKED_FILES) {
    if (!existsSync(abs(rel))) throw new Error(`中心文件不存在: ${rel}`);
    const { content, blocks } = removeAgentBlocks(readFileSync(abs(rel), "utf-8"), rel);
    plannedEdits.push({ rel, content, note: `移除 ${blocks} 个助理块` });
  }
  for (const rel of AGENT_OPTIONAL_MARKED_FILES) {
    if (!existsSync(abs(rel))) continue;
    const { content, blocks } = removeAgentBlocks(readFileSync(abs(rel), "utf-8"), rel, {
      optional: true,
    });
    if (blocks) plannedEdits.push({ rel, content, note: `移除 ${blocks} 个助理块` });
  }
  for (const [rel, spec] of Object.entries(AGENT_DEPENDENCIES)) {
    if (!existsSync(abs(rel))) continue;
    const edit = stripDependencies(rel, readFileSync(abs(rel), "utf-8"), spec);
    if (edit) plannedEdits.push(edit);
  }

  const deleted = AGENT_PATHS.filter((rel) => existsSync(abs(rel)));
  const prefix = dryRun ? "[dry-run] " : "";
  for (const rel of deleted) log(`${prefix}- ${rel}`);
  for (const edit of plannedEdits) log(`${prefix}~ ${edit.rel}（${edit.note}）`);
  if (dryRun) return { deleted, edited: plannedEdits.map((e) => e.rel) };

  for (const rel of deleted) {
    const target = abs(rel);
    rmSync(target, { recursive: statSync(target).isDirectory(), force: true });
  }
  for (const edit of plannedEdits) writeFileSync(abs(edit.rel), edit.content, "utf-8");
  return { deleted, edited: plannedEdits.map((e) => e.rel) };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a !== "--dry-run");
  if (unknown.length) {
    console.error(
      `未知参数: ${unknown.join(" ")}\n用法: node scripts/lib/strip-agent.mjs [--dry-run]`,
    );
    process.exit(1);
  }
  try {
    const dryRun = args.includes("--dry-run");
    stripAgent({ dryRun });
    console.log(dryRun ? "Dry-run 完成，未修改任何文件。" : "已移除 AI 智能助理。");
  } catch (error) {
    console.error(`错误: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
