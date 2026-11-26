# 从上游 OptiMax Starter 同步底座更新

本仓库由 `bootstrap-project.sh` 派生时会在根目录生成 `.starter-version`，记录：

- `STARTER_REPO`：上游模板仓库地址（Git URL 或本机克隆路径）
- `STARTER_COMMIT`：当前业务项目已同步到的上游提交 SHA
- `STARTER_SLUG`：派生项目标识

## 1. 预览上游变更（推荐先跑 dry-run）

```bash
bun run upgrade:starter -- --dry-run
# 如需指定本地预研中的 Starter 工作区：
bun run upgrade:starter -- --dry-run --source /path/to/optimax-starter --to WORKTREE
```

`--dry-run` 不会写入任何文件，仅按目录边界分类列出：

- **新增（`+`）**：上游新增的共享组件、工程脚本或核心辅助模块
- **三路合并（`M`）**：通过 `git merge-file` 对底座文件与中心文件做自动合并
- **保护跳过**：业务专有目录（`apps/server/src/modules/` 除核心底座外、业务页面路由、`packages/db/src/migrations/`、`app-config.ts`、`dashboard/registry.ts`、`README.md`、`AGENTS.md` 等）永不覆盖
- **裁剪跳过**：若项目初始化时运行过 `--no-example` 或 `--no-agent`，合并器会在比对前自动剥离上游对应示例/助理标记块，避免把已移除代码重新带回

## 2. 执行同步与应用

确认 dry-run 清单符合预期且不存在冲突后执行：

```bash
bun run upgrade:starter -- --apply
```

同步完成后请按顺序验证：

```bash
bun install
bun run lint
bun run test
bun run check-types
bun run db:check
```

若某个中心文件（如 `packages/api/src/contracts.ts` 或 `apps/server/src/console.ts`）同时被上下游改动同一相邻行，工具会中止写入并在终端标出 `! <path> (冲突)`（退出码 `2`），可加 `--allow-conflicts` 写入三路冲突标记后手工解决。
