# 上游仓库比较

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

## 与当前项目的适配

- Better-T-Stack 擅长生成技术栈组合，后台业务模块需要继续建设。
- React Admin 提供列表、表单、数据和认证适配。保留 shadcn 风格可以进一步评估同团队的 shadcn-admin-kit，但其采用 React Router、ra-core 和 Base UI，需适配当前 TanStack Router 与 Radix 组件。
- Next Shadcn Dashboard Starter 适合参考页面与模块。整体采用涉及当前 Vite 路由、服务端和认证适配；仓库提供清理 Clerk 和演示模块的命令。
- 当前推荐先继续维护独立脚手架，从活跃上游借鉴成熟模块。是否更换底座应单独评估数据、认证与路由迁移成本。
