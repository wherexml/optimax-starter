# 账户管理（`/accounts`）

提供系统账户检索、创建、编辑、重置密码、启用/禁用与删除管理，严格执行 `super_admin / admin / member` 三层角色红线与最后/核心超管防自锁保护。完整认证与鉴权矩阵见 [AUTH.md](../../../../../AUTH.md)。

## 权限与提权防线

服务端实现位于 [apps/server/src/modules/accounts.ts](../../../../server/src/modules/accounts.ts)，共享契约见 [packages/api/src/contracts.ts](../../../../../packages/api/src/contracts.ts)：

- **只读与操作分离**：具备 `accounts:read` 可查看账户列表；仅当具备 `accounts:manage` 时开放新建、编辑、重置密码、生成激活链接、强制下线与启停用操作。
- **日常业务管理员（`admin`）红线**：
  - 新建账户时角色固定为 `member`，禁止直接创建 `admin` 或 `super_admin`；
  - 禁止修改、重置密码或启停用任何 `admin` / `super_admin` 账户，禁止将 `member` 提权；
  - 禁止删除任何账户（`DELETE /console/accounts/:id` 仅限 `super_admin`）。
- **超级管理员（`super_admin`）防自锁保护**：
  - 禁止操作当前登录账户自身（改角色、禁用、删除）；
  - 系统强保护启动核心超管（`STARTER_ADMIN_USERNAME`，默认 `demo@optimax.hk`）与最后一名处于 `active` 状态的 `super_admin`，防止降级、禁用或删除；
  - 启用、禁用、删除与角色调整均在 `ADMIN_LOCK` 咨询锁事务内完成，并同事务写入脱敏后的 `console_audit`。

## 界面组成

- [AccountsPage.tsx](./AccountsPage.tsx)：角色徽章使用 COSS 风格语义圆点标识区分 `超级管理员 / 管理员 / 成员`；表格「操作」列收敛至单行最多 3 个核心操作（`详情 / 编辑 / 停用或启用`），受保护高权限行保持「仅超管可维护」；右侧 `DetailDrawer` 顶部操作栏提供外部同等全量能力（`编辑 / 重置密码 / 生成激活链接 / 下线 / 启停`，子确认/编辑弹窗关闭后自动返回原详情抽屉），左下角统一提供「上一个 / 下一个」切换；工具栏接入纯图标 `TableExportMenu` 导出筛选结果 CSV。
- [CreateAccountDialog.tsx](./CreateAccountDialog.tsx) / [EditAccountDialog.tsx](./EditAccountDialog.tsx) / [ResetPasswordDialog.tsx](./ResetPasswordDialog.tsx)：复用共享 `FormDialog`；非 `super_admin` 登录时隐藏超管/管理员提权选项，核心或最后超管账户锁定角色段控并提示保护原因。

## 验收

- HTTP 与防自锁门禁：`python3 scripts/verify-console.py`、`python3 scripts/verify-system-governance.py`
- 浏览器 E2E：`scripts/e2e/system-admin.mjs`、`scripts/e2e/forms-dialog.mjs`
