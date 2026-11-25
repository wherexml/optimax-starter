#!/usr/bin/env node
// Removes the example "assets" business module from a derived project.
// Usage: node scripts/lib/strip-example.mjs [--dry-run]
// Invoked by `./scripts/bootstrap-project.sh --no-example`. After a real run, generate the
// matching migration (`drizzle-kit generate --name remove_example_assets`) so db:check passes.
import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export const EXAMPLE_PATHS = [
  "packages/db/src/schema/assets.ts",
  "packages/api/src/asset-agent.ts",
  "apps/server/src/asset-agent.ts",
  "apps/server/src/modules/assets.ts",
  "apps/server/src/modules/assets-jobs.ts",
  "apps/server/src/modules/assets-policy.ts",
  "apps/server/src/modules/assets-policy.test.ts",
  "apps/server/src/modules/assets-query.ts",
  "apps/server/src/modules/assets-topology.ts",
  "apps/server/src/modules/assets-topology.test.ts",
  "apps/web/src/routes/assets.tsx",
  "apps/web/src/routes/assets_.$assetId.tsx",
  "apps/web/src/features/assets/",
  // Optional: absent when --no-agent already removed apps/server/src/agent/.
  "apps/server/src/agent/example-assets-tools.ts",
];

export const MARKED_FILES = [
  "packages/db/src/schema/index.ts",
  "packages/api/src/index.ts",
  "packages/api/src/permissions.ts",
  "apps/server/src/console.ts",
  "apps/web/src/config/app-config.ts",
  "apps/web/src/features/dashboard/registry.ts",
];

/** Stripped only when present (the assistant module may already be removed by --no-agent). */
export const OPTIONAL_MARKED_FILES = [
  "apps/server/src/agent/registry.ts",
  "apps/server/src/agent/routes.ts",
  "apps/web/src/features/assistant/ToolSteps.tsx",
  "apps/web/src/features/assistant/Composer.tsx",
  "apps/web/src/features/assistant/Conversation.tsx",
  "apps/web/src/features/assistant/assistant-links-utils.ts",
];

const BLOCK_RE = new RegExp(
  [
    "^[ \\t]*// @starter:example-assets-start[ \\t]*\\r?\\n",
    "[\\s\\S]*?",
    "^[ \\t]*// @starter:example-assets-end[ \\t]*\\r?\\n",
  ].join(""),
  "gm",
);

/** Removes every example-assets block; throws when a file has none or leaves a dangling marker. */
export function removeExampleBlocks(content, fileLabel) {
  const matches = content.match(BLOCK_RE) ?? [];
  if (!matches.length) {
    throw new Error(`${fileLabel} 中未找到 // @starter:example-assets-start ... end 示例块`);
  }
  const next = content.replace(BLOCK_RE, "");
  if (next.includes("@starter:example-assets-")) {
    throw new Error(`${fileLabel} 中示例块标记不成对，请手工检查`);
  }
  return { content: next, blocks: matches.length };
}

/**
 * @param {{ root?: string, dryRun?: boolean, log?: (line: string) => void }} [options]
 * @returns {{ deleted: string[], edited: string[] }}
 */
export function stripExample({ root = DEFAULT_ROOT, dryRun = false, log = console.log } = {}) {
  const abs = (rel) => path.join(root, rel);
  const plannedEdits = [];

  // Validate every edit before touching the tree so a failure never leaves a half-stripped repo.
  for (const rel of MARKED_FILES) {
    if (!existsSync(abs(rel))) throw new Error(`中心文件不存在: ${rel}`);
    const { content, blocks } = removeExampleBlocks(readFileSync(abs(rel), "utf-8"), rel);
    plannedEdits.push({ rel, content, note: `移除 ${blocks} 个示例块` });
  }
  for (const rel of OPTIONAL_MARKED_FILES) {
    if (!existsSync(abs(rel))) continue;
    const raw = readFileSync(abs(rel), "utf-8");
    if (!raw.includes("@starter:example-assets-")) continue;
    const { content, blocks } = removeExampleBlocks(raw, rel);
    plannedEdits.push({ rel, content, note: `移除 ${blocks} 个示例块` });
  }

  const deleted = EXAMPLE_PATHS.filter((rel) => existsSync(abs(rel)));
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
      `未知参数: ${unknown.join(" ")}\n用法: node scripts/lib/strip-example.mjs [--dry-run]`,
    );
    process.exit(1);
  }
  try {
    const dryRun = args.includes("--dry-run");
    stripExample({ dryRun });
    console.log(dryRun ? "Dry-run 完成，未修改任何文件。" : "已移除示例 assets 模块。");
  } catch (error) {
    console.error(`错误: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
