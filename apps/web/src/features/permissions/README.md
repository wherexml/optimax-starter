# 系统权限（`/permissions`）

提供「模块 × 角色（成员 / 管理员 / 超级管理员）」可视化权限矩阵，吸收公司生产项目经验将底层细粒度权限码映射为直观的「查看 / 操作」双按钮，仅对 `super_admin` 开放查看与维护。认证与角色提权边界总览见 [AUTH.md](../../../../../AUTH.md)。

## 组成与契约

- 共享目录与映射：[packages/api/src/permissions.ts](../../../../../packages/api/src/permissions.ts) 定义 `PERMISSION_CATALOG`、`DEFAULT_ROLE_PERMISSION_CODES`、`SUPER_ADMIN_ONLY_PERMISSIONS` 与 `SYSTEM_PERMISSION_ROWS`；`bun run gen:module` 生成新业务模块时自动追加 `<slug>:read` 与 `<slug>:manage`。
- 服务端持久化与兜底：[apps/server/src/core/permissions.ts](../../../../server/src/core/permissions.ts) 与 [apps/server/src/modules/system.ts](../../../../server/src/modules/system.ts) 将自定义角色配置存入 `console_role_permission`，短缓存加速请求鉴权，并在 `ADMIN_LOCK` 咨询锁事务内完成更新或恢复默认：
  - `super_admin` 始终强制返回完整 `PERMISSION_CATALOG`（即使接口请求传入缩水数组也自动恢复，防止自锁）；
  - `system:permission:*`、`system:ai:manage`、`system:manage` 禁止分配给 `admin` 或 `member`（越界提交返回 `422`）；
  - 每次实际变更在同一事务内写入 `console_audit`（`permission.update` 记录 `targetRole / beforePermissions / afterPermissions`，`permission.reset` 记录恢复默认）。
- 前端交互：[PermissionsPage.tsx](./PermissionsPage.tsx) 实现：
  - **高密度单行矩阵与按需提示**：每行只保留模块名称并在旁提供 `?` 气泡提示（Tooltip）按需查看权限边界说明，不堆叠常驻副文案与底部脚注；
  - **自动联动**：开启「操作」自动勾选「查看」；关闭「查看」自动取消「操作」；
  - **只读槽位与超管只读标识**：只读模块（如概览、智能助理、操作日志）的「操作」槽位展示 `—` 而不渲染假按钮；`super_admin` 整列固定展示「全部权限」只读标识；页面移除前端已下线的 `AI 运行控制` 冗余行（后端 `system:ai:*` 契约保留）；
  - **锁定项即时 Tooltip**：禁用开关使用 `aria-disabled="true"` 接入共享 `Tooltip`，悬停或键盘聚焦即显示不可配置原因或只读说明（不依赖原生 `disabled` 导致事件屏蔽）；
  - **二次点击恢复默认**：首次点击「恢复默认」切换为「确认恢复」并弹出右下角告警提示，再次点击才提交 `POST /console/system/permissions/reset`；
  - **菜单与直达页即时同步**：保存或恢复后立即失效 `["session"]`，无查看权限的侧栏与 `Cmd/Ctrl+K` 菜单自动隐藏；用户直达无权限路由时由 `routes/__root.tsx` 按 `getFirstAccessiblePath` 自动跳回首个可访问页。

## 验收

- HTTP 与事务门禁：`python3 scripts/verify-system-governance.py`
- 多角色浏览器 E2E：`scripts/e2e/system-admin.mjs`（详见 [scripts/e2e/README.md](../../../../../scripts/e2e/README.md)）
