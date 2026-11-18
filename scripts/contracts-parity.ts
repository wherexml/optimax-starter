// 契约双语言对拍（LB-03）：bun 侧（Zod 直跑）。
// 与 apps/api-laravel 的 `php artisan contracts:parity` 读同一份样本文件，
// 输出逐样本判定 JSON；两边 valid 数组必须完全一致。运行：
//   bun scripts/contracts-parity.ts > /tmp/parity-ts.json
//   docker compose exec -T api-laravel php artisan contracts:parity > /tmp/parity-php.json
//   diff /tmp/parity-ts.json /tmp/parity-php.json
import { readFileSync } from "node:fs";
import path from "node:path";
import * as assetAgent from "../packages/api/src/asset-agent";
import * as contracts from "../packages/api/src/contracts";
import * as permissions from "../packages/api/src/permissions";
import * as system from "../packages/api/src/system";

const registry: Record<string, import("zod").ZodType> = {
  "contracts.credentialsSchema": contracts.credentialsSchema,
  "contracts.accountCreateSchema": contracts.accountCreateSchema,
  "contracts.accountPatchSchema": contracts.accountPatchSchema,
  "contracts.passwordResetSchema": contracts.passwordResetSchema,
  "contracts.profileInputSchema": contracts.profileInputSchema,
  "contracts.passwordChangeSchema": contracts.passwordChangeSchema,
  "contracts.assetInputSchema": contracts.assetInputSchema,
  "contracts.assetPatchSchema": contracts.assetPatchSchema,
  "permissions.systemPermissionsUpdateSchema": permissions.systemPermissionsUpdateSchema,
  "system.systemSettingsUpdateSchema": system.systemSettingsUpdateSchema,
  "system.aiCircuitUpdateSchema": system.aiCircuitUpdateSchema,
  "asset-agent.assetAgentFilters": assetAgent.assetAgentFilters,
  "asset-agent.assetAgentRequest": assetAgent.assetAgentRequest,
};

type Fixture = { id: string; schema: string; data: unknown };

const fixturesPath = path.resolve(import.meta.dir, "e2e/fixtures/contract-parity.json");
const fixtures: Fixture[] = JSON.parse(readFileSync(fixturesPath, "utf8")).fixtures;

const results = fixtures.map((fixture) => {
  const schema = registry[fixture.schema];
  if (!schema) throw new Error(`对拍样本引用了未登记的 schema：${fixture.schema}`);
  return { id: fixture.id, valid: schema.safeParse(fixture.data).success };
});

console.log(JSON.stringify(results));
