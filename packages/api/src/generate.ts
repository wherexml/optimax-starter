// 契约产物生成器（LARAVEL.md LA-02）。
// 运行：bun run contracts:generate（根脚本）。产物在 packages/api/json-schema/，
// 必须显式生成并提交（postinstall 不自动执行），CI 门禁拦截过期产物（LA-04）。
// 输出确定性：不含时间戳，二次执行必须零 diff；产物版本以 git 历史为准。
// 扩展约定：新增公开 schema 时在本文件 registry 登记，并重新生成产物提交。

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import * as assetAgent from "./asset-agent";
import * as contracts from "./contracts";
import * as permissions from "./permissions";
import { CONTRACT_REFINES } from "./refines";
import * as system from "./system";

type Entry = { module: string; name: string; schema: z.ZodType };

/**
 * 输入模式（io:"input"）：非 strict 对象不生成 additionalProperties:false——zod 对未知键是
 * 剥离而非拒绝，输出模式会引入 PHP 拒绝 / Zod 通过的行为分叉（LB-03 对拍发现）。
 * 响应实体与分页/搜索形状保持默认输出模式。
 */
const INPUT_SCHEMAS = new Set([
  "contracts.credentialsSchema",
  "contracts.accountCreateSchema",
  "contracts.accountPatchSchema",
  "contracts.passwordResetSchema",
  "contracts.profileInputSchema",
  "contracts.passwordChangeSchema",
  "contracts.assetInputSchema",
  "contracts.assetPatchSchema",
  "permissions.systemPermissionsUpdateSchema",
  "system.systemSettingsUpdateSchema",
  "system.aiCircuitUpdateSchema",
  "asset-agent.assetAgentFilters",
  "asset-agent.assetAgentRequest",
]);

// 全部公开 schema 的唯一登记名单（Laravel 侧 JSON Schema 消费面）。
const registry: Entry[] = [
  // contracts — 写入（请求体）校验
  { module: "contracts", name: "credentialsSchema", schema: contracts.credentialsSchema },
  { module: "contracts", name: "accountCreateSchema", schema: contracts.accountCreateSchema },
  { module: "contracts", name: "accountPatchSchema", schema: contracts.accountPatchSchema },
  { module: "contracts", name: "passwordResetSchema", schema: contracts.passwordResetSchema },
  { module: "contracts", name: "profileInputSchema", schema: contracts.profileInputSchema },
  { module: "contracts", name: "passwordChangeSchema", schema: contracts.passwordChangeSchema },
  { module: "contracts", name: "assetInputSchema", schema: contracts.assetInputSchema },
  { module: "contracts", name: "assetPatchSchema", schema: contracts.assetPatchSchema },
  // contracts — 响应实体（LA-01 提升）与分页/搜索形状
  { module: "contracts", name: "accountSchema", schema: contracts.accountSchema },
  { module: "contracts", name: "assetSchema", schema: contracts.assetSchema },
  { module: "contracts", name: "auditEntrySchema", schema: contracts.auditEntrySchema },
  { module: "contracts", name: "authProviderInfoSchema", schema: contracts.authProviderInfoSchema },
  { module: "contracts", name: "assetPageSchema", schema: contracts.assetPageSchema },
  { module: "contracts", name: "auditPageSchema", schema: contracts.auditPageSchema },
  { module: "contracts", name: "assetSearchSchema", schema: contracts.assetSearchSchema },
  { module: "contracts", name: "accountSearchSchema", schema: contracts.accountSearchSchema },
  { module: "contracts", name: "auditSearchSchema", schema: contracts.auditSearchSchema },
  // permissions — 系统权限矩阵更新与响应（响应侧补提升见 LB-03 完成记录）
  { module: "permissions", name: "systemPermissionsUpdateSchema", schema: permissions.systemPermissionsUpdateSchema },
  { module: "permissions", name: "systemPermissionMatrixPayloadSchema", schema: permissions.systemPermissionMatrixPayloadSchema },
  // system — 时区与熔断写入 + 响应实体（LB-03）
  { module: "system", name: "systemSettingsUpdateSchema", schema: system.systemSettingsUpdateSchema },
  { module: "system", name: "aiCircuitUpdateSchema", schema: system.aiCircuitUpdateSchema },
  { module: "system", name: "systemStatusResponseSchema", schema: system.systemStatusResponseSchema },
  { module: "system", name: "systemSettingsResponseSchema", schema: system.systemSettingsResponseSchema },
  // asset-agent — 自然语言筛选参数
  { module: "asset-agent", name: "assetAgentFilters", schema: assetAgent.assetAgentFilters },
  { module: "asset-agent", name: "assetAgentRequest", schema: assetAgent.assetAgentRequest },
];

const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../json-schema");

/** 源码 `.refine(` 调用数必须与 refines.ts 登记数一致，否则生成失败（语义不静默丢失）。 */
function assertRefinesRegistered() {
  const sources = ["asset-agent", "contracts", "permissions", "system"] as const;
  let calls = 0;
  for (const module of sources) {
    const text = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), `${module}.ts`), "utf8");
    calls += (text.match(/\.refine\(/g) ?? []).length;
  }
  if (calls !== CONTRACT_REFINES.length) {
    throw new Error(
      `contracts:generate: 源码有 ${calls} 处 .refine( 但 refines.ts 只登记 ${CONTRACT_REFINES.length} 条；` +
        "请在 packages/api/src/refines.ts 补登记后重新生成。",
    );
  }
}

function main() {
  assertRefinesRegistered();
  mkdirSync(outDir, { recursive: true });
  const require = createRequire(import.meta.url);
  const zodVersion = require("zod/package.json").version as string;
  const index: Array<{ name: string; module: string; file: string; source: string }> = [];
  for (const { module, name, schema } of registry) {
    // unrepresentable: "any" 让 .trim() 等纯 TS 侧检查降级为无约束而不是抛错；
    // 语义丢失部分由 refines.json 清单补（LA-03）。
    const json = z.toJSONSchema(schema, {
      unrepresentable: "any",
      ...(INPUT_SCHEMAS.has(`${module}.${name}`) ? { io: "input" as const } : {}),
    });
    const file = `${module}.${name}.json`;
    writeFileSync(path.join(outDir, file), `${JSON.stringify(json, null, 2)}\n`);
    index.push({ name, module, file, source: `packages/api/src/${module}.ts` });
  }
  writeFileSync(
    path.join(outDir, "index.json"),
    `${JSON.stringify({ zod: zodVersion, count: registry.length, schemas: index }, null, 2)}\n`,
  );
  // refine 语义清单：JSON Schema 表达不了的部分，PHP 侧按 phpRule 补等价校验（LA-03）。
  writeFileSync(
    path.join(outDir, "refines.json"),
    `${JSON.stringify({ count: CONTRACT_REFINES.length, refines: CONTRACT_REFINES }, null, 2)}\n`,
  );
  console.log(`contracts:generate: ${registry.length} schemas + ${CONTRACT_REFINES.length} refines -> ${path.relative(process.cwd(), outDir)}`);
}

main();
