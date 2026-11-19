# 运行时事实（LD-05 收口后）

## 当前运行时（2026-11-19 起）

| 运行时 | 承载 | 形态 |
| --- | --- | --- |
| PHP 8.4（Laravel 13） | `/console` 全部业务流量、`/healthz` | dev：容器内 php 内建服务器（源码挂载热更，启动即 `artisan migrate`）；CI 形态（`-f compose.yaml`）：镜像内置 vendor；生产：FrankenPHP 单容器（非 root `www-data`，`apps/api-laravel/Dockerfile.prod`，LD-03 演练定型） |
| Node 24（Hono） | AI 服务 [apps/ai-service](./apps/ai-service/README.md)：`asset-agent` 桥上游，仅 compose 内网 | dev：`node --import tsx` 直跑 TS；生产（`compose.ai.prod.yaml` overlay）：构建产物 `dist/node.mjs` |
| Bun 1.3.14 | workspace 包管理、前端构建链（Vite）、契约产物生成（`contracts:generate`） | 不承载任何常驻 API；`db:push` 已随 D2 终态退出部署路径（drizzle-kit 仅保留应急只读排查，见 [packages/db](./packages/db/README.md)） |

启动顺序（dev/CI）：`db` healthy → `api-laravel`（migrate + serve，healthy）→ `ai`（agent 桥上游）→ `web`。schema 与迁移权威在 Laravel（LARAVEL.md D2 终态）。

## 历史记录：Bun 段错误事故与 Node 运行时的由来（2026-11-05，归档）

- 预览环境 API 曾运行 Bun 1.3.14（Linux arm64）：开启 JIT 与关闭 JIT（`BUN_JSC_useJIT=false`）均出现段错误（约 25 分钟内退出），无 core dump；属规避而非修复。
- 处置：常驻 API 改 Node 24（`node --import tsx`，`@hono/node-server`，SIGTERM 优雅退出 ≤10s）；`Bun.password` 换 `@node-rs/argon2`（argon2id，m=65536/t=2/p=1，哈希双向兼容）；前端 `request()` 对空响应/非 JSON 502/503 给出中文提示与重试入口。
- 验收（2026-11-05，证据 `evidence/runtime-recovery/`）：容器重建健康、旧 Bun 哈希登录通过、改密链路全绿、8 并发 1200 次鉴权请求有效 JSON、停服/恢复浏览器行为正确；30 分钟以上 soak NOT_RUN。
- LC-08 起该 Node 栈退出 `/console` 主管，LD-05 起定位为 AI 服务（apps/ai-service）；上述运行时特性（Node 常驻、argon2 兼容、优雅退出）随服务保留。
