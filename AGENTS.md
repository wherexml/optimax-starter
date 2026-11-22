# OptiMax Starter 协作入口

> 本文件只保留项目入口、核心约束与渐进式索引。执行任务时按触发条件读取详细文档，不默认加载整个规范库。CLAUDE.md 仅指向本文件。

## 项目入口

| 项 | 当前项目 |
| --- | --- |
| 定位 | OptiMax Starter：可运行的管理后台脚手架与开发规范 |
| 页面入口 | `apps/web/src/routes/` 只做路由、鉴权与 URL 参数；导航与品牌统一在 `apps/web/src/config/app-config.ts`；业务页面见 [PROJECT.md](./PROJECT.md)，工作台与模块注册表见 [dashboard](./apps/web/src/features/dashboard/README.md)，登录品牌见 [auth](./apps/web/src/features/auth/README.md)，账户与防提权见 [accounts](./apps/web/src/features/accounts/README.md)，三层角色权限矩阵见 [permissions](./apps/web/src/features/permissions/README.md)，运行探针、时区配置与后台任务见 [system](./apps/web/src/features/system/README.md)，人机双源审计见 [audit](./apps/web/src/features/audit/README.md)，二级导航与顶部 Tab Demo 见 [navigation-demo](./apps/web/src/features/navigation-demo/README.md)，复杂表单弹窗与全套输入控件 Demo 见 [forms-demo](./apps/web/src/features/forms-demo/README.md) |
| 共享界面 | [CRUD 槽位](./apps/web/src/components/crud/README.md)、`apps/web/src/components/table/`、顶层页签 PageTabs、工作台图表原语、共享表单弹窗与输入控件、右下角全局通知及刷新骨架屏 [packages/ui](./packages/ui/README.md)（`apps/web/src/components/ui/` 重导出兼容）；规范见 [FRONTEND.md 表单弹窗与输入控件](./FRONTEND.md#表单弹窗与输入控件)；主题变量在 `apps/web/src/index.css` |
| 服务与数据 | [服务端分层](./apps/server/README.md)（`core/` + `modules/`，含 `rpc.ts` 端到端类型导出）、[共享契约](./packages/api/README.md)、`packages/db/src/schema/console.ts`；新增模块可用 `bun run gen:module`（支持 `--fields`） |
| 本地运行 | [PROJECT.md](./PROJECT.md) |
| 验证入口 | [TESTING.md](./TESTING.md)；代码检查与单测：`bun run lint`、`bun run test` |
| 生产边界 | 默认只读；部署细节见 [DEPLOYMENT.md](./DEPLOYMENT.md) |
| 派生升级 | [.starter-version 与目录边界](./docs/UPGRADE.md) |

## 本地演示账号

仅限本地演示：http://127.0.0.1:38140/login ，用户名 `demo@optimax.hk`，密码 `demo@2026!`（由 `scripts/init-local.sh` 写入 `.env` 的 `STARTER_ADMIN_PASSWORD`，已有值不覆盖）。不得用于生产。

## 核心约束

- 回复称呼 Steve；先查真实文件与运行态，不把推测、mock 或工具尝试说成已完成。
- 保护已有修改；未经明确要求不开 worktree，不覆盖无关文件，不盲目暂存全部改动。
- 不提交或输出密钥、真实密码、用户数据及运行态文件；后端承担最终鉴权。
- 生产变更需明确授权；核对本轮及已有授权，不重复确认。
- 行为验证优先且默认仅用 E2E；禁止实现后补写单测。确需隔离测试，先列失败场景并写测试，再实现。
- 完成前按改动范围验证并保存可复现证据；区分静态检查、行为验收、CI、部署与生产验收。
- 新规则不能降低安全、真实数据和验收要求；项目差异记录在 SPEC_ADOPTION.md。

## 设计原则

- 删除标语、辅助文本和次要标签。如果某个屏幕需要它们才能有意义，就修复布局。
- 始终做出最佳决策，以提升这三者：用户体验 (UX)、开发者体验 (DX) 和代理体验 (AX)，同时不破坏任何东西。
- 不使用绿色或紫色作为主题色。品牌、导航选中态、主按钮与焦点环使用统一的主题色。
- 左侧导航最多二级；第三级及更深层级移到内容区顶部多 Tab。计数、选型与可操作 Demo 见 [导航规范](./DESIGN.md#页内导航与标签)。
- 侧栏保留 Starter 浅色样式；World Model 样式只用于右侧页内 Tab。各页顶部与标题间距统一使用共享 PageHeader 和内容区样式，见 [页面标题区](./DESIGN.md#页面标题区)。

## 侧栏布局基线（强制）

所有由本脚手架创建的新项目都必须遵守以下布局，细节见 [FRONTEND.md](./FRONTEND.md)。

- 侧栏自上而下依次为：品牌区（Logo + 名称）、主导航、搜索、用户信息与菜单。
- 桌面端的折叠按钮放在品牌区内，紧贴 Logo 和名称右侧；内容区不设空顶栏。
- 主导航占满中间的剩余高度，内容超出时在导航区内滚动。
- 搜索固定在侧栏底部、用户信息的正上方，不得放在 Logo 下方。
- 折叠为图标栏时，搜索仍在同一底部位置，只显示图标，并保留可访问名称（aria-label）和悬停提示（title）；Cmd/Ctrl+K 始终可用。
- 移动端抽屉保持相同顺序，各部分不得被裁切或溢出。
- 验收必须覆盖展开、折叠和移动端三种布局，以及搜索的快捷键打开、方向键选择、Enter 跳转、Esc 关闭和焦点归还。

## 按任务读取

先选择符合当前任务的行，只读对应文档的相关章节；任务跨领域时组合读取。执行中发现新增影响面，再补读相关规范。

| 触发条件 | 必读文档 | 需要查到的内容 |
| --- | --- | --- |
| 需求分析、产品范围、PRD 编写与评审 | [PRD.md](./PRD.md) | 背景、旅程、Needs → Features、竞品证据及功能验收 |
| 首次接手、定位模块、本地启动 | [PROJECT.md](./PROJECT.md) | 目录、技术栈、启动顺序、五位端口、业务入口 |
| 非简单任务规划、交付、文档维护 | [WORKFLOW.md](./WORKFLOW.md) | 完成标准、实施步骤、收尾与文档归属 |
| 页面、交互、前端状态或组件变更 | [FRONTEND.md](./FRONTEND.md) + [DESIGN.md](./DESIGN.md) | 前端实现与界面规范 |
| 新增或调整前端交互、UI SDK、自定义 primitive、Agent 操作 | [starter-ui-sdk](./.agents/skills/starter-ui-sdk/SKILL.md) + [FRONTEND.md](./FRONTEND.md) + [DESIGN.md](./DESIGN.md) | 先选复用组件或 SDK，再接路由、URL、业务状态与 E2E；具体入口由技能按场景路由 |
| 页内标签、页面间导航或多页标签条 | [DESIGN.md 页内导航与标签](./DESIGN.md#页内导航与标签) + [FRONTEND.md 页内导航与标签行为](./FRONTEND.md#页内导航与标签行为) | 选用方式、样式、URL、权限、草稿与验收用例 |
| UI、PPT、报表或视觉输出 | [DESIGN.md](./DESIGN.md) | 文案、Radix 配色、字号、对齐、视觉验收；生成图片使用 imagegen skill |
| 后端、数据库、队列、Worker | [BACKEND.md](./BACKEND.md) | 分层、数据、任务、日志、健康检查 |
| API、Webhook、跨端契约 | [API_CONVENTIONS.md](./API_CONVENTIONS.md) | 响应、错误、分页、幂等、契约变更 |
| 登录、角色、租户、权限 | [AUTH.md](./AUTH.md) | 身份、Session、RBAC、租户与审计 |
| 凭证、敏感数据、文件输入、安全边界或 AI/风险数据口径 | [SECURITY.md](./SECURITY.md) | 数据保护、输入风险与信息真实性 |
| 环境配置、部署、迁移、回滚、运行故障 | [DEPLOYMENT.md](./DEPLOYMENT.md) | 环境变量、依赖、部署步骤、数据保护、恢复 |
| CI 检查、发布触发、Runner、流水线故障 | [cicd-spec.md](./cicd-spec.md) | 门禁、制品、权限、触发及结果；涉及部署时再读 DEPLOYMENT.md |
| 测试设计、改动验收、结果报告 | [TESTING.md](./TESTING.md) | 策略、真实命令、场景、证据及结果状态 |
| 分支、PR、多人协作 | [collaboration-spec.md](./collaboration-spec.md) | 合并流程、审查与分支保护 |
| 初始化、升级规范、规则冲突 | [SPEC_ADOPTION.md](./SPEC_ADOPTION.md) | 团队初始化/升级流程入口、基线、来源修订及偏差记录 |

## 项目技能默认路由

- 前端交互、键盘/焦点行为、UI SDK 和 Agent 操作默认先读取项目内 [starter-ui-sdk](./.agents/skills/starter-ui-sdk/SKILL.md)。在 Starter 目录工作时可原生发现，自动调用已开启，也可显式使用 `$starter-ui-sdk`；父目录会话按本文件链接读取。
- 纯布局、颜色、文案按 FRONTEND / DESIGN 处理；纯后端任务按上表进入对应规范。读取技能不代表自动迁移全部控件或启用模型。
- 全局 `ui-sdk` 与项目技能可能同时存在；本项目按上述明确路径读取适配版，不依赖个人主目录。技能负责开发流程，已安装 SDK 文档负责当前 API。

## 继续深入的规则

- 专项文档进一步链接到模块 README、配置模板、脚本和操作手册；按任务继续读到真实实现，不停留在通用模板。
- 路径变更时修复索引；文档缺失或内容仍是占位时先核实并补齐，不虚构项目事实。
- 同一事实只维护一处正文，其他文件链接引用；不在 AGENTS.md 复制部署命令、变量表或详细工程规范。
- 项目内更具体的规范在其范围内适用；与团队约束冲突时按 SPEC_ADOPTION.md 记录，不能静默删除安全与验收底线。

## 已集成的复用模块

快速导航的布局与键盘验收见 [navigation](./apps/web/src/features/navigation/README.md)。

操作日志（区分 `human / agent` 来源并递归脱敏）、三层角色权限矩阵、系统探针与 AI 熔断配置、组合筛选、快速导航已集成，详见 [AUTH.md](./AUTH.md) 与 [REUSE.md](./REUSE.md)。管理与业务写接口必须在同一事务里写入 `console_audit`。

筛选必须保留 EASM 的动态条件列表：添加、删除、切换字段、统一应用，不得退回固定输入框加标签。具体契约见 [FRONTEND.md](./FRONTEND.md)。上游选型比较见 [UPSTREAM_OPTIONS.md](./UPSTREAM_OPTIONS.md)。

## EASM 复用

- EASM 工作台、用户菜单、个人设置：见 [EASM_REUSE.md](./EASM_REUSE.md)。

## 选择与筛选

- 资产自然语言筛选是可选的服务端模型/UI SDK 能力，入口与契约见 [资产模块](./apps/web/src/features/assets/README.md)，模型接入、队列与开源来源见 [服务端 AI 模块](./apps/server/src/core/ai/README.md)。新客户端不依赖 Magpie 运行。UI SDK 选型与验收按项目 [starter-ui-sdk](./.agents/skills/starter-ui-sdk/SKILL.md) 路由。模型凭证值不得进入前端、源码、证据或 Docker 环境；移植代码保留来源与许可，并随交付物分发。

- 单选使用共享 UI 的 Select，接入与验收约定见 [FRONTEND.md](./FRONTEND.md#单选下拉)；三段式表单弹窗与标准化输入控件见 [FRONTEND.md 表单弹窗与输入控件](./FRONTEND.md#表单弹窗与输入控件)。

- `FilterBar` 的多选和匹配方式需逐字段开启（`multi` / `operatorKey`），数据查询链路未实现相应语义的字段不得开启（资产台账经 `GET /console/assets/page` 服务端过滤，`stage` / `domain` / `owner` 多选与 `q` 的 `contains` / `equals` 均由 SQL 实现）。约定见 [FILTERS.md](./FILTERS.md)。

- 资产筛选的空条件行、顺序与未应用草稿需在刷新后恢复；搜索框只对自身设置密码管理器忽略标记，不修改登录/密码框。持久化与 URL 优先级见 [FILTERS.md 刷新恢复](./FILTERS.md#刷新恢复与输入语义)。

## API 运行时

- 常驻 API 运行在 Node 24 上，Bun 只用于 `db:push`；原因和限制见 [RUNTIME.md](./RUNTIME.md)。

## 新项目初始化

- 从 GitHub Template 初始化新项目：首次启动前执行 `./scripts/bootstrap-project.sh <project-slug> --title "项目名称"`（详见 README“从 GitHub Template 初始化新项目”），自动完成改名、分配空闲五位端口、隔离 Cookie 名与刷新 `bun.lock`，并保留侧栏布局基线。
