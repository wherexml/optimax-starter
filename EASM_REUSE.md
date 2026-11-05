# EASM 复用：工作台、用户菜单与个人设置

## 来源与改写

| EASM 源 | Starter 落点 | 改写要点 |
| --- | --- | --- |
| `pages/Index.tsx` | `features/dashboard/DashboardPage.tsx` | 保留结构：4 张统计卡片 → 2:1 主栅格 → 快捷入口。租户安全态势改为业务域列表（含待复核数）；最近活动管理员显示真实操作日志，成员显示待复核队列。删除报告、租户、趋势、渐变背景和滚动位置恢复 |
| `components/dashboard/DashboardStatCard.tsx` | 同上 `StatCard` | 标签和数值合成一个链接，下方各项为独立链接，避免在 `role=button` 里嵌套按钮；不显示趋势 |
| `components/dashboard/RecentActivityList.tsx` | 同上 `RecentActivity` | 数据来自 `GET /console/audit?size=5`，点击进入按该操作类型筛选的操作日志；时间显示为相对时间 |
| `components/common/FeatureCard` | 同上 `QuickAccess` | 只保留图标和标题，不写描述文案 |
| Sidebar `SidebarFooter` 用户下拉 | `routes/__root.tsx` | 用现有的 Radix Popover 实现，不新增 DropdownMenu 依赖。触发器显示头像、姓名和角色；菜单依次是身份信息、个人设置、账户管理（仅管理员）、分隔线、退出登录；退出前弹出取消/确认对话框 |
| Settings 账户与安全两张卡片 | `features/settings/SettingsPage.tsx`、`routes/settings.tsx` | 密码规则沿用本项目的 10–256 位，不加大写字母要求；不移植账单、租户、通知和 AI 选项 |

## 接口契约

- `GET /console/me` 返回 `id, username, name, role, active, email, company`。
- `PATCH /console/me` 接受 `{ name?, email?, company? }`（严格模式，至少一项）；空字符串会清空邮箱或公司。只发 `{name}` 的旧调用照常工作。`role`、`active`、`username`、`id` 一律拒绝。
- `POST /console/me/password` 接受 `{ current, password }`（严格模式，不接受账户 ID），新密码 10–256 位，且不能与当前密码相同。处理过程：
  1. 加 `ADMIN_LOCK`，在锁内复核账户已启用、当前会话仍然有效；
  2. 在事务内读取最新哈希并校验当前密码；
  3. 写入新哈希，删除该账户全部会话（包括当前会话），写入 `profile.password_change` 日志，然后清除 Cookie。
  校验失败或当前密码错误时，既不改数据，也不写日志。
- 日志：`profile.update` 修改姓名时记录 from/to；修改邮箱或公司时只在 `fields` 中记录字段名，不记录内容。任何日志都不记录密码、哈希、邮箱或公司的内容。
- 数据库：`console_account` 只新增可为空的 `email` 和 `company` 两列，不做破坏性变更。

## 前端行为

- 用户菜单：展开时在侧栏右侧弹出，折叠时同样向右，移动端在触发器上方弹出。支持点击外部或 Esc 关闭；方向键、Home、End 在菜单项间移动；菜单通过 Portal 渲染，不会被 inert 的主区域遮住。
- 未保存提示：当前已核对 TanStack Router 的 `useBlocker({ shouldBlockFn, withResolver })`，站内跳转显示“离开/留下”，刷新/关闭页面使用 beforeunload；两张表单均可重置。
- 修改密码成功后，前端清空查询缓存并跳转到登录页。
