# 团队规范采用与偏差

本机基线为 optimax-team/spec 的 spec-2026.10.23-4，来源 aec8c890a244414d3f25546a202ffd1fd2c0ecff。管理 API 使用同源 Hono HTTP、数据库会话及三层角色权限（`super_admin` / `admin` / `member`）。只提供本地 Docker 开发配置。

> 初始化、升级团队规范或核对规则冲突时读取；日常业务修改无需加载历史记录。

### 规范基线与偏差记录

> 记录本项目采用的团队规范版本，以及所有有意偏离团队规范的做法。初始化与复制清单见[团队使用指南](https://github.com/wherexml/optimax-team/blob/main/spec/README.md#3-初始化流程)；基线标识见[团队变更记录](https://github.com/wherexml/optimax-team/blob/main/spec/CHANGELOG.md)；升级按[安全升级流程](https://github.com/wherexml/optimax-team/blob/main/spec/README.md#8-版本基线安全升级与后续维护)逐条合并，不整文件覆盖。这些文件只在团队仓库维护，不复制到业务项目。

采用记录：

| 项 | 内容 |
| --- | --- |
| 基线标识 | `spec-2026.10.23-4` |
| 来源仓库 | https://github.com/wherexml/optimax-team；历史原文使用下行 SHA 替换链接中的 main |
| 来源修订 | `aec8c890a244414d3f25546a202ffd1fd2c0ecff` |
| 采用/最近升级日期 | 2026-11-16 |
| 核对日期与证据 | 2026-11-16；核对 `AGENTS.md`、`PROJECT.md`、`DEPLOYMENT.md`、`cicd-spec.md`、`TESTING.md` 及 `.github/workflows/` |
| 指令正文位置 | `AGENTS.md`（`CLAUDE.md` 指向 `AGENTS.md`） |
| 负责人 | Steve |

偏差记录：

| 规范条款（文件 §） | 项目实际做法 | 理由 | 证据 | 负责人 | 复查触发条件 |
| --- | --- | --- | --- | --- | --- |
| BACKEND.md §2 默认框架建议 | 后端采用 Hono HTTP（`core/` + `modules/`）配 `@optimax-starter/api` 共享 Zod 契约，移除未使用的 tRPC 路由残留 | Starter 管理接口走同源 `/console` JSON API，Zod 契约已满足前后端单一类型源，去除空置 tRPC 降低新项目理解负担 | [contracts.ts](./packages/api/src/contracts.ts)、[console.ts](./apps/server/src/console.ts) | Steve 授权，Agent 实施 | 新项目需要强类型 RPC 流式过程时复查 |
| FRONTEND.md UI 基础 / UI SDK 技能测试建议 | 2026-11-16 资产本地试点增加可选 UI SDK 适配，保留 Radix；Agent 发现、动作及拒绝采用真实浏览器 E2E，不新增 jsdom 单测 | Steve 明确要求按评估方案试点、只本地验收；项目默认仅 E2E、禁止实现后补单测 | [模块](./apps/web/src/features/assets/README.md)、[E2E](./scripts/e2e/README.md) | Steve 授权，Agent 实施 | 扩大模块、迁移共享组件或进入生产前复查 |

规则：

- 偏差必须有理由、证据、负责人和复查触发条件；没有记录的不一致视为待修正问题，不视为偏差。
- AGENTS.md 的核心约束不能通过偏差记录取消。
- 触发条件发生时复查偏差：保留、调整或取消，并更新核对日期。
