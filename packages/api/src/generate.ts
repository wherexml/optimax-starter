// 契约产物生成器（LARAVEL.md LA-02）。
// 运行：bun run contracts:generate（根脚本）。产物在 packages/api/json-schema/，
// 必须显式生成并提交（postinstall 不自动执行），CI 门禁拦截过期产物（LA-04）。
// 输出确定性：不含时间戳，二次执行必须零 diff；产物版本以 git 历史为准。
// 扩展约定：新增公开 schema 时在本文件 registry 登记，并重新生成产物提交。

import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import * as assetAgent from "./asset-agent";
import * as contracts from "./contracts";
import * as permissions from "./permissions";
import * as system from "./system";

type Entry = { module: string; name: string; schema: z.ZodType };

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
  // permissions — 系统权限矩阵更新
  { module: "permissions", name: "systemPermissionsUpdateSchema", schema: permissions.systemPermissionsUpdateSchema },
  // system — 时区与熔断写入
  { module: "system", name: "systemSettingsUpdateSchema", schema: system.systemSettingsUpdateSchema },
  { module: "system", name: "aiCircuitUpdateSchema", schema: system.aiCircuitUpdateSchema },
  // asset-agent — 自然语言筛选参数
  { module: "asset-agent", name: "assetAgentFilters", schema: assetAgent.assetAgentFilters },
  { module: "asset-agent", name: "assetAgentRequest", schema: assetAgent.assetAgentRequest },
];

const outDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../json-schema");

function main() {
  mkdirSync(outDir, { recursive: true });
  const require = createRequire(import.meta.url);
  const zodVersion = require("zod/package.json").version as string;
  const index: Array<{ name: string; module: string; file: string; source: string }> = [];
  for (const { module, name, schema } of registry) {
    // unrepresentable: "any" 让 .trim() 等纯 TS 侧检查降级为无约束而不是抛错；
    // 语义丢失部分由 refines.json 清单补（LA-03）。
    const json = z.toJSONSchema(schema, { unrepresentable: "any" });
    const file = `${module}.${name}.json`;
    writeFileSync(path.join(outDir, file), `${JSON.stringify(json, null, 2)}\n`);
    index.push({ name, module, file, source: `packages/api/src/${module}.ts` });
  }
  writeFileSync(
    path.join(outDir, "index.json"),
    `${JSON.stringify({ zod: zodVersion, count: registry.length, schemas: index }, null, 2)}\n`,
  );
  console.log(`contracts:generate: ${registry.length} schemas -> ${path.relative(process.cwd(), outDir)}`);
}

main();
