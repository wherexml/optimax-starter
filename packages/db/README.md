# @optimax-starter/db（观察期参考实现）

> **LD-04 起（2026-11-19）schema 与迁移权威在 `apps/api-laravel/database/migrations`（LARAVEL.md D2 终态）。**

- 本包降级为观察期参考实现：仅为待退役的 `apps/server`（asset-agent 桥上游，LD-05 将独立为最小 Node 服务）提供类型与查询；运行时消费方只剩它。
- **不得再用 `db:push` / `db:migrate:deploy` 对任何权威库执行**——schema 变更一律走 Laravel 迁移（gen:module 产迁移文件；手工变更 `php artisan make:migration`）。`drizzle-kit` 仅保留应急只读排查能力（如 `db:studio` 查看现状）。
- `src/schema/*.ts` 冻结为 LD-04 基线时点的参考快照，不随后续 Laravel 迁移演进；LD-05 随旧栈一并退役。
- 基线等价性证据：LD-04 验收以 information_schema/pg_index 指纹对拍（Drizzle 推送库 vs artisan 迁移库，除 `migrations` 簿记表外零差异），见 `evidence/laravel-ld-04/`。
