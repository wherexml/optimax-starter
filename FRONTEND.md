# OptiMax 团队前端工程规范

> 本文件是 OptiMax 团队前端开发 spec。它以团队成熟 RiskOps 前端为参考实现，沉淀 React/Vite 企业工具的默认做法；未来新项目可以选择不同框架，但必须保留真实数据优先、清晰分层、权限态、错误态和浏览器验收。

---

## 1. 参考实现边界

团队默认推荐以下前端组合，适合企业工作台、风险运营、数据报表、后台管理和 Agent 工具：

| 类型 | 默认推荐 | 可替换条件 |
| --- | --- | --- |
| 应用框架 | React + Vite | 项目需要 SSR、移动端或已有 Vue/Next 基础 |
| 路由 | TanStack Router | 需支持稳定 URL、鉴权、动态路由和懒加载 |
| 服务端状态 | TanStack Query | 必须有缓存隔离、失效、重试和加载/错误态 |
| 表格 | TanStack Table | 必须支持列配置、排序、筛选、分页或虚拟滚动 |
| 本地状态 | Zustand | 仅存登录上下文、布局、偏好、跨页 UI 状态 |
| UI 基础 | shadcn/ui + Radix | 必须满足无障碍、键盘、状态和可组合性 |
| 图标 | Lucide | 图标按钮必须有 tooltip 或 aria-label |
| 图表 | Recharts / ECharts | 必须有标题、单位、时间范围、空态 |
| 地图 | MapLibre / deck.gl | 必须有图例、图层控制和降级列表 |
| 表单 | React Hook Form + Zod | 必须有 schema 校验和字段级错误 |
| 测试 | Playwright 等浏览器 E2E；确需隔离测试时用 Vitest | 行为验收以真实浏览器 E2E 为准；隔离测试须实现前先写失败用例（见 TESTING.md） |

这套技术栈是参考实现，不是硬性锁定。项目如果替换技术栈，需要在事实卡里说明替换原因和等价验收方式。

---

## 2. 前端事实卡

复制到项目根目录后，先按真实项目补齐。启动与端口见 [PROJECT.md](./PROJECT.md)，验证命令与场景见 [TESTING.md](./TESTING.md)，API 地址见 [API_CONVENTIONS.md](./API_CONVENTIONS.md)，认证方案见 [AUTH.md](./AUTH.md)。

| 项 | 内容 |
| --- | --- |
| 前端目录 | `apps/web`；`src/routes` 只做路由与 URL 参数，页面在 `src/features/{auth,assets,accounts}` |
| 技术栈 | React + Vite、TanStack Router / Query / Table、React Hook Form + Zod |
| 包管理器 | Bun |
| API 代理方式 | Vite 代理同源 `/console` 到 API；数据库 Session Cookie，不在前端保存 token |
| UI 组件库 | shadcn 风格 Radix 控件（`components/ui/{dialog,select,form,input,button}`），不使用原生 HTML dialog |
| 图表/地图库 | 无；登录页为静态地图图片 |
| 是否允许 mock | 否；12 条资产是服务端写入数据库的演示数据，页面只读 API |
| AI 服务 | 无 |

### 移植来源：复制与适配

| 本项目文件 | 来源 | 保留（复制） | 适配 |
| --- | --- | --- | --- |
| `features/auth/LoginPage.tsx` | `optimax-riskops/src/pages/Login.tsx` | 全屏 `login-risk-map.png`、渐变遮罩、品牌 SVG、右侧登录卡布局 | 账号字段为用户名；调用本项目 Cookie 登录 API；配色用本项目蓝色主题 Token；省略原页面不可用的重置密码入口和营销文案（原页面没有第三方登录） |
| `components/ui/FormDialog.tsx` | `skylance-easm/easm-webui/src/components/dialogs/FormDialog.tsx` | Radix Dialog 外壳、标题/可选描述/内容/底部操作结构、提交中 loading | 可选外部 `formId` 关联提交按钮；`onCloseAutoFocus` 透传用于焦点归还；未单独设置 0.5px 边框 |
| `components/ui/{dialog,form,input,select,button}.tsx` | shadcn/Radix 基础控件 | Radix 焦点陷阱、Esc 关闭、键盘选择；Form 字段级错误与 aria 关联 | 颜色与焦点环映射到 `index.css` 蓝色主题 |
| `components/table/DataTable.tsx` | `skylance-easm/easm-webui/src/components/DataTable/DataTable.tsx` | TanStack Table 渲染、`aria-sort` 排序表头、骨架加载行、空态、80 行以上虚拟滚动、列宽调整代码（默认关闭） | 工具栏由页面传入；列设置并入工具栏；客户端排序与分页（每页 8 / 20 / 100）；新增 `error` 错误态；仅可排序列渲染为按钮 |
| `components/table/{ColumnSettings,DataTablePagination}.tsx` | EASM DataTable 配套组件 | 列显隐、列顺序、分页交互 | 中文文案；至少保留一列可见 |
| `features/accounts/*`、`features/assets/AssetsPage.tsx` | 本项目编写 | — | 组合上述组件；新增账户使用 React Hook Form + Zod，服务端错误回显到字段或表单，成功后失效 `accounts` 缓存、把焦点还给触发按钮并在页面 `role="status"` 区域提示已创建；有未保存内容时 Esc、取消或点遮罩不直接关闭，先显示“继续编辑 / 放弃更改”；查询错误进入 DataTable `error`，启停错误单独显示；后端最终鉴权 |

URL 状态：`/` 支持 `q`、`stage`；`/accounts` 只支持 `q`。排序、列显隐、页码与每页条数保存在 TanStack Table 状态中，列顺序为 DataTable 组件状态，刷新后均重置。

---

## 3. 前端总原则

> 团队通用红线（真实数据优先、前端隐藏入口≠权限、生产默认只读、不提交密钥等）以 [AGENTS.md 核心约束](./AGENTS.md#核心约束) 为唯一正文，本文件不再重述，只补充前端领域细则。

- 页面层保持薄，只放路由、布局、参数读取、权限跳转和模块组合。
- 业务模块按 domain 或 feature 拆分，不按按钮、卡片这类 UI 形态拆业务。
- API 层统一鉴权、base URL、错误处理、类型边界、缓存和失效策略。
- 服务端数据和本地 UI 状态分开管理。
- 每个用户可见页面必须覆盖 loading、empty、error、disabled、permission denied。
- 详情页必须可刷新、可分享，不能依赖列表跳转后的内存状态。

---

## 4. 推荐目录分层

React/Vite 项目优先使用下面结构。其他框架可改目录名，但职责边界保持一致。

```text
src/
├── App.tsx
├── main.tsx
├── router.tsx                  # 路由树、鉴权、懒加载
├── router-utils.ts             # requireAuth、redirect、路由工具
├── config/
│   └── navigation.ts           # 导航和 activePath
├── pages/                      # 页面入口，保持薄
│   ├── Dashboard.tsx
│   ├── Login.tsx
│   ├── risk/
│   ├── supplier/
│   ├── warroom/
│   ├── reports/
│   ├── rules/
│   └── admin/
├── components/
│   ├── ui/                     # 基础 UI
│   ├── common/                 # 跨模块业务组件
│   ├── layout/                 # AppShell、Sidebar、TopBar
│   ├── DataTable/              # 表格封装
│   └── <domain>/               # 模块组件
├── hooks/                      # 模块数据 hooks 和共享 hooks
├── stores/                     # auth、layout、theme、assistant 等跨页状态
├── lib/
│   ├── trpc.ts / api-client.ts # API client
│   ├── query-client.ts         # QueryClient、默认重试和缓存策略
│   ├── tokens/                 # 设计 token
│   └── utils.ts
├── types/                      # 前端补充类型
├── __tests__/                  # 隔离测试（仅限实现前先写失败用例）
├── __fixtures__/               # 仅测试/故事/临时演示使用
└── mocks/                      # 默认不启用；仅明确要求时使用
```

### 分层规则

| 层级 | 可以做 | 不要做 |
| --- | --- | --- |
| 路由层 | 页面入口、布局、参数读取、权限跳转、懒加载 | 复杂数据计算、业务写操作细节 |
| 页面层 | 组合模块、处理 URL 状态、安排页面布局 | 散写 fetch、直接操作缓存、写权限规则 |
| 业务模块 | 业务组件、hooks、表格列、详情区、表单 | 反向依赖其它模块内部实现 |
| API 层 | 请求、鉴权、错误标准化、类型转换 | 在组件里硬编码 URL 或 token |
| 全局状态 | 登录态、当前组织、布局、跨页偏好 | 保存所有表单草稿和局部弹窗 |
| 基础 UI | 通用组件和交互样式 | 绑定业务 API 或业务文案 |

---

## 5. App Shell 与页面信息架构

企业工具默认页面骨架：

```text
AppShell
├── Sidebar
│   └── navigationItems
├── TopBar
│   ├── GlobalSearch
│   ├── OrgSwitcher / WorkspaceSwitcher
│   ├── NotificationCenter
│   └── UserMenu
└── ContentArea
    └── Router Outlet
```

导航建议按任务组织：

| 模块 | 常见路径 | 设计重点 |
| --- | --- | --- |
| Agent | `/opti-agent` 或 `/agent` | 全局助手、执行状态、引用和确认 |
| 总览 | `/` | KPI、异常、待办、趋势和核心入口 |
| 风险/监控 | `/risk/workbench` | 筛选、表格、批量、详情抽屉 |
| 地图/网络 | `/map` | 全宽地图、图层、排行、详情 |
| 对象档案 | `/suppliers`、`/:id` | 列表、画像、历史、关系 |
| 协同 | `/warroom`、`/:id` | 摘要、任务、评论、方案、纪要 |
| 优化 | `/optimization` | 场景、约束、方案比较、执行清单 |
| 报告 | `/reports` | 模板、编辑、预览、发布、导出 |
| 规则 | `/rules` | 条件、动作、版本、执行记录 |
| 管理 | `/admin/*` | 用户、角色、数据源、SLA、审计 |

---

## 6. 路由规范

- 路由路径要稳定、可分享、可刷新。
- 登录页是公开路由；业务页默认走鉴权布局。
- Tab、筛选、排序、分页等影响页面语义的状态优先进入 URL。
- 动态详情页使用明确参数，例如 `/risk/events/$eventId`、`/suppliers/$supplierId`。
- 详情页自己拉取数据，不能依赖列表页塞进来的对象。
- 删除页面时，同步清理导航、路由表、懒加载 import、测试入口。
- 404、无权限、未登录、加载失败要有清楚反馈。

路由事实表：

| 路径 | 页面 | 权限 | 数据来源 | 验收入口 |
| --- | --- | --- | --- | --- |
| `/login` | `features/auth/LoginPage` | 公开；已有 Session 时仍可访问，不自动跳转 | `/console` 登录 API，设置 Session Cookie | `http://127.0.0.1:38140/login` |
| `/` | `features/assets/AssetsPage`（资产台账） | 登录（成员只读、管理员） | `/console` 资产 API；URL 参数 `q`、`stage` | `http://127.0.0.1:38140/` |
| `/accounts` | `features/accounts/AccountsPage` + `CreateAccountDialog` | 管理员（后端鉴权） | `/console` 账户 API；URL 参数 `q` | `http://127.0.0.1:38140/accounts` |

### 页内导航与标签行为

> 本 starter 的项目规则；视觉、位置与键盘语义见 [DESIGN.md 页内导航与标签](./DESIGN.md#页内导航与标签)。当前页面没有页内标签，以下要求适用于新增页面。

- **状态与深链**：当前标签写入 URL 搜索参数 `tab`，取稳定的英文值（例如 `/reports?tab=drafts`），不用中文显示名。路由 `validateSearch` 只接受白名单值；缺省或非法时显示默认标签，并用 `replace: true` 改正 URL。切换标签同样使用 `replace: true`，与现有搜索参数一致。
- **默认标签**：没有 `tab` 参数时打开最常用的视图，不把上次选择当默认值。
- **数据**：每个面板自己的 query 独立请求，未激活面板不请求；不依赖其他面板已加载的数据。面板专属参数（搜索、筛选）在切换标签时清除，不串到其他面板。
- **权限**：无权限的标签不渲染；URL 直接指向无权限标签时，面板显示权限不足，不静默跳到默认标签，也不显示为空数据。后端照常鉴权。
- **草稿**：面板有未保存内容时，切换标签或离开路由前显示“继续编辑 / 放弃更改”（与新增账户弹窗一致）；继续编辑时焦点回到表单。离开路由用 TanStack Router 的 blocker 拦截。

**可选模式：多页标签条**（RiskOps 与本 starter 均未实现）

- **去重**：按规范化路由和对象标识去重，例如 `/suppliers/$supplierId` 归为 `suppliers:42`，不按显示名去重。对象改名后再次打开仍是同一项；同名的不同对象是两项。再次打开已有项时直接激活，不新建。
- **恢复状态**：每项保存完整 URL（含搜索参数）、滚动位置和未提交草稿。草稿只放内存 store，按当前用户隔离，不保存密码等敏感字段；登出、切换用户或失去权限时清空或关闭相应项。
- **关闭**：有未保存草稿时先确认，取消则保留。关闭当前项后激活右侧相邻项；没有右侧项时激活左侧项；全部关闭后回到 `/`。关闭非当前项不改变激活项。

**可复现验收用例**（浏览器 E2E，结果记录到 [TESTING.md](./TESTING.md)）

1. 直接打开并刷新 `?tab=<非默认值>`：选中对应标签和面板。
2. 打开 `?tab=invalid`：显示默认标签，URL 已改正。
3. 键盘：Tab 进入选中标签，←/→、Home/End 切换，焦点环可见，再按 Tab 进入面板。
4. 375px 宽度：标签条横向滚动，页面不横向滚动，选中项可见。
5. 成员打开管理员标签 URL：显示权限不足，不是空表。
6. 面板有草稿时切换标签：出现确认；继续编辑后焦点回到字段；放弃后完成切换。
7. （多页标签条）从菜单两次打开同一对象，或对象改名后再打开：只有一项。
8. （多页标签条）在 A 筛选并滚动，切到 B 再回 A：筛选与滚动位置恢复。
9. （多页标签条）关闭中间的当前项激活右侧项；关闭最右项激活左侧项；关闭最后一项回到 `/`。
10. （多页标签条）关闭含草稿的项出现确认，取消后保留；登出再登录后标签条为空。

---

## 7. API 与数据获取

### API 事实卡

| 项 | 内容 |
| --- | --- |
| API 客户端文件 | <!-- src/lib/trpc.ts / src/lib/api-client.ts --> |
| QueryClient 文件 | <!-- src/lib/query-client.ts --> |
| 代理配置文件 | <!-- vite.config / next.config / 无 --> |
| 错误展示方式 | <!-- toast / inline / modal --> |

### 请求规范

- 所有请求从统一 API client、tRPC client 或模块 service 发出。
- API client 负责 base URL、鉴权、超时、错误标准化和响应解析。
- 组件不直接拼接生产地址、内网地址、token 或第三方 URL。
- GET/query 请求可以缓存，但必须按登录用户、组织、workspace、关键筛选隔离。
- mutation 成功后必须刷新或失效相关缓存。
- 上传、下载、HTML/PDF/图片预览要明确鉴权、大小限制、失败态和 sandbox。
- SSE/WebSocket 必须有断线重连、错误反馈和退出清理。

### Query key 规则

推荐按业务域组织：

```typescript
['events', orgId, filters]
['event', orgId, eventId]
['suppliers', orgId, filters]
['reports', orgId, filters]
['audit-log', orgId, page, filters]
```

规则：

- query key 必须包含租户或当前用户上下文。
- 筛选条件进入 query key 前要标准化，避免对象顺序导致重复缓存。
- 写操作后只失效相关业务域，不全量刷新整个应用。
- 身份上下文变化时的缓存清理统一按下节执行。

---

## 8. 登录态、权限与启动自检

> 「前端隐藏入口≠权限」「后端最终鉴权」等通用红线见 [AGENTS.md 核心约束](./AGENTS.md#核心约束)；认证字段、Session、RBAC 细则以 [AUTH.md](./AUTH.md) 为准。本节只讲前端登录态的行为。

- 应用启动时必须调用 `me` 或等价接口确认当前用户。
- 未登录时跳转登录页；已登录访问登录页时跳回首页。
- 权限不足展示 permission denied，不伪装成空数据。
- 登录态 store 只保存必要用户、组织、角色和 session 信息。
- 凭证存储与传递边界见 [AUTH.md §12](./AUTH.md#12-cookiebearer-与本地存储)。
- 登出、Session 过期或服务端撤销身份后，清理登录态、query cache 和账号绑定的持久数据，关闭 SSE/WebSocket、轮询及 Agent 会话，再进入登录页。
- 切换用户、组织或 workspace 时，先取消旧上下文请求并关闭旧连接，失效对应缓存；新身份确认后再加载数据，不能回显旧请求结果。

---

## 9. 状态管理

| 类型 | 推荐位置 | 示例 |
| --- | --- | --- |
| 服务端数据 | Query 库或 API hook | 列表、详情、统计、报告 |
| 登录态/当前上下文 | 全局 store/context | user、org、workspace、session |
| 页面语义状态 | URL 或页面级状态 | tab、filters、sort、page |
| 临时 UI 状态 | 组件本地状态 | dialog open、hover、draft input |
| 持久偏好 | localStorage 或后端配置 | 主题、密度、列宽、最近视图 |

Store 规则：

- 不做一个装下所有业务的巨型 store。
- Store 不直接调用 React hooks 或框架生命周期。
- 持久化 store 必须有版本、默认值和清理策略。
- 持久化内容及 key 的安全限制见 [AUTH.md §12](./AUTH.md#12-cookiebearer-与本地存储)。
- 服务端数据不要复制进 store 后长期不同步。

---

## 10. 组件规范

### 组件类型

| 类型 | 作用 | 规则 |
| --- | --- | --- |
| 基础 UI | Button、Input、Dialog、Table 等 | 不绑定业务 API，不写业务判断 |
| 通用业务组件 | StatusBadge、SeverityBadge、Timeline、FilePreview 等 | 可以跨模块复用 |
| 模块组件 | 某个业务域内的列表、详情、表单 | 只服务当前业务域 |
| 页面组件 | 组合页面和路由上下文 | 保持薄，避免塞满业务逻辑 |

### 组件质量标准

- props 有明确类型，命名表达业务含义。
- 组件默认支持空值、长文本、窄屏、禁用态。
- 表格列、筛选项、状态 badge、操作按钮要有一致顺序。
- 危险操作必须有确认、权限判断和结果反馈。
- 弹窗、下拉、浮层不能遮挡关键内容或相互冲突。
- 图标按钮必须使用现成图标库，并补 tooltip 或 aria-label。
- 不在组件里硬编码生产 URL、token、真实账号或第三方凭据。

---

## 11. 页面模式

### Dashboard

- 数据 hooks 独立，例如 `useDashboard`。
- KPI、趋势、待办、异常入口要能分别 loading/empty/error。
- 不要为一个指标额外请求一堆重复接口；必要时后端聚合。

### 工作台

- 表格列配置集中维护，避免页面和详情重复写字段口径。
- 高频筛选和 URL 状态同步。
- 行点击打开详情页或详情抽屉，但详情数据独立请求。
- 批量操作显示选中数量、影响范围和执行结果。

### 地图页

- 地图主画布不要包在装饰卡片里。
- 图层开关、排行、详情抽屉和降级列表要齐全。
- 地图 SDK 加载失败时仍能查看列表数据。

### 作战室/协同页

- 默认先展示摘要和进度，再展示任务/评论等重协同内容。
- tabs 用于同一 case 的不同视图，不用于跨模块导航。
- 评论、任务、纪要、附件的写操作要有权限和失败反馈。

### 后台管理

- 管理页要明确管理员权限，普通用户路径要可验证。
- 审计日志、数据源、订阅、SLA 等页面优先表格和筛选，不做花哨展示。

---

## 12. 表格、筛选与详情页

### 表格

- 必须有加载、空数据、错误态、分页或滚动边界。
- 数字右对齐，文本左对齐，状态用 badge 或明确文案。
- 时间字段显示时区或业务口径。
- 批量操作要显示选中数量和影响范围。
- 大表格考虑服务端分页、虚拟滚动或列裁剪。

### 筛选

- 高频筛选常驻，低频筛选放高级筛选。
- 筛选条件改变后，URL 或页面状态要可复现。
- 清空筛选必须可见。
- 后端不支持的筛选不要在前端假装支持。

### 详情页

- 顶部说明对象身份、状态、更新时间和主要操作。
- 详情页要能直接刷新打开。
- 操作区、信息区、历史区、证据区要分清。
- 删除、归档、发布、回滚要写清影响范围。

---

## 13. 表单、权限与反馈

### 表单

- 必填、格式错误、业务错误、服务端错误都要在表单内展示。
- 保存按钮要有 loading 和防重复提交。
- 取消、关闭、刷新前要保护未保存改动。
- 敏感字段不回显明文，API Key 只显示一次或掩码。

### 权限

> 「前端隐藏入口≠权限边界」「后端最终鉴权」见 [AGENTS.md 核心约束](./AGENTS.md#核心约束)；权限码、角色、租户隔离见 [AUTH.md](./AUTH.md)。前端只补充表现层要求：

- 普通用户、管理员、禁用用户、过期登录态都要有明确表现。
- 跨用户、跨组织、跨 workspace 的数据不能在前端缓存中串用。

### 反馈

- 成功反馈说明完成了什么。
- 失败反馈说明为什么失败和下一步。
- 长任务要展示进度或状态查询入口，不让用户盲等。

---

## 14. Mock、fixtures 与演示数据

- 默认不启用 MSW，不从 mocks 或 fixtures 取页面业务数据。
- fixtures 只允许用于隔离测试、组件故事、无后端早期原型或明确授权的演示。
- 使用 mock 必须写清开启入口、覆盖范围、退出条件和验收风险。
- 任务结束时必须确认 mock 没有影响真实页面验收。
- 真实后端暂不可用时，可以做降级页面，但文案要说明数据不可用，不能伪造正常结果。

---

## 15. 设计与可用性

- 设计规则以 [DESIGN.md](./DESIGN.md) 为准。
- 企业工具优先信息密度、清晰层级和稳定布局。
- 不做营销页式大 hero，不滥用装饰渐变、大圆角、大阴影。
- 图表必须标明数据日期、口径和空数据状态。
- 金融、风险、报告类页面不得暗示收益承诺、确定性结论或自动执行。
- 触达用户决策的 AI 输出必须区分事实、推断、建议和待人工确认。

---

## 16. 性能与可维护性

- 首屏只加载当前页面必要数据。
- 重数据、图表、地图、详情浮层按需加载。
- 大表格、大列表要考虑分页、虚拟滚动或服务端查询。
- 避免在 render 中做重计算，必要时 memoize 或下沉到数据层。
- 缓存 TTL 要和业务场景匹配，风险、告警、任务类数据不能长时间静默缓存。
- 错误监控和用户关键路径事件要能定位到页面、接口和用户操作。

---

## 17. 测试与浏览器验收

测试策略、浏览器实操步骤、项目场景、验证命令和证据统一维护在 [TESTING.md](./TESTING.md)。修改路由、交互或布局时更新该文档中的相应场景。

---

## 18. 常见错误

- 只看旧文档，不看当前路由、API 和运行态配置。
- 页面用 mock 正常，真实后端一接就崩。
- 改了页面文件，但导航、路由、懒加载 import 没同步。
- 改了 GET 缓存，没有按用户隔离或写后清理。
- 把生产 URL、内网地址、token 或第三方账号写进前端代码。
- 只跑构建，不打开页面看实际布局和交互。
- 用前端隐藏按钮替代后端权限校验。
- 让详情页依赖列表页内存，刷新后丢数据。

## 工作台与外壳

- `/` 为工作台：资产状态分布（点击进入 `/assets?stage=`）、业务域入口（`/assets?domain=`）、待复核资产队列；管理员额外看到账户概况，可直达 `/accounts?status=` 或 `?role=`。全部数据来自 `/console/assets` 与 `/console/accounts`，每个面板有加载、空和错误重试状态。
- `/assets` 为资产台账，筛选参数 `q`、`stage`、`domain` 写入 URL。
- 内容区不设顶栏。桌面端折叠按钮位于侧栏品牌栏内、紧贴品牌名右侧；折叠为 64px 图标栏时品牌栏改为纵向（标识在上、展开按钮在下），不横向裁切。折叠状态保存在 `localStorage` 的 `optimax-starter.sidebar`，存储不可用时只在当前页面内生效。
- 720px 以下侧栏变为抽屉：抽屉关闭时内容区左上角显示打开按钮，抽屉内标识旁为关闭按钮；Esc、遮罩、关闭按钮或切换页面均可关闭。打开时内容区设为 `inert`，关闭时焦点先回到打开按钮，再将侧栏设为 `inert`。
- 动效仅用于侧栏宽度、抽屉、页面淡入、弹窗进出场与悬停反馈，`prefers-reduced-motion` 下全部关闭。

## 组合筛选、操作日志、快速导航

- 筛选：`components/filters/FilterBar.tsx` 按 EASM FilterComponent 的结构改写为条件列表，条件之间为 AND。“+”（添加筛选）追加第一个未使用的字段；每行包含字段选择、取值和移除按钮；字段只能切换到其他行未使用的字段，切换后取值清空。改动先保存为草稿，按 Enter 或“应用筛选”后通过 `onApply(next)` 一次提交；有未应用的改动时，应用按钮高亮。“清空筛选”立即提交空条件；删除已生效的行后，需要应用才会生效。URL 变化（导航、恢复、前进后退）会同步到草稿，普通重新渲染不会覆盖正在输入的内容；空白行在本页内保留，但不写入 URL，也不保存。多选和匹配方式需要逐字段开启：下拉字段设 `multi: true` 时改为 EASM 复选多选，同一字段内各值为“或”，不同行之间为“且”；文本字段设 `operatorKey` 时出现“包含/等于”选择，默认为包含。目前只有资产台账开启了这两项（`q`+`qOp`，`stage`、`domain` 可多选），账户管理和操作日志仍是单值，日期仍为范围的开始或结束（结束不早于开始）。URL 参数名不变：`q/qOp/stage/domain`、`q/status/role`、`action/actor/start/end`。完整约定见 [FILTERS.md](./FILTERS.md)。
- 筛选保存：`hooks/usePersistedFilters.ts` 把下拉筛选按“账户 ID + 页面”存入 `localStorage`，键为 `optimax-starter.filters.v1:<账户ID>:<页面>`；文本搜索 `q` 不保存。进入页面时，URL 里已有筛选就以 URL 为准并保存；没有时只恢复一次已保存的值。清空后保存 `{}`，刷新后仍为空。存储内容无效或存储不可用时忽略，只用 URL。
- 操作日志：`/audit` 仅管理员可见，可按操作类型、操作人、开始/结束日期筛选（含结束当天，按 UTC+8）。日志由服务端分页（每页 20/50/100），表格通过 `DataTable` 的 `pagination` 参数接入。
- 快速导航：按 Cmd/Ctrl+K 或点侧栏底部、用户信息正上方的“搜索”打开（展开、折叠和移动端抽屉中位置相同）。只跳转本地页面，可用中文名或英文别名搜索；方向键选择、Enter 跳转、Esc 关闭，关闭后焦点回到打开前的位置。输入法组合输入期间不触发快捷键。成员看不到账户管理和操作日志。

## EASM 工作台与个人设置

- EASM 工作台、用户菜单、个人设置：见 [EASM_REUSE.md](./EASM_REUSE.md)。
