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
  "apps/web/src/routes/assets.tsx",
  "apps/web/src/features/assets/",
];

export const MARKED_FILES = [
  "packages/db/src/schema/index.ts",
  "packages/api/src/index.ts",
  "packages/api/src/permissions.ts",
  "apps/server/src/console.ts",
  "apps/web/src/config/app-config.ts",
  "apps/web/src/features/dashboard/registry.ts",
];

const NAV_DEMO = "apps/web/src/features/navigation-demo/NavigationDemoPage.tsx";

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

const NAV_DEMO_FETCH = '      const assets = await request<Asset[]>("/assets");';
const NAV_DEMO_IMPORT = 'import { request, type Asset } from "@/console-client";';
const NAV_DEMO_ANCHOR = "function AssetViewTable(";
const NAV_DEMO_SAMPLE = `// Local sample rows: the example assets API was removed by --no-example.
const SAMPLE_ASSETS: Asset[] = [
  { id: 1, name: "采购门户", domain: "采购", owner: "业务运营组", stage: "已登记" },
  { id: 2, name: "库存服务", domain: "履约", owner: "交付组", stage: "待复核" },
  { id: 3, name: "订单中心", domain: "运营", owner: "平台组", stage: "已登记" },
  { id: 4, name: "供应商门户", domain: "采购", owner: "业务运营组", stage: "已登记" },
  { id: 5, name: "合同服务", domain: "履约", owner: "交付组", stage: "待复核" },
  { id: 6, name: "仓储平台", domain: "运营", owner: "平台组", stage: "已登记" },
];

`;

function rewriteNavigationDemo(content) {
  if (!content.includes(NAV_DEMO_FETCH)) return null;
  let next = content.replace(NAV_DEMO_FETCH, "      const assets = SAMPLE_ASSETS;");
  next = next.replace(NAV_DEMO_IMPORT, 'import type { Asset } from "@/console-client";');
  if (!next.includes(NAV_DEMO_ANCHOR)) {
    throw new Error(`${NAV_DEMO} 缺少 ${NAV_DEMO_ANCHOR}，无法写入本地示例数据`);
  }
  return next.replace(NAV_DEMO_ANCHOR, NAV_DEMO_SAMPLE + NAV_DEMO_ANCHOR);
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
  if (existsSync(abs(NAV_DEMO))) {
    const next = rewriteNavigationDemo(readFileSync(abs(NAV_DEMO), "utf-8"));
    if (next) plannedEdits.push({ rel: NAV_DEMO, content: next, note: "/assets 查询改为本地示例数据" });
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
    console.error(`未知参数: ${unknown.join(" ")}\n用法: node scripts/lib/strip-example.mjs [--dry-run]`);
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
