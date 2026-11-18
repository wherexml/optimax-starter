# app/Core —— 横切基础设施（映射 apps/server/src/core/）

| 现有 TS 侧 | 本目录对应物 | 落地 spec |
| --- | --- | --- |
| `guards.ts`（requirePermission / Refusal / lockPermission） | 权限中间件 | LB-05 |
| `audit.ts`（同事务审计 + 递归脱敏） | AuditWriter | LB-06 |
| `permissions.ts`（三层角色矩阵联动） | 权限矩阵服务 | LC-03/04 |
| `system-settings.ts`（时区 / AI 熔断） | SystemSetting 服务 | LC-03/04 |
| `seed.ts`（演示种子） | `console:seed` 命令 | LB-08 |

新模块只消费这里的能力，不复制横切逻辑（LARAVEL.md 扩展性原则）。
