# 模板基线与派生项目升级指南

通过 GitHub Template 创建新仓库后，提交历史会与 `optimax-starter` 分离。为避免后期底座修复、UI 组件或脚本升级时无从比对，项目在初始化时生成 `.starter-version` 文件，用于持续追踪派生所依据的模板提交。

## 1. `.starter-version` 字段说明

运行 `./scripts/bootstrap-project.sh <project-slug>` 时会在仓库根目录生成 `.starter-version`（只含非敏感元数据，建议提交到 Git 版本库）：

| 变量 | 含义 |
| --- | --- |
| `STARTER_REPO` | 初始化时记录的上游模板仓库地址或标识 |
| `STARTER_COMMIT` | 当前项目已对齐的模板 Git Commit SHA（初始化时可通过 `--starter-sha <sha>` 显式指定） |
| `STARTER_BOOTSTRAPPED_AT` | 派生初始化的 UTC ISO 时间戳 |
| `STARTER_SLUG` | 派生项目的 `project-slug` |

## 2. 目录归属边界

同步上游升级前，先区分三类目录的维护责任：

| 类别 | 包含路径 | 升级策略 |
| --- | --- | --- |
| **模板底座（推荐同步）** | `apps/server/src/core/`（含 `job-policy.ts`、`attachment-registry.ts`、`seed.ts` 注册表）、`apps/server/src/modules/` 中的核心模块（`accounts`、`attachments`、`audit`、`auth`、`jobs`、`system`、`tokens`）、`packages/db/src/schema/console.ts`、`packages/api/src/contracts.ts` 等核心契约、`packages/ui/`、`apps/web/src/components/`、`apps/web/src/features/dashboard/DashboardPage.tsx`、`scripts/`（含 `gen-module.mjs`、`lib/`、`check-migrations.mjs`、`doctor.mjs`、`bootstrap-project.sh`、`deploy-production.sh`）、`docs/onboarding.html` | 重点查看上游 diff 并选择性同步；中心注册文件里的 `// @starter:*` 注释锚点必须保留 |
| **业务扩展（保留本地）** | `packages/db/src/schema/assets.ts` 与生成模块的 `schema/<slug>.ts`、`packages/api/src/<slug>.ts`、`apps/server/src/modules/assets*.ts` 与 `modules/<slug>.ts`、`apps/web/src/features/<业务>/`、`apps/web/src/features/dashboard/registry.ts`（含 `// @starter:dashboard-modules` 锚点）、`apps/web/src/routes/<业务>.tsx`、`packages/db/src/migrations/`、`scripts/verify-<slug>.py` | 承载业务表与页面，不整文件覆盖；只在需要通用新契约时手工挑选合并 |
| **派生独立配置（禁止覆盖）** | `.env`、`.starter-version`、`package.json`（项目名等）、`compose.yaml`（项目名与镜像名）、`apps/web/src/config/app-config.ts`、`apps/web/public/brand/` | 包含各项目端口、Cookie 名、品牌文案与业务导航，切勿整文件覆盖 |

中心注册文件（`schema/index.ts`、`packages/api/src/index.ts`、`contracts.ts`、`permissions.ts`、`apps/server/src/console.ts`、`app-config.ts`、`dashboard/registry.ts`）同时含底座与业务条目：业务条目位于 `// @starter:*` 锚点之前，示例模块被 `// @starter:example-assets-start` / `end` 包裹。合并时保留本地业务行与全部锚点，只吸收上游新增的核心行。

示例 `assets` 模块可在初始化时用 `--no-example` 移除（会生成 `remove_example_assets` 迁移）；移除后不要再同步上游的 `assets*` 文件。

## 3. 对比与同步步骤

在派生项目根目录执行以下流程，查看自上次对齐以来上游底座的变化并选择性同步：

```bash
# 1. 首次升级时关联上游只读 remote（若尚未添加）
git remote add starter https://github.com/wherexml/optimax-starter.git
git fetch starter

# 2. 读取当前已对齐的模板 Commit
set -a
source .starter-version
set +a

# 3. 仅查看模板底座目录的上游变更摘要与详细 diff
git log --oneline "${STARTER_COMMIT}..starter/main" -- \
  apps/server/src/core packages/ui apps/web/src/components scripts/

git diff "${STARTER_COMMIT}..starter/main" -- \
  apps/server/src/core packages/ui apps/web/src/components scripts/
```

确认需要同步的文件后，推荐按文件挑选检出或导出补丁合并，而非整库 merge：

```bash
# 方式 A：直接同步某个确定未做过本地魔改的底座文件或目录
git checkout starter/main -- packages/ui/src/components/detail-drawer.tsx scripts/gen-module.mjs scripts/lib/

# 方式 B：生成局部补丁后交互式应用（适合做过定制的文件）
git diff "${STARTER_COMMIT}..starter/main" -- apps/server/src/core/ | git apply -3
```

同步完成后运行全套质量检查与端到端验收：

```bash
bun run doctor     # 只读自检：Docker、端口、.env、迁移漂移、上游差距
bun run db:check   # schema 与已提交迁移一致；有变更先 bun run db:generate 并提交 SQL
bun run lint
bun run test
bun run check-types
docker compose up -d --build
python3 scripts/verify-console.py
```

验证全部通过后，将 `.starter-version` 中的 `STARTER_COMMIT` 更新为本次对齐的上游 `git rev-parse starter/main` 并提交即可。

## 4. 辅助工具

- `bun run db:check`：只读迁移漂移门禁（CI `quality` 同样执行），不写迁移文件、不连接数据库。
- `bun run doctor`：只读本地自检，输出 `PASS` / `WARN` / `FAIL` 与修复命令，不打印任何密钥。
- `docs/onboarding.html`：初始化工作台，覆盖新建项目、新增模块、上游升级与环境自查。直接打开（`file://`）为离线预览，只生成命令与 Agent 提示词，不执行、不收集密码。
- `bun run setup`：在 127.0.0.1 启动本地向导并以直连模式打开上述页面；「上游升级」页自动读取 `.starter-version` 与落后 `starter/main` 的提交数，可一键运行 `doctor` 与 `db:check`。向导只执行白名单命令，不做 git commit、push 或生产部署。三方合并 dry-run 辅助脚本计划在后续步骤提供。
