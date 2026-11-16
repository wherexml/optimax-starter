# 测试与验收

浏览器验收与权限验证见 README 的复验章节、scripts/verify-console.py 和 evidence/admin/。

> 编写测试前和交付前读取对应场景；执行命令前填入真实项目配置。

## 项目验收入口

| 项 | 当前事实 |
| --- | --- |
| 静态检查命令 | `bun run check-types`、`bun run build`、`git diff --check`、`node scripts/e2e/ci-scope-e2e.mjs`（CI `quality` job 同步执行） |
| E2E 命令 | 接口与数据库事务：`python3 scripts/verify-console.py`、`python3 scripts/verify-foundation.py`（后跟 `--cleanup`）、`python3 scripts/verify-easm-settings.py` + `verify-easm-rollback.py`（后跟 `--cleanup`）、`python3 scripts/verify-runtime-load.py`；真实浏览器：见 [scripts/e2e/README.md](./scripts/e2e/README.md) |
| 测试环境及安全数据 | 本地 Docker Compose 独立预览库（`http://127.0.0.1:38140` / `:38141`），仅使用本地演示账号与脚本自动清理的随机 `qa_*` 临时夹具 |
| 证据目录 | 本地 git 忽略的 `evidence/<task>/`；CI 运行产物上传至 GitHub Actions Artifacts（保留 7 天） |
| 隔离测试 | 默认仅用真实进程/HTTP/浏览器 E2E；新增 `scripts/e2e/ci-scope-e2e.mjs` 在编写 `ci-scope.mjs` 前先运行失败断言再实现通过 |

### 页面验收清单

| 场景编号与名称 | URL | 操作 | 预期 |
| --- | --- | --- | --- |
| 登录 | <!-- 补充 --> | <!-- 补充 --> | <!-- 补充 --> |
| 总览 | <!-- 补充 --> | <!-- 补充 --> | <!-- 补充 --> |
| 工作台 | <!-- 补充 --> | <!-- 筛选、表格、详情 --> | <!-- 补充 --> |
| 详情页 | <!-- 补充 --> | <!-- 直接打开/刷新 --> | <!-- 补充 --> |
| 管理员页面 | <!-- 补充或无 --> | <!-- 补充 --> | <!-- 补充 --> |
| 错误/空状态 | <!-- 补充 --> | <!-- 补充 --> | <!-- 补充 --> |
| 权限不足 | <!-- 补充 --> | <!-- 普通用户访问 --> | <!-- 补充 --> |

### 浏览器实操验收

1. 按 [PROJECT.md](./PROJECT.md) 启动真实应用，记录本次修订、URL、角色和安全测试数据。工具遵循用户及项目指定顺序，优先 ego-browser 或 Chrome，自动化可使用项目已有 E2E 脚本。
2. 打开页面，实际完成点击、输入、提交、导航和结果读取，覆盖本次变更涉及的完整用户旅程；不能仅看截图或 HTTP 200。
3. 写操作检查结果及刷新后的持久化；登录/权限变化覆盖普通用户、管理员、过期和拒绝路径。使用安全数据并记录清理方法。
4. 检查受影响的加载、空、错误状态；布局变更实际查看桌面和窄屏截图。必要时读取网络与控制台错误。
5. 按下方证据格式保存可重复操作步骤、截图及 trace/日志/报告；每个场景分别报告状态。环境阻塞或未操作不得写 PASS。

命令只在上方验收入口维护；CI 复用同一脚本，差异注明依赖、安全配置及对应 workflow。部署执行命令归 [DEPLOYMENT.md](./DEPLOYMENT.md)，本文件仅引用并记录验收场景。

## 验收门禁

| 改动类型 | 最低验收 |
| --- | --- |
| 文档 | 文档检查：`git diff --check`，确认链接和命令不明显过期；行为验收记 NOT_RUN（仅文档改动） |
| 前端 | 构建或类型检查（静态检查）+ 关键页面真实浏览器 E2E 证据 |
| 后端 | 在真实运行的服务上做接口级 E2E（代表性请求，含错误和权限路径）+ 健康检查 |
| API 契约 | 前后端类型、调用方、错误态、文档同步，并用 E2E 走通调用方 |
| 数据/迁移 | 迁移或脚本用代表性数据跑过并记录输入和结果，确认不提交运行态数据 |
| 权限 | 普通用户和管理员路径分别 E2E 验证 |
| 生产相关 | 本地验证、CI/CD、生产只读健康检查 |

### 测试策略

- E2E 是首选、默认唯一的行为测试机制：在真实运行的页面、服务、接口、脚本或 Worker 上，按用户或调用方路径验证成功、失败和权限场景。浏览器工具按用户指定和项目事实卡执行；未指定时使用当前可用工具，必须打开真实页面，不能用源码推断替代页面验收。
- 构建、类型检查、lint、文档检查是静态检查，可以作为门禁，但不能替代行为验收。
- 禁止在实现完成后补写单元测试，包括为凑覆盖率而补写。
- 确需隔离测试时（例如纯计算、解析、状态机，或 E2E 难以稳定触达的错误分支），必须在写实现代码之前先写失败用例，运行并记录失败输出，再实现到通过。
- 项目已有的隔离测试照常维护和运行，不因本规则删除；项目采用不同测试策略时，记录在 SPEC_ADOPTION.md「规范基线与偏差记录」。

### 验收证据

每条行为验收都要留下可复现记录，放在 PR 描述、`tasks/todo.md` 的 review 段或项目约定的 evidence 目录：

| 字段 | 内容 |
| --- | --- |
| 场景 | 验证的用户或调用方路径，包括成功、失败或权限路径 |
| 环境与修订 | 本地 / 测试 / 生产只读；URL 或服务；commit SHA，以及是否含未提交改动；关键配置 |
| 输入 | 账号角色（不写密码）、数据样本、参数 |
| 步骤/命令 | 可直接复跑的命令或逐步操作 |
| 预期 | 应该看到的结果 |
| 实际 | 实际观察到的结果 |
| 产物 | 截图、日志、报告、trace 的路径；截图必须实际查看后才能做视觉结论 |
| 状态 | PASS / FAIL / BLOCKED / NOT_RUN |

状态含义：

- **PASS**：按步骤执行，实际与预期一致，并有产物。
- **FAIL**：已执行，实际与预期不一致。
- **BLOCKED**：因环境、权限、依赖或数据无法执行完；写明阻塞原因和解除条件。工具故障不是应用行为的证据。
- **NOT_RUN**：未执行；写明原因，例如「仅文档改动」「用户明确要求不运行」「超出本次范围」。

规则：

- 只有 PASS 才能表述为「已验收」。命令退出码为 0、截图文件存在、构建成功都不等于 PASS。
- 文档检查通过不等于验收；仅文档改动报告为「文档检查 PASS，行为验收 NOT_RUN（仅文档改动）」。
- 用户明确要求不运行测试或验证时照做，记录 NOT_RUN（用户要求不运行），交付说明写明「未验收」，不得写成已验证。
- 部分场景通过不等于整条旅程通过；按场景分别报告。

## EASM 工作台与个人设置（2026-11-05）

本轮 Docker、HTTP E2E、浏览器与截图证据见 [验收记录](./evidence/easm-dashboard/acceptance.md)。脚本：`scripts/verify-easm-settings.py`、`scripts/verify-easm-rollback.py`。测试账户用完后必须执行 cleanup。

## 资产多选与操作符（2026-11-05）

本机 Docker 与浏览器验收见 [记录](./evidence/multi-filters/acceptance.md)，覆盖多选 OR/跨条件 AND、包含/等于、URL/保存恢复、非法参数防护、手机布局及账户/日志回归。

## 共享内容刷新（2026-11-11）

浏览器验收 24 项通过（World / Starter 主流程 21 项、平台复用页与两种工作室 3 项）。入口与重复执行步骤见 [scripts/e2e/README.md](./scripts/e2e/README.md)，共享组件契约见 [packages/ui](./packages/ui/README.md)。

实测 URL：World `http://127.0.0.1:36005/workspace/#/app/o2/0`、`#/app/p-model/1`、`#/app/p-studio/0`、`#/app/p-studio/1`；Starter `http://127.0.0.1:38140/`、`/assets`、`/accounts`、`/audit`。覆盖真实 API 与 IndexedDB 重读、首次加载、并发、快速请求、失败/重试、离开页面、移动端、减少动态效果。故障/延迟只在测试页注入；正常结果由原本的数据源返回。

## 资产自然语言筛选（2026-11-16）

本地 UI SDK + Magpie `minimax/MiniMax-M3`：主流程 14 项、边界 12 项、API 11 项、Agent 动作变异验证 1 项通过。主流程使用真实模型和工具结果回传；网络失败和迟到响应仅在本任务测试标签页注入，不替换成功结果。

入口 `http://127.0.0.1:38140/assets`，API `38141`，仅回环监听的主机 Magpie 转发 `38142`。重复执行方式见 [scripts/e2e](./scripts/e2e/README.md)，完整请求/回执、桌面/手机截图和修订口径见 [验收记录](./evidence/asset-agent/acceptance.md)。本轮未提交、推送或部署。

## 筛选输入与刷新保留修复（2026-11-16）

16 项本地浏览器 E2E 通过：搜索语义与 1Password 官方忽略属性、空行、顺序、草稿、匹配方式、多选、数据刷新与浏览器重载、关键词重新进入恢复、显式 URL 优先、清空、损坏缓存、登录自动填充边界；另含同一 Magpie MiniMax-M3 的真实工具调用、回执与模型筛选重载恢复。

脚本 `scripts/e2e/filter-state.mjs`，重复执行和 `withModel` 选项见 [scripts/e2e](./scripts/e2e/README.md#筛选输入与刷新状态)。刷新前后真实产品截图、URL、前置失败与通过结果见 [验收记录](./evidence/filter-state/acceptance.md)。不新增单元测试，不提交、推送或部署。

本机结果与产品截图：`/Users/steve/.codex/visualizations/2026/11/10/01a1c47f-0353-7d32-a719-a8ba463e3380/world-refresh-components/`（`results.json`、`module-results.json`）。全工作区 `bun run check-types` 与 `bun run build` 通过；首次本机缺少忽略的 env 生成文件，按 `bun run env:generate` 补齐后复验通过。无新增依赖；未发布线上。


### 2026-11-16：三级侧栏与顶部 Tab Demo（历史，已由二级规则取代）

- 本地页面：`http://127.0.0.1:38140/demo/navigation?tab=pending`，桌面 1440×960、手机 375×812；实际浏览器角色为本地管理员。
- `scripts/e2e/navigation-demo.mjs`：18 项 PASS，覆盖三级导航、真实资产行、Tab 鼠标/键盘/Agent 切换、URL 规范化与刷新、历史替换、快速导航、折叠与移动端。
- 从资产页启动 `scripts/e2e/filter-state.mjs`，`withModel: true`：16 项 PASS，包含真实 Magpie 模型、工具回执、筛选草稿与已应用状态恢复，以及 1Password 忽略标记和登录自动填充边界。
- 静态检查 `bun run --filter web check-types`（含 Vite 构建与 TypeScript）退出 0；本地前端镜像重建退出 0；`git diff --check` 退出 0。
- [验收记录与复跑方式](./evidence/navigation-demo/acceptance.md)、[导航结果](./evidence/navigation-demo/final/results.json)、[筛选回归结果](./evidence/navigation-demo/filter-regression/results.json)。截图已实际查看，URL 记录在结果文件中。
- 无新增业务写入、无提交、无推送、无部署；成员专属登录旅程和生产环境本轮未验收。


### 2026-11-16：二级侧栏与 World Model Tab（历史，侧栏改色已撤回）

- Steve 更正导航上限为二级：Demo → 资产视图；第三级及更深层移到顶部 Tab。当前规范见 [DESIGN](./DESIGN.md#页内导航与标签)，此前三级记录仅保留历史。
- 本地 `http://127.0.0.1:38140/demo/navigation?tab=pending`；桌面 1440×960、手机 375×812，本地管理员。
- `scripts/e2e/navigation-demo.mjs`：22 项 PASS，含二级结构、World Model 实际计算样式、键盘、Agent、URL/刷新、折叠和手机布局。
- `scripts/e2e/filter-state.mjs`：14 项 PASS，覆盖筛选持久化、输入忽略 1Password 以及登录自动填充；本轮只变更导航及样式，未重复调用模型。
- `bun run --filter web check-types`（Vite 构建与 TypeScript）、本地 web 镜像重建、`git diff --check` 均退出 0。
- [当前验收记录](./evidence/navigation-demo-v2/acceptance.md)、[导航结果](./evidence/navigation-demo-v2/final/results.json)、[筛选回归](./evidence/navigation-demo-v2/filter-regression/results.json)。四张产品截图均含 URL。
- World Model 本地 36001/36005 未启动，本轮只核对其源码，不修改或启动该项目；未提交、推送或部署。成员登录旅程与生产验收未运行。


### 2026-11-16：恢复 Starter 侧栏并压缩页面顶部（当前）

- 六个桌面页面与三个手机页面逐页采集坐标、产品截图及 URL；`scripts/e2e/page-layout.mjs` 共 28 项 PASS。
- 桌面各页首块内容 y=100 → 68px，手机 y=88 → 68px。Tab 面板桌面 y=173 → 121px、手机 y=165 → 125px。侧栏恢复 240px 浅色、原文字/选中样式及全局品牌色；World Model 蓝色仅留在右侧 Tab。
- 导航 E2E 22 项 PASS，筛选持久化/密码管理器边界回归 14 项 PASS，共 64 项。实际浏览器为本地管理员；模型和后端本轮未修改、未重复调用模型。
- Vite 构建和 TypeScript、前端本地镜像重建、`git diff --check` 均退出 0。未提交、推送或部署。
- [当前验收记录](./evidence/page-layout/acceptance.md)、[页面坐标与截图](./evidence/page-layout/final/results.json)、[导航回归](./evidence/page-layout/navigation/results.json)、[筛选回归](./evidence/page-layout/filter-regression/results.json)。


### 2026-11-16：登录品牌与新背景（已完成 4K 导出）

`login-brand.mjs` 五种视口共 21 项 PASS：真实产品 Logo 无外框、标题、154 字价值介绍、实际 3840×2160 背景、桌面/平板/手机布局、必填反馈、密码显示、自动填充和键盘操作。背景使用内置 imagegen 新绘，原图 1672×941；按 Steve 确认，用本地高质量缩放导出 4K，不称作原生 4K。Vite 构建、本地 web 重建和 diff 检查通过；最新全量 TypeScript 检查退出 2，错误在本轮未修改的 CRUD、日志和工作台类型，未覆盖相关改动。登录 UI 为 21 项 PASS，不等同全量工作区检查通过。未提交或部署。见 [最终验收记录](./evidence/login-brand/acceptance.md)。


### 2026-11-16：UI SDK 项目技能与默认路由

- 新增 `.agents/skills/starter-ui-sdk/`，保留上游 7 份参考文件与 Apache-2.0 许可证，增加项目接入指南和自动调用元数据；AGENTS、README、PROJECT、FRONTEND 与两个示例模块已接入同一入口。
- `skill-creator/scripts/quick_validate.py`：退出 0。YAML 元数据、150 条本地链接、实际路由/导航/Agent/E2E 入口、版本一致性、上游引用校验和、无外部符号链接/个人目录依赖、Git 未忽略检查均通过。
- 四类任务完成静态路由走读：新增 Tabs 页面、自然语言筛选、仅样式/文案、仅后端鉴权。自动调用配置为 true；当前父目录会话的技能选择器未实测，不声称已原生列出。
- 本轮只修改技能与文档；产品 E2E 为 NOT_RUN，未新增产品截图、未重新构建运行时、未提交或部署。详见 [验证记录](./evidence/ui-sdk-skill/acceptance.md) 与 [静态校验数据](./evidence/ui-sdk-skill/verification.json)。


### 2026-11-16：Starter SVG 浏览器标签变体

新增可编辑四瓣/向前切口 SVG 及同款 PNG/ICO，标签标题为 `Optimax Starter`。`favicon.mjs` 共 8 项浏览器 E2E PASS，含实际资源 MIME、16/32px 绘制与刷新；Vite 构建和 diff 检查退出 0。产品截图与 URL、图标预览见 [本轮验收](./evidence/favicon/acceptance.md)。未改登录主 Logo 或侧栏，未提交或部署。

### 2026-11-16：Starter 内页 Logo 同步

`product-brand.mjs` 共 22 项浏览器 E2E PASS：六个内页、展开/折叠/刷新、手机抽屉、内容刷新与 Demo 品牌一致，登录页保留原 OptiMax Logo。真实本地 API 刷新恢复通过；前端 Vite 构建和 TypeScript、diff 检查退出 0。截图、URL 与复验方式见 [验收记录](./evidence/product-brand/acceptance.md)。未提交、推送或部署。


### 2026-11-16：脚手架 P0/P1 模块化提效与 CI/CD 落地

- **清理与共享契约**：移除未使用的 `todo` 数据表导出（通过 `drizzle.config.ts` `tablesFilter: ["!todo"]` 兼容存量本地数据卷）、闲置 tRPC 路由与前端暗色切换死代码；将 `@optimax-starter/api` 统一为前后端共享 Zod 契约层。全工作区 `bun run check-types` 与 `bun run build` 退出 0。
- **配置收口、一键派生与模块生成器**：新增 `.env.example`、`scripts/bootstrap-project.sh`、`scripts/gen-module.mjs`、前端 `app-config.ts`（统一侧栏、抽屉与 `Cmd+K` 注册表，支持 `VITE_ENABLE_DEMOS`）及 `ResourceTableSlot`；后端 `console.ts` 拆分为 `core/` + `modules/`，新增 `/healthz`、`/console/auth/providers`、`/console/assets/page` 服务端分页筛选及管理员资产 CRUD + `auditResource` 同事务操作日志。隔离临时目录实跑 `bootstrap-project.sh`、`gen-module.mjs vendors`（含全量 `check-types` 与 `build`）及 `deploy-production.sh --check` 拒绝/放行用例 5 项 PASS（见 [tooling-e2e.json](./evidence/starter-optimization/tooling-e2e.json)）。
- **Docker 分层缓存、热更新与生产镜像**：重写 `Dockerfile` 分离依赖清单层并启用 `compose.override.yaml` 源码级热更新（保留容器内 Linux 原生 `node_modules`）。实测构建耗时：冷构建 `13.62s` → 完全缓存 `1.94s` → 业务源码变更命中 `bun install` 缓存重建 `3.70s`；生产多阶段 `Dockerfile.prod` 冷构建 `15.55s` → 热缓存 `2.18s`（见 [docker-build-timings.json](./evidence/starter-optimization/docker-build-timings.json)）。
- **CI/CD 门禁**：落地 `scripts/ci-scope.mjs`（前置失败验证后实现，6 项真实 git 进程回归 `scripts/e2e/ci-scope-e2e.mjs` PASS）、`.github/workflows/ci.yml`、`.github/workflows/deploy-production.yml`、`compose.prod.yaml` 与 `scripts/deploy-production.sh`。
- **HTTP 与真实浏览器 E2E 回归**：
  - Python HTTP 全套（`verify-console.py` 含 `/healthz`、资产 CRUD、服务端分页与审计闭环，`verify-foundation.py` + `--cleanup`，`verify-easm-settings.py` + `verify-easm-rollback.py` + `--cleanup`，以及 `verify-runtime-load.py` 8 并发 1,200 请求 `0.7s`）全部 PASS（见 [python-http-e2e.log](./evidence/starter-optimization/python-http-e2e.log)）。
  - Ego Browser 真实浏览器验收：`page-layout.mjs` 28 项 PASS、`navigation-demo.mjs` 22 项 PASS、`filter-state.mjs` 13 项 PASS、新增资产弹窗脏改动拦截/创建/编辑/删除二次确认/操作日志展示 5 项 PASS，合计 **68 项浏览器断言 PASS**，桌面与移动端截图已实际核验且临时验收资产已清理（见 [验收记录](./evidence/starter-optimization/acceptance.md)）。
- **边界状态**：仅本地修改与验证；未执行 `git commit`、`git push`，未触发远端 GitHub Actions 或生产服务器发布。
