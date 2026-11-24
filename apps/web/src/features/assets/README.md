# 资产台账

台账继续使用真实 `/console/assets` 数据、TanStack Table、动态 `FilterBar` 和 URL 查询参数同步。筛选语义与持久化规则见 [FILTERS](../../../../../FILTERS.md)；资产智能问答与筛选调整已统一收拢到右上角「问助理」全局抽屉（可随 `--no-agent` 剥离）。

筛选条件、顺序、空行和未应用草稿按账户保留，刷新后恢复；草稿不会自动变成已应用条件。具体键与 URL 优先规则见 [刷新恢复](../../../../../FILTERS.md#刷新恢复与输入语义)。

## 页面与组件结构

- `AssetsPage.tsx`：基于 [ResourceTableSlot](../../components/crud/README.md) 构建。成员仅可查看与筛选；管理员额外展示右上角「新增资产」「批量导入」按钮与行尾「编辑 / 删除」操作；右侧 `DetailDrawer` 顶部操作栏同步提供「编辑 / 删除」，左下角支持「上一个 / 下一个」记录切换，抽屉内挂载附件上传/下载；`AssetFormDialog.tsx` 复用 `@optimax-starter/api` 的 `assetInputSchema` 并内置未保存离开拦截与触发按钮焦点归还。
- 本地演示数据：服务端（`apps/server/src/modules/assets.ts`）幂等预置 1,000 条覆盖多业务域与责任团队的模拟资产记录（`AS-001` 至 `AS-1000`），便于服务端分页、排序与全量导出测试。
- 导出菜单：工具栏右侧通过共享的 `TableExportMenu` 提供纯图标导出按钮（仅显示下载图标，无触发文字与箭头），点击弹出「导出当前页 CSV」与「异步导出全部」菜单项。
- 可选助手入口：页头通过 `@starter:agent-start/end` 标记接入 `AskAssistant`，`--no-agent` 导出时自动移除。

## 服务端 AI 接口兼容

`packages/api/src/asset-agent.ts` 与 `apps/server/src/asset-agent.ts` 保留 `/console/assets/agent/config`、`/plan`、`/result` 接口及其严格参数校验与审计记录，供服务端测试与 `scripts/e2e/ai-client` 验证；AI 客户端接入与环境变量说明见 [部署文档](../../../../../DEPLOYMENT.md#可选服务端模型-api) 与 [AI 模块](../../../../server/src/core/ai/README.md)。

## 台账写接口与服务端分页参考接口

- 写接口（仅管理员，均在 `ADMIN_LOCK` 咨询锁事务内执行并由 `auditResource` 追加 `asset.create / asset.update / asset.delete` 日志）：`POST /console/assets`、`PATCH /console/assets/:id`、`DELETE /console/assets/:id`。
- 大规模数据参考接口：`GET /console/assets/page` 支持 `q`、`qOp`（`contains` / `equals`）、多值 `stage`、多值 `domain` 及 `page` / `size` 服务端 SQL 分页过滤，返回 `{ items, total, page, size }`。

## 验收

E2E 入口与证据统一见 [TESTING](../../../../../TESTING.md) 和 [脚本说明](../../../../../scripts/e2e/README.md)。不读取或修改 `dist/*.js`。
