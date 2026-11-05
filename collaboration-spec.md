# 多人协作开发流程 Spec（分支 / PR / AI Review）

> 本文件是 OptiMax 团队多人维护同一仓库时的协作规范模板，覆盖分支策略、分支保护、PR 流程、AI Review；Runner 见 cicd-spec.md。复制到目标项目根目录后，先补齐「协作事实卡」，再按项目真实情况改写。
>
> CI 门禁与发布触发见 [`cicd-spec.md`](./cicd-spec.md)，部署、环境变量、运行态保护和恢复见 [DEPLOYMENT.md](./DEPLOYMENT.md)，本文件不重述；本文件只回答「多人怎么协作把代码安全合进主干」。
>
> 团队通用红线（先叫 Steve、不提交密钥/token/运行态数据、生产默认只读、改完必须验证等）以 [AGENTS.md 核心约束](./AGENTS.md#核心约束) 为唯一正文。

---

## 1. 适用范围

以下项目必须维护本文件：

- 两人及以上同时提交代码的仓库。
- 已接入或计划接入 CI / AI Review 的仓库。
- 有生产、演示或客户交付环境的仓库。

单人维护、无部署压力的实验性仓库可以标记为「不适用」，但一旦进入多人协作阶段必须补齐。

---

## 2. 协作事实卡

> 事实卡必须来自真实仓库设置、workflow 文件和平台配置，不要凭记忆填写。

| 项 | 当前项目事实 | 证据位置 |
| --- | --- | --- |
| 托管平台 | <!-- GitHub（private）/ GitLab / Gitea --> | <!-- 仓库地址 --> |
| 仓库可见性 | <!-- private / internal / public --> | <!-- 仓库设置 --> |
| 默认分支 | <!-- main --> | <!-- 仓库设置 --> |
| 集成分支 | <!-- dev / 无（直接 PR 到 main） --> | <!-- 分支列表 --> |
| 分支保护规则 | <!-- 已开启项 / 未配置 --> | <!-- Settings → Branches --> |
| 合并方式 | <!-- Squash / Merge commit / Rebase --> | <!-- 仓库设置 --> |
| CI Workflow | <!-- 名称和路径 --> | <!-- .github/workflows/... --> |
| AI Review 方式 | <!-- claude-code-action / 商业产品 / 未接入 --> | <!-- workflow 路径 --> |
| AI Review 是否门禁 | <!-- 仅评论 / Required check --> | <!-- 分支保护设置 --> |
| 人工 Reviewer | <!-- 谁有 approve 权限；CODEOWNERS 是否启用 --> | <!-- CODEOWNERS / 团队约定 --> |

---

## 3. 分支策略

### 基本规则

1. **禁止直接 push 默认分支和集成分支**（`main` / `dev`），所有改动必须通过 PR 合入。
2. 从最新集成分支拉出**短生命周期功能分支**，完成后尽快合并删除，不维护个人长期分支。
3. 个人长期分支容易变成「仓库里的私有仓库」，绕过 review 和 CI，属于反模式。

### 分支命名

| 前缀 | 用途 | 示例 |
| --- | --- | --- |
| `feature/` | 新功能 | `feature/supplier-import` |
| `fix/` | 修复 bug | `fix/login-redirect-loop` |
| `chore/` | 构建、依赖、杂项 | `chore/upgrade-pnpm` |
| `docs/` | 文档 | `docs/deploy-runbook` |
| `refactor/` | 重构 | `refactor/auth-middleware` |

### 分支模型选择

| 模型 | 适用 | 说明 |
| --- | --- | --- |
| 单主干（分支 → PR → `main`） | 团队小、发布频繁 | 默认推荐；`main` 始终可部署 |
| 主干 + 集成分支（分支 → PR → `dev` → 定期合入 `main`） | 需要攒一批改动统一发版 | `dev` 同样开启分支保护，`dev` → `main` 也走 PR |

项目采用哪种模型写入事实卡；同一项目不混用。

---

## 4. 分支保护规则

以下为默认分支（及集成分支）的**最低要求**，在平台仓库设置中开启：

- [ ] 必须通过 PR 才能合入，禁止直接 push（包括管理员，除非救援场景显式豁免）。
- [ ] 必须通过 Required Status Checks（至少包含 CI 主 workflow）。
- [ ] 至少 1 个人工 Approve 后才能合并。
- [ ] 新 push 使已有 Approve 失效（stale review dismissal），避免 approve 后又改代码直接合。
- [ ] 禁止 force push 和删除受保护分支。
- [ ] 可选：启用 CODEOWNERS，自动为关键目录指定 Reviewer。

没有分支保护，本文件其余流程都是自愿的，形同虚设。新项目初始化时这一步最先做。

---

## 5. PR 流程规范

### 标准流程

```text
从最新集成分支拉功能分支
  -> 本地开发，频繁 push
  -> 尽早开 PR（未完成用 Draft PR）
  -> CI 自动触发（lint / test / build，细则见 cicd-spec.md）
  -> AI Review 自动评论（见 §6）
  -> 开发者处理 AI 反馈：采纳或在评论中说明不采纳原因
  -> 人工 Reviewer 审查业务逻辑与架构
  -> CI 绿 + 人工 Approve -> Squash Merge
  -> 删除功能分支
```

### PR 要求

- **PR 保持小**：单个 PR 聚焦一件事，正文改动建议不超过约 400 行（生成物、锁文件除外）；大改动拆成多个 PR。
- **PR 描述必须写清**：改了什么、为什么改、怎么验证过（截图、测试输出或验证命令）。
- **尽早开 Draft PR**：让 CI 和 AI 尽早反馈，不要憋到最后一天。
- **合并方式默认 Squash Merge**：保持主干历史一条 PR 一个 commit；squash 后的 commit message 遵循团队中文 commit 规范（类型、日期、概述、提交人）。
- **禁止自己 approve 自己的 PR**；紧急救援需要绕过流程时，必须事后在 PR 或群里补记原因。

### Review 分工

| 角色 | 负责 | 不负责 |
| --- | --- | --- |
| CI | 编译、测试、lint、敏感文件检查 | 业务正确性 |
| AI Review | 常见 bug、错误处理缺失、安全隐患、性能反模式、规范一致性 | 深层业务逻辑、架构决策 |
| 人工 Reviewer | 业务逻辑是否正确、架构是否合理、需求是否真正实现、长期可维护性 | 重复 AI 已覆盖的机械检查 |

**AI Review 通过不等于可以合并，人工 Approve 是最终把关。** 涉及客户交付、数据安全、权限和生产配置的改动，人工 review 必须逐行看关键部分。

---

## 6. AI Review 规范

### 定位

AI Review 是 PR 流水线里的**第一道自动关卡**，目标是让人工 Reviewer 不用再抓低级问题，把精力留给业务和架构。它不替代人工 review。

### 触发与实现

- 触发时机：PR opened / synchronize（每次 push 自动重跑）。
- 团队默认实现：GitHub Actions 中调用 `anthropics/claude-code-action`，以 PR 评论形式输出逐条发现和总结。
- API key 通过仓库 / 组织 Secrets（如 `ANTHROPIC_API_KEY`）注入，不写入 workflow 明文，不打印到日志。
- 私有仓库代码会经 API 发送给模型服务方；如某项目有「代码不出域」的合规要求，在事实卡写明并改用私有部署方案，未确认前不接入。

参考 workflow 结构：

```yaml
# .github/workflows/ai-review.yml
name: AI Review
on:
  pull_request:
    types: [opened, synchronize]
concurrency:
  group: ai-review-${{ github.event.pull_request.number }}
  cancel-in-progress: true
jobs:
  review:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: anthropics/claude-code-action@v1
        with:
          anthropic_api_key: ${{ secrets.ANTHROPIC_API_KEY }}
          prompt: |
            按仓库根目录 AGENTS.md 和各专项 spec 审查本 PR：
            重点检查 bug、错误处理缺失、安全问题、性能反模式、
            与团队 API / 认证 / 前端规范的不一致。
            以 review 评论形式逐条给出：位置、问题、建议修法、严重程度。
```

### Review Prompt 要求

- Prompt 必须指向项目内真实规范文件（`AGENTS.md`、`API_CONVENTIONS.md`、`AUTH.md` 等），不要用泛泛的 "review this"。
- 团队规范更新后，检查 AI Review prompt 是否需要同步。
- 项目特有的重点检查项（如租户隔离、金额计算、权限边界）写进 prompt。

### 门禁策略（分阶段）

| 阶段 | 策略 |
| --- | --- |
| 引入期（前 1-2 个月） | 仅评论，不阻塞合并；开发者必须逐条处理：采纳，或回复说明不采纳原因 |
| 稳定期 | 团队认可误报率可接受后，可将「AI 判定存在严重问题」升级为 Required check |

未经过引入期评估，不直接把 AI Review 设为硬门禁——误报阻塞合并会让团队绕过整个流程。

### 开发者处理 AI 反馈的规则

- AI 指出的问题不允许无声忽略：要么修，要么在评论里写明为什么不修。
- AI 的建议与团队 spec 冲突时，以 spec 为准，并考虑是否需要改进 prompt。
- 发现 AI 反复误报同一类问题，反馈给规范维护人调整 prompt，而不是各自默默忽略。

---

## 7. Runner 入口

Runner 选型、权限隔离与事实卡统一维护在 [cicd-spec.md](./cicd-spec.md#runner-选型与隔离)。本文件只管理审查与合并流程。

---

## 8. 新仓库接入清单

按顺序执行：

1. 确认默认分支和分支模型（单主干 / 主干+dev），写入事实卡。
2. 开启分支保护（§4 清单逐项打勾）。
3. 确认 CI workflow 在 PR 上触发且覆盖 lint + test + build（细则见 `cicd-spec.md` §5）。
4. 配置 `ANTHROPIC_API_KEY` secret，添加 `ai-review.yml`，以「仅评论」模式接入。
5. 向团队同步流程：分支命名、PR 要求、AI 反馈处理规则。
6. 如涉及部署到自有服务器，按 §7 配置专属部署 runner。
7. 运行一次完整演练：开一个真实 PR，确认 CI、AI Review、人工 Approve、Squash Merge 全链路生效。
8. 补齐本文件事实卡，更新项目 `AGENTS.md` 的协作入口。

---

## 9. 反模式

以下做法应避免：

- 直接 push `main` / `dev`，或长期在个人分支上开发不合并。
- 巨型 PR 一次合入几千行，review 变成走过场。
- AI Review 评论无人处理，既不修也不回复。
- 未经引入期评估就把 AI Review 设为硬门禁，误报堵死合并通道。
- 用部署用的 self-hosted runner 跑 PR 阶段的代码。
- 把 API key 写进 workflow 明文或打印到日志。
- 自己 approve 自己的 PR，或用管理员权限绕过分支保护且不留记录。
- approve 之后继续 push 新代码直接合并（必须开启 stale review dismissal）。

---

## 10. 文档同步

更新协作流程时，必须同步：

- 本文件的事实卡、分支模型、门禁策略和 runner 结论。
- `cicd-spec.md` 的 CI workflow、Runner 和部署触发描述。
- 项目 `AGENTS.md` 的工作流入口。
- AI Review workflow 的 prompt 与团队规范的一致性。

如果项目尚未接入本流程，不要删除本文件，写明当前如何协作、哪些操作禁止直接做、以及接入的计划条件。
