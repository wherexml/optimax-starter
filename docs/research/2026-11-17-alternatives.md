# OptiMax Starter：竞品与替代项目

核对日期：2026-11-17（Asia/Singapore）。本轮为选型调研与公开页面阅览，未安装候选、未改产品代码、未购买或迁移。文档事实与建议分开记录。

## 结论

有更适合特定任务的项目，但现有证据不足以支持整套替换 Starter。

1. **最值得先验证的局部替代：Shadcn Admin Kit 2.0。** 目标是减少列表、关联表单、批量操作的重复维护，保留当前后端与鉴权。
2. **最接近发展方向的平台竞品：NocoBase 3 Core。** 已覆盖基础模块、项目架构、AGENTS 与 Skills；需要单独验证 beta 状态、界面定制、升级和版本权益。
3. **新建完整 SaaS 时更值得考虑：supastarter for TanStack Start。** 组织、邀请、登录与计费较完整；单纯后台未必需要增加这些模块。
4. **保留 Refine + shadcn/ui 为对照。** 若业务界面差异很大、又有大量数据流程，它比固定页面模板更值得评估。

这些是基于公开实现与文档的适配判断，不是交付效率或生产稳定性实测。

## 当前比较基线

按 [README](../../README.md)、[PROJECT](../../PROJECT.md) 与 [服务端说明](../../apps/server/README.md)，当前是可运行、自托管的管理后台底座：

- React / Vite、TanStack Router / Query / Table、Tailwind v4、Radix 与共享 UI。
- Hono / Node 24、PostgreSQL / Drizzle、共享 Zod 契约；Docker 本地与生产编排。
- 三层角色与模块权限矩阵、数据库 Session、写操作同事务审计，区分 human / agent。
- 动态条件筛选、列表槽位、全栈模块生成器、项目规范与随模板携带的 UI SDK Skill。
- 已有可选资产自然语言筛选，不据此称为完整 Agent 开发平台。
- 组织多租户、完整企业 SSO 与 SaaS 计费尚不是当前通用底座的已完成能力。

因此，选择标准是：能否减少每个业务项目重复建设，同时保持简洁界面、代码可控、后端权限边界和 Agent 可维护性。

## 候选比较

接入代价为基于架构差异的定性推断，未做工时实测。“Agent 支持”区分辅助开发与业务运行时，AGENTS/Skills 本身不证明运行时授权与审计正确。

| 项目 | 实际提供什么 | 对当前任务的帮助 | 主要接入代价 | 建议 |
| --- | --- | --- | --- | --- |
| [Shadcn Admin Kit](https://github.com/marmelab/shadcn-admin-kit) | ra-core + shadcn 的 CRUD 组件与适配器 | 关联字段/表单、批量操作、导出、列表状态；可控源码 | 前端中等；Base UI、ra-core、数据/认证适配与现有 URL/权限协同 | 局部替换第一候选 |
| [Refine CORE + shadcn/ui](https://refine.dev/core/docs/ui-integrations/shadcn/introduction/) | Headless 数据与管理框架、源码组件 registry | 为不同业务外观复用数据/表单流程 | 前端中等；Provider 抽象与路由、状态接入；后端仍自行维护 | 作为 Kit 的对照方案 |
| [NocoBase 3 Core](https://www.nocobase.com/core/) | 应用运行时、基础模块、插件与 Agent 开发规范 | 权限、工作流、文件等可以采用统一模块 | 整体高；需接受其插件/运行时、数据与升级方式，并核对权益 | 单独试验平台路线 |
| [supastarter TanStack Start](https://supastarter.dev/docs/tanstack-start) | 商业全栈 SaaS 模板 | 登录、组织、邀请、计费及 Agent 开发入口 | 现有项目中高；Start、oRPC、Better Auth 与业务数据迁移 | 有组织/计费需求的新项目优先 |
| [React Starter Kit](https://github.com/kriasoft/react-starter-kit) | Hono / tRPC / Drizzle / Better Auth 全栈模板 | 前端相近，并带组织、认证与 Stripe | 当前部署适配高；默认 Cloudflare Workers / Neon 架构 | 采用 Cloudflare 路线时再考虑 |
| [satnaing/shadcn-admin](https://github.com/satnaing/shadcn-admin) | Vite + shadcn 后台界面集合 | 表格、表单、侧栏、响应式样式参考 | 局部低；账户/权限/审计后端不能随界面获得 | 参考页面，不作完整替代 |
| [Better Fullstack](https://github.com/Marve10s/Better-Fullstack) | Better-T-Stack 分叉出的组合生成器 | Internal Tool pack 与当前技术组合很近 | 需继续实现业务模型、权限检查、CRUD 与审计 | 关注生成/升级流程，暂不重建底座 |

## 会改变选择的证据

### Shadcn Admin Kit：旧的路由障碍已发生变化

[2.0 Changelog](https://marmelab.com/shadcn-admin-kit/docs/changelog/) 明确新增 TanStack Router 支持，同时把组件基础转为 Base UI。[安装文档](https://marmelab.com/shadcn-admin-kit/docs/install/) 给出 `ra-router-tanstack` 接法。因此 11 月 5 日“必须采用 React Router”的判断不能继续直接套用。

但它仍是前端管理组件与框架。需要通过 dataProvider / authProvider 接入现有服务；[安全文档](https://marmelab.com/shadcn-admin-kit/docs/security/) 中的界面访问控制不能替代当前服务端事务权限校验与审计。

本轮打开了公开电商 Demo 的订单列表：可见状态 Tab、筛选、列设置、导出与分页。页面声明数据是本地虚构数据，刷新重置；这只能证明演示界面可阅览。

真实维护经验：2.0 更新记录披露，Base UI Avatar 的布局更新曾触发 ra-core 关联字段页面的更新嵌套崩溃，并要求 ra-core 至少 5.15.2。采用时必须核对兼容版本，不能只复制视觉组件。

**最小采用边界：** 先尝试一个关联数据较多的业务列表与编辑表单；保留现有 Hono、数据库、权限矩阵和审计。能否保留当前动态条件列表、URL 草稿恢复和 UI SDK 交互仍待验证。

### NocoBase 3：定位接近，但成熟度与权益影响很大

[Core](https://www.nocobase.com/core/) 将基础模块、项目结构、AGENTS 与随包分发的 Skills 放在一起，覆盖的方向比传统后台模板更接近我们。

反方证据是当前 [v3 README](https://github.com/nocobase/nocobase/blob/v3/README.md) 仍使用 `@nocobase/app@beta` 与 `--template-tag=beta`；[文档目录](https://docs.nocobase.com/core/) 中多租户、部分运维主题标为 Planned。网站的生产就绪表述不能代替本轮没有进行的验收，Planned 也不能直接推导所有对应功能都不存在。

[版本表](https://www.nocobase.com/pricing/) 将完整审计、多租户等列入 Enterprise；Studio 随 Professional/Enterprise 提供，Professional 页面标价 US$8,000 一次性，含一年升级和支持。基础活动历史与完整审计需要分开比较。

[2026-11-16 更新的许可文本](https://www.nocobase.com/license/) 包含补充条款和社区版界面署名要求，不能简单概括为“纯 Apache、无限制白标”。若用于对外交付或开发平台，采用前须按实际用途核对原文。

**建议：** 只把 Core 作为隔离试验候选；本轮不推荐购买 Studio 或迁移已有系统。官网客户材料主要不能直接证明 v3 的成熟度，未找到并核实符合我们场景的 v3 长期运行经验。

### supastarter：完整 SaaS 的候选，而非普通后台的必要升级

[TanStack Start 文档](https://supastarter.dev/docs/tanstack-start) 与[产品页](https://supastarter.dev/tanstack-start) 展示 Hono / oRPC、Drizzle、Better Auth、组织与角色、计费、E2E 和 Agent Skills。它比仅提供后台界面的模板更接近可交付 SaaS，但当前 Vite + Hono 项目不能据此视为零成本迁移。

公开价格页为 Solo US$349、Startup US$799（最多 5 个开发者）、Agency US$1,499（最多 10 个开发者并列明客户项目用途），均为一次性标价。公司团队复用或客户交付需按对应使用范围选择，不能只比较最低个人价格。

本轮查看公开营销 Demo 和登录页，没有登录、注册、付费或取得商业源码，因此组织隔离、计费与完整业务交互均未实测。厂商展示的客户产品与评价不作为我们能节省多少工时的证据。

**采用条件：** 新项目同时需要组织、邀请和计费，并接受 TanStack Start 与模板的 API/认证结构；仅做内部台账时，删减这些模块可能抵消模板收益。

### 其余候选的边界

- **Refine：** [官方 shadcn 文档](https://refine.dev/core/docs/ui-integrations/shadcn/introduction/) 已有源码 registry，以及基于 TanStack Table 的筛选/排序示例。适合保留自定义界面并复用数据流程；Provider 支持不等于自带我们需要的后端安全实现。本轮未阅览其独立运行 Demo。
- **React Starter Kit：** [当前 README](https://github.com/kriasoft/react-starter-kit) 使用 Cloudflare Workers、service bindings 与 Neon，技术组件虽相近，默认部署路径不同。是否能低成本改为当前 Docker 自托管，未验证。
- **shadcn-admin：** [作者 README](https://github.com/satnaing/shadcn-admin) 明确把它定位为可复用 UI 集合，且提示定制组件升级可能要手工合并。本轮已阅览 Tasks 页面；界面有些顶部说明和分组标签不符合我们的简化偏好，不能整页照搬。
- **Better Fullstack：** [Internal Tool guide](https://better-fullstack.dev/guides/packs/create-internal-tool) 技术栈非常接近，但 First things to customize 仍要求补业务对象、角色校验、CRUD 和审计视图。[README](https://github.com/Marve10s/Better-Fullstack) 说明其为 Better-T-Stack 分叉。没有证据表明重新生成一次能替代当前已实现的业务底座。

## 页面证据与复看方式

使用 ego-browser 访问公开网页后截取，图片已人工视觉检查。下表记录实际可见范围；登录页和官网截图不代表已验证产品内部能力。演示数据与数量可能随刷新变化。

| 对象 | 实际页面 URL | 本地截图 | 覆盖范围 |
| --- | --- | --- | --- |
| Shadcn Admin Kit | [订单列表](https://marmelab.com/shadcn-admin-kit/demo/#/orders) | [截图](./2026-11-17-alternatives/shadcn-admin-kit.png) | 打开 Dashboard → Orders，等待表格加载；虚构数据 |
| shadcn-admin | [Tasks](https://shadcn-admin.netlify.app/tasks) | [截图](./2026-11-17-alternatives/shadcn-admin.png) | 打开 Dashboard → Tasks，等待任务列表 |
| supastarter | [登录页](https://tanstack-start-app-demo.supastarter.dev/login) | [截图](./2026-11-17-alternatives/supastarter-login.png) | 营销 Demo → Login；未登录 |
| NocoBase 3 | [Core 官网](https://www.nocobase.com/core/) | [截图](./2026-11-17-alternatives/nocobase-core.png) | 官方定位与模块展示；不是运行中业务系统 |

## 下一步的最小验证（NOT_RUN）

建议先验证 Shadcn Admin Kit；只有希望采用统一业务平台时，再验证 NocoBase Core。不同时把两套候选引入现有应用。

统一任务：做一个“供应商”模块，包含名称、状态、负责人和备注；管理员增改删、成员只读，支持动态筛选、关联字段与刷新恢复。以当前 `gen:module` 生成方式作对照。

先列失败方式：Provider 导致数据/URL 语义变化；界面权限隐藏但 API 可越权；写入成功而审计丢失；关联表单或错误恢复失效；键盘/焦点和移动端退化；升级覆盖定制组件；Agent 操作绕过权限或来源审计。

建议用每个候选一个工作日的时间盒作为停止条件，实际投入尚未测量。新目录和端口须按当次执行范围确定，不自行创建分支/worktree；本地服务采用相邻五位端口。

| 验证维度 | 建议通过标准 | 证据 |
| --- | --- | --- |
| UX | 现有动态筛选与草稿恢复、侧栏/Tab、键盘焦点和移动端要求均保留；无额外解释性文案 | 同一业务旅程的 URL、桌面/移动端截图 |
| DX | 记录完成时间、业务代码文件与依赖变化；基础 CRUD 重复工作减少，错误可追踪 | 小范围 diff、命令与日志 |
| AX | 新 Agent 依据项目规范能定位与扩展模块；运行时操作仍受同一后端权限边界约束 | 开发记录、受限角色 E2E、审计记录 |
| 安全与恢复 | 越权失败、事务失败回滚、审计正确；可移除试验而不迁移真实数据 | HTTP/浏览器 E2E 与失败恢复证据 |
| 长期维护 | 升级一次候选依赖或复制组件，确认改动边界与定制保留方式 | 升级前后 diff、已知限制 |

当前项目行为 E2E、候选本地安装、迁移和性能验证均为 **NOT_RUN**。本轮只修改研究文档并保存公开页面截图；文档空白检查及 8 个本地链接检查通过，4 张截图均已打开检查。没有生产变更或商业采购。

## 研究边界与复查触发

本轮聚焦 7 个项目，分现状核对、候选补充和反方查证收敛；未做付费调用。正文已链接影响决定的一手资料，全部按 2026-11-17 访问内容使用；页面未注明更新时间的，不补造日期。未独立计时。

证据强度：架构/接口与版本权益来自官方文档和 README，可用于建立候选清单；真实交付速度、v3 长期稳定性、现有 UI SDK 兼容性证据不足，不能据此断言替换收益。

复查触发：NocoBase v3 安装标签/版本权益改变；Kit 兼容性或组件基础改变；项目明确增加组织隔离/计费；最小验证证明能在不损失 UX、DX、AX 的前提下减少重复代码。此前继续使用当前底座，并优先借鉴成熟模块。
