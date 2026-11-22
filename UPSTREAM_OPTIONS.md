# 上游仓库比较

后端定位与能力边界的后续核对见 [2026-11-18：Starter 定位与后端差距](./docs/research/2026-11-18-position-backend-gaps.md)，包含当前架构图、源码证据和演进优先级。该文是选型建议，不是新增已实现能力。

## 当前判断：2026-11-17

本轮重新核对当前项目定位、官方文档、公开仓库与演示页面。完整比较、接入代价、截图和待验证方案见 [竞品与替代项目研究](./docs/research/2026-11-17-alternatives.md)。

- **局部替换优先看 Shadcn Admin Kit 2.0**：已支持 TanStack Router，旧结论中的路由限制需要修正；仍需适配 Base UI、ra-core 与现有 API/认证。
- **完整 SaaS 新项目看 supastarter 的 TanStack Start 版本**：Hono、Drizzle、组织与计费接近潜在扩展方向；不等于能直接替换当前 Vite 管理后台。
- **平台路线重点跟进 NocoBase 3 Core**：定位已接近“统一基础模块、工程规范与 Agent 开发”；当前 README 使用 beta 安装入口，完整审计与部分能力有版本权益限制，暂不推荐直接迁移现有项目。
- **Refine + shadcn/ui 保留为框架型候选**；satnaing/shadcn-admin 适合作界面参考。当前没有完成替换 PoC，维持现有底座是暂定建议，不代表其他方案已被实测淘汰。

## 历史快照：2026-11-05

2026-11-05 查询 GitHub REST API。日期取默认分支实际提交时间（UTC），仓库 pushed_at 可能来自其他分支。

| 仓库 | Stars | 默认分支最近提交 | 当前用途 |
| --- | ---: | --- | --- |
| [Better-T-Stack](https://github.com/AmanVarshney01/create-better-t-stack) | 5,855 | 2026-10-24 | 当前项目初始化来源，全栈组合生成器 |
| [React Admin](https://github.com/marmelab/react-admin) | 26,987 | 2026-11-04 | 成熟的 React CRUD 框架，默认 Material Design |
| [Next Shadcn Dashboard Starter](https://github.com/Kiranism/next-shadcn-dashboard-starter) | 7,227 | 2026-11-02 | 较完整的后台页面，Next.js 16、shadcn/Base UI、Clerk |
| [Refine](https://github.com/refinedev/refine) | 35,997 | 2026-09-10 | 支持自定义 UI 的 React 管理框架 |
| [shadcn-admin](https://github.com/satnaing/shadcn-admin) | 16,553 | 2026-06-11 | React/Vite 栈接近，近期主分支维护相对较少 |
| [shadcn-admin-kit](https://github.com/marmelab/shadcn-admin-kit) | 1,145 | 2026-11-03 | React Admin 团队的 shadcn + ra-core 方案，stars 较少 |
| [Vben Admin](https://github.com/vbenjs/vue-vben-admin) | 33,749 | 2026-11-04 | Vue 后台方案，整体采用涉及技术栈切换 |

许可证均为 MIT，具体产品附加服务与商业扩展按各仓库说明评估。

### 当时的适配判断

- Better-T-Stack 擅长生成技术栈组合，后台业务模块需要继续建设。
- React Admin 提供列表、表单、数据和认证适配。保留 shadcn 风格可以进一步评估同团队的 shadcn-admin-kit，但其采用 React Router、ra-core 和 Base UI，需适配当前 TanStack Router 与 Radix 组件。
- Next Shadcn Dashboard Starter 适合参考页面与模块。整体采用涉及当前 Vite 路由、服务端和认证适配；仓库提供清理 Clerk 和演示模块的命令。
- 当前推荐先继续维护独立脚手架，从活跃上游借鉴成熟模块。是否更换底座应单独评估数据、认证与路由迁移成本。
