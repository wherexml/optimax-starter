# CI/CD 最佳实践 Spec

> 本文件是 OptiMax 团队新项目的 CI/CD 规范模板。它定义持续集成门禁、部署触发、Runner、权限和流水线结果。实际部署与恢复操作统一维护在 [DEPLOYMENT.md](./DEPLOYMENT.md)。复制到目标项目根目录后，先补齐「CI/CD 事实卡」，再按项目真实技术栈改写命令。
>
> 本规范参考团队成熟项目的生产部署经验，但不要求未来项目使用同一语言、框架、端口、目录或服务器形态。可以替换技术栈，不能降低安全、可回滚、可验证和运行态保护标准。
>
> 团队通用红线（不提交密钥/token/运行态数据、生产默认只读等）以 [AGENTS.md 核心约束](./AGENTS.md#核心约束) 为唯一正文，本文件不再重述，只补充 CI/CD 领域细则。

---

## 1. 适用范围

以下项目必须维护本文件：

- 有生产环境、演示环境或长期运行环境的项目。
- 有 GitHub Actions、GitLab CI、Jenkins、Drone、Buildkite 或同类流水线的项目。
- 有前端构建、后端服务、Worker、Agent、定时任务、数据同步任务的项目。
- 需要多人协作、自动化测试、自动部署、回滚或生产验收的项目。

以下项目可以标记为「不适用」，但仍建议保留文档入口：

- 一次性脚本、研究草稿、不会部署的临时实验。
- 纯文档仓库、纯设计稿仓库。
- 尚未接入 CI/CD 的早期项目。此时应写清当前状态和计划接入条件。

---

## 2. CI/CD 事实卡

> 事实卡必须来自真实仓库文件、流水线配置、部署脚本、运行态路径和生产验证记录。不要凭记忆填写。

| 项 | 当前项目事实 | 证据路径 |
| --- | --- | --- |
| 默认分支 | <!-- main / master / release/... --> | <!-- .git / 远程仓库设置 --> |
| CI 平台 | <!-- GitHub Actions / GitLab CI / Jenkins / 无 --> | <!-- .github/workflows/... --> |
| CI Workflow | <!-- 名称和路径 --> | <!-- 补充 --> |
| Deploy Workflow | <!-- 名称和路径；未配置写未配置 --> | <!-- 补充 --> |
| 部署触发 | <!-- CI 成功后 / 手动 dispatch / tag / release --> | <!-- 补充 --> |
| 生产环境名称 | <!-- production / prod / 未配置 --> | <!-- 平台 environment 设置 --> |
| Actions 用量情况 | <!-- 当前套餐额度、用量 --> | <!-- 组织 Billing 页面 --> |
| CI / AI Review Runner | <!-- hosted / self-hosted / 容器镜像 --> | <!-- 补充 --> |
| Deploy Runner | <!-- self-hosted labels / SSH 目标 / PaaS --> | <!-- 补充 --> |
| 部署脚本 | <!-- scripts/deploy*.sh / Makefile / 平台配置 --> | <!-- 补充 --> |
| 部署手册 | [DEPLOYMENT.md](./DEPLOYMENT.md)：环境、变量、运行态、检查和恢复 | <!-- 真实脚本或平台入口 --> |

---

## 3. 核心原则

1. CI 和部署分离。CI 负责证明代码可合并，部署负责把已验证版本安全落到目标环境。
2. 生产变更只调用 DEPLOYMENT.md 登记的部署入口，运行态保护由部署脚本落实。
3. 发布目标绑定已验证 commit、镜像 digest 或制品校验，避免 CI 后版本漂移。
4. 根据部署手册完成预检与健康门禁，失败时不能继续标记成功。
5. 回滚复用登记入口，流水线记录触发、结果及恢复状态。
6. 流水线权限最小化。CI token、部署 token、生产密钥只在必要步骤可见。
7. 验收必须接近真实用户路径。只检查构建成功不等于上线成功。
8. 失败要可解释。日志、错误原因、回滚状态和下一步处理必须能从流水线记录中看到。

---

## 4. 标准流水线

推荐的完整链路：

```text
本地验证
  -> 提交 / Pull Request
  -> CI 质量门禁
  -> 后端测试 / 前端构建 / Worker 检查 / 文档检查
  -> CI 通过
  -> 触发部署
  -> 调用 DEPLOYMENT.md 中登记的部署入口
  -> 收集版本、健康检查与冒烟结果
  -> 成功则记录发布；失败则按恢复策略调用恢复入口
```

项目可以按实际情况裁剪，但必须保留四个闭环：

- 合并前有 CI 门禁。
- 部署前保护运行态。
- 部署后做真实健康检查。
- 失败后有明确回滚路径。

---

## 5. CI 门禁规范

> 测试策略以 [TESTING.md](./TESTING.md) 为准：CI 中的行为测试以 E2E 为主（真实启动的服务、测试数据库和浏览器）；已有隔离测试继续维护和运行，不因新规范删除或停跑；新增隔离测试必须在实现前先写失败用例。lint、类型检查、构建是静态检查，通过不等于验收。

### 质量门禁

每个项目至少应有一个轻量质量门禁，优先检查这些内容：

- 仓库中没有被追踪的 `.env`、真实密钥、token、生产账号、运行态数据库、日志和构建产物。
- 部署脚本、运维脚本和关键 shell 脚本能通过语法检查。
- 变更文件通过对应语言的最小 lint、format 或类型检查。
- 文档没有明显格式错误，例如尾随空格、坏链接、过期命令。
- 包管理锁文件和依赖定义一致。

示例检查项：

```bash
git diff --check
bash -n scripts/deploy-production.sh
```

### 后端门禁

后端门禁按项目语言替换。下列测试命令仅用于项目已有测试或符合 TESTING.md 的隔离测试，不要求实现后补写单测；行为验收仍须另行执行 E2E：

- Python：`compileall`、`pytest`、`ruff` 或等价工具。
- Node.js：`typecheck`、`test`、`lint` 或等价工具。
- Go：`go test ./...`、`go vet` 或等价工具。
- Java：`mvn test`、`gradle test` 或等价工具。

后端接口级 E2E（针对真实启动的服务和测试数据库）至少覆盖：

- API 响应格式和错误码。
- 鉴权和权限边界。
- 核心 service 规则。
- 数据库读写和迁移。
- 后台任务、队列、Agent 或外部系统的关键路径。

### 前端门禁

前端门禁至少覆盖：

- 类型检查。
- 构建。
- 关键页面 E2E。
- 路由、权限态、空态、错误态的基本检查。

示例：

```bash
pnpm install --frozen-lockfile
pnpm build
```

### Worker / Agent 门禁

如果项目有 Worker、Agent、爬虫、同步任务或模型服务，需要单独检查：

- 默认配置能 dry-run。
- 任务入口能启动。
- 类型检查能通过；已有隔离测试能通过。
- 必要的 Compose、Dockerfile 或进程配置能被解析。
- 默认工作区、默认数据源、默认工具链没有漂移。

### 并发控制

CI 可以对同一分支取消旧任务，避免浪费资源：

```yaml
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
```

部署任务不要取消正在进行的生产部署：

```yaml
concurrency:
  group: production-deploy
  cancel-in-progress: false
```

---

## 6. Deploy Workflow 规范

### 触发方式

推荐保留两种触发：

- 自动触发：默认分支 CI 通过后自动触发生产部署。
- 手动触发：允许选择 ref 或回滚版本，用于救援和指定版本发布。

GitHub Actions 参考结构：

```yaml
name: Deploy Production

on:
  workflow_run:
    workflows: ["CI"]
    types: [completed]
    branches: [main]
  workflow_dispatch:
    inputs:
      ref:
        description: "Commit SHA, branch, or tag to deploy"
        required: false
      rollback_commit:
        description: "Commit SHA used for manual rollback"
        required: false

permissions:
  contents: read

concurrency:
  group: production-deploy
  cancel-in-progress: false
```

### 目标版本选择

部署前必须明确目标版本：

- 自动部署使用触发 CI 的 commit SHA。
- 手动部署使用输入 ref。
- 手动回滚使用输入 rollback commit。
- 不允许空 ref、非法 ref 或未经验证的 shell 拼接。

### Runner 选型与隔离

### 决策表

| 场景 | 选择 | 说明 |
| --- | --- | --- |
| lint / test / build | GitHub hosted runner | 默认选择，零维护 |
| AI Review | GitHub hosted runner | AI 计算在 API 侧，runner 无算力要求 |
| 部署到自有服务器 | self-hosted runner | 装在目标服务器或可达内网的机器上 |
| CI 需要访问内网资源（私有库、内网 API） | self-hosted runner | 无法用 hosted 时才用 |
| 构建极重 / 需要 GPU / 分钟数额度不够 | self-hosted 或付费更大规格 | 出现真实瓶颈后再上，不提前优化 |

### 私有仓库注意事项

- 私有仓库的 hosted runner **消耗 Actions 分钟数额度**（额度以账户当前套餐为准）。事实卡中记录当前用量；接近额度时先做减法（并发取消、缓存、只在 PR 和默认分支触发），再考虑付费或 self-hosted。
- 私有仓库使用 self-hosted runner 的外部代码风险低于 public 仓库，但仍必须遵守下面的隔离规则。

### self-hosted runner 隔离规则

如果配置 self-hosted runner，必须区分 CI 与部署用途：

1. **为部署 runner 打专属 label**（如 `deploy-prod`），只有部署 workflow 通过 `runs-on` 使用；独立 CI runner 不可复用该 label 或生产权限。
2. **不用部署 runner 跑 PR 代码**：部署 workflow 只在合入后的默认分支触发；PR 阶段默认使用 hosted runner；确需内网或 GPU 时使用独立、无生产权限的 CI runner。
3. runner 机器上的生产密钥、`.env`、部署脚本权限遵守 `cicd-spec.md` §10。
4. runner 是单点：写清谁负责保活、升级 runner 版本和清理磁盘；离线时的处理原则见 `cicd-spec.md` §14（不改用本机手工覆盖生产）。

### 团队默认结论

**CI 和 AI Review 默认用 hosted runner；部署到自有服务器时使用专属部署 runner，且只在合入后的默认分支运行。** 偏离此默认需在 SPEC_ADOPTION.md 记录原因与证据，事实卡记录最终配置。


### Runner 要求

部署 Runner 必须写清：

- Runner 类型：self-hosted、SSH 远程、PaaS、容器部署或云平台部署。
- Runner labels 或部署目标。
- Runner 上必须存在的工具：`git`、`curl`、`rsync`、`tar`、`python3`、`docker`、`pnpm`、`uv` 等按项目实际填写。
- Runner 能访问生产目录、私有配置、运行态数据和服务管理命令。

### Environment 保护

生产部署建议绑定平台的 production environment：

- 环境密钥只放 production environment。
- 高风险项目可开启人工审批。
- 部署历史由平台记录。
- 变量名、用途和配置引用必须在 DEPLOYMENT.md 记录；secret 的真实值不进入仓库文档。

---

## 7. 调用部署入口

流水线只调用 [DEPLOYMENT.md §3](./DEPLOYMENT.md#3-可执行操作入口) 登记的部署入口，并传入目标环境、已验证的不可变制品/commit 和配置引用。运行环境、变量清单和注入、生效方式、备份、迁移、重启顺序均由该手册维护，不在 workflow 文档中复制。

## 8. 发布结果门禁

部署入口必须返回失败状态；流水线收集版本、健康检查与冒烟证据，只有 [DEPLOYMENT.md §5](./DEPLOYMENT.md#5-健康检查和冒烟验证) 通过才标记发布成功。构建通过不能替代线上检查，证据格式见 TESTING.md。

## 9. 回滚编排

失败时调用 DEPLOYMENT.md 登记的恢复入口，记录目标版本及结果。自动回滚的适用条件、数据兼容性和人工处理步骤以 [DEPLOYMENT.md §6](./DEPLOYMENT.md#6-回滚与数据恢复) 为准；不能在流水线临时拼一套恢复命令。

---

## 10. 密钥和权限

### 禁止进入仓库

> 通用红线「不提交 `.env`、密钥、token、真实密码、生产/客户/第三方账号、运行态数据库、日志、构建产物」以 [AGENTS.md 核心约束](./AGENTS.md#核心约束) 为准。CI/CD 领域额外补充：

- 含真实用户数据的导出报告不得进入仓库。
- CI 平台生成的临时凭据（如 deploy token）不得提交，也不得残留在 Git remote、shell history、构建产物、日志或配置文件中。

### Secrets 管理

CI/CD secrets 应按环境隔离：

- CI 只拿测试依赖所需的最小权限。
- Deploy 才能拿生产部署所需 secret。
- 生产 secret 绑定 production environment。
- 日志中不得打印 secret、token、cookie、Authorization header。

### Token 清理

部署阶段若需拉取仓库或下载脚本，部署后必须清理临时 token（不写入 Git remote、shell history、构建产物、日志或配置文件），具体要求见上方「禁止进入仓库」第 2 条。

---

## 11. 本地等价验证

本地检查命令、依赖、安全配置及轻量/完整模式统一维护在 [TESTING.md](./TESTING.md)。workflow 复用相同脚本；本文件只记录门禁与 job 的映射，不再维护第二套命令。部署预检与执行入口见 [DEPLOYMENT.md](./DEPLOYMENT.md)。

---

## 12. 新项目初始化清单

新项目接入 CI/CD 时，至少补齐：

- `.github/workflows/ci.yml` 或等价 CI 配置。
- `.github/workflows/deploy-production.yml` 或等价部署配置；未接入生产时写明未配置。
- `scripts/deploy-production.sh` 或等价部署入口。
- `.env.example` 和私有配置说明。
- 健康检查接口。
- 前端构建命令。
- 后端接口级 E2E 命令。
- Worker / Agent 检查命令，若不适用写明。
- 运行态保护清单。
- 回滚入口和回滚验证清单。
- 本地等价验证命令。
- E2E 验收证据的存放位置（见 TESTING.md）。

---

## 13. 发布收尾流程

生产相关改动完成后，推荐按以下顺序收尾：

1. 查看工作区状态，确认没有误改和敏感文件。
2. 查看关键 diff，确认部署脚本、workflow、文档和代码改动一致。
3. 运行本地等价验证。
4. 提交中文 commit message，写清日期、改动内容和原因。
5. 按 [协作规范](./collaboration-spec.md) 的分支与 PR 流程推送、审查和合并；本文件不另定合并策略。
6. 跟踪 CI 到成功。
7. 如配置自动部署，继续跟踪 Deploy workflow。
8. 部署成功后做生产只读健康检查和核心页面检查。
9. 将异常、回滚或人工处理记录回项目文档。

推荐检查命令：

```bash
git status --short
git diff --stat
git diff --check
```

---

## 14. 故障处理

| 故障 | 优先检查 | 处理原则 |
| --- | --- | --- |
| CI 质量门禁失败 | changed files、lint、脚本语法、敏感文件 | 修代码或文档，不跳过门禁 |
| 后端测试失败 | 失败测试、依赖服务、环境变量 | 先复现，再修根因 |
| 前端构建失败 | 类型错误、依赖锁文件、环境变量 | 不用忽略类型错误上线 |
| 部署 Runner 离线 | Runner 服务、labels、权限 | 不改用本机手工覆盖生产 |
| 预检查失败 | 目标目录、工具、私有配置、数据目录 | 修改部署环境或配置后重跑 |
| 构建失败 | 锁文件、缓存、网络、版本 | 失败即停止，不发布半成品 |
| 服务重启失败 | systemd、容器、端口、日志 | 优先保留现场日志 |
| 健康检查失败 | API、网关、前端资源、Worker | 触发回滚或暂停发布 |
| 冒烟失败 | 登录态、权限、核心接口、页面错误 | 不把构建成功当上线成功 |
| 回滚失败 | 上一版本、脚本、运行态备份 | 立即升级人工处理并保留日志 |

---

## 15. 反模式

以下做法应避免：

- CI 只跑构建，不跑任何后端、权限或核心链路检查。
- 部署脚本直接 `git pull` 后重启，没有备份、没有健康检查。
- 生产目录被整目录覆盖，导致 `.env`、数据、日志丢失。
- 失败后 SSH 手工复制文件修生产，但不记录 commit 和部署版本。
- 把真实生产 secret 写入 workflow、README、截图或日志。
- 用前端页面是否打开代替 API、权限、Worker 和数据检查。
- 回滚只回代码，不考虑数据库迁移和运行态数据。
- 自动部署会取消正在运行的生产部署。

---

## 16. 文档同步

更新 CI/CD 时，必须同步：

- `AGENTS.md` 的任务索引；部署事实维护在 DEPLOYMENT.md，验收细则维护在 TESTING.md。
- 本文件的 workflow、Runner、触发、门禁和部署调用入口。
- `.env.example` 和私有配置说明。
- DEPLOYMENT.md 的环境变量、部署步骤、运行态保护、健康检查和恢复入口。
- TESTING.md 的验证入口及与 CI job 的映射；不在领域文档复制命令。

如果项目尚未接入 CI/CD，不要删除本文件，写明：

- 当前为什么未接入。
- 目前如何发布。
- 哪些操作禁止直接做。
- 接入 CI/CD 的最小条件。
