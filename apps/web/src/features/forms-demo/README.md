# 表单弹窗与输入控件 Demo

本地入口：[表单弹窗](http://127.0.0.1:38140/demo/forms)（可直接通过 `?dialog=create` 或 `?dialog=edit` 打开复杂表单弹窗）。受 `VITE_ENABLE_DEMOS` 控制，管理员与成员均可访问；读取真实 `/console/assets` 的业务域与责任团队作为候选源，演示提交仅更新本页状态，不污染数据库业务表。

## 覆盖能力

1. **三段式标准弹窗（`FormDialog`）**：固定头部（标题 `18px/28px` + `0.5px` 分隔线 + 对齐关闭按钮）、独立滚动内容区（`px-6 py-5`）、固定底部操作栏（左侧必填说明与辅助动作、右侧取消/提交按钮、置顶未保存拦截条 `UnsavedChangesBanner`）。
2. **字段布局与分组（`FormSection` / `FieldLayout` / `Label`）**：采用显式 `flex flex-col gap-2`（`8px` 标签到控件间距），彻底避免 Tailwind v4 `space-y-*` 在行内 `<label>` 上的边距塌陷；同一弹窗严格使用 `18px / 14px / 12px` 三档字号。
3. **12 类共享输入控件（`@optimax-starter/ui`）**：
   - `Input` / `ClearableInput`（图标前缀、协议前缀、单位后缀、一键清空、字数统计 `FieldCharCount`）
   - `PasswordInput`（显隐切换 + `crypto.getRandomValues` 一键生成随机合规密钥）
   - `CopyableInput`（只读态 + 一键复制剪贴板反馈）
   - `NumberInput`（步进加减、上下方向键、最小/最大边界与单位后缀）
   - `Select`（贴边轻量单选下拉）
   - `Combobox`（带关键字搜索、副标题提示、键盘导航与清空的组合框）
   - `MultiSelect`（支持搜索过滤、全选与清空的复选多选下拉）
   - `SegmentedControl`（2–4 项平铺互斥分段单选，方向键切换）
   - `TagInput`（回车/逗号/批量粘贴生成胶囊标签、格式校验与 `Backspace` 删除）
   - `Textarea`（多行文本域与字数上限统计）
   - `Switch` / `SwitchField` 与 `Checkbox`（带说明的开关配置行与复选确认项）
   - 动态禁用态及原因说明（切换「Agent 上报」时回调地址与轮询周期自动禁用并就近展示原因）。
4. **全局通知速查（右下角堆栈 `Toaster` + `toast`）**：在同一页底部提供成功、提示、风险警告、异常告警、`toast.promise` 异步进度、带撤销操作按钮与多条堆叠展开的一键实测面板。
5. **骨架屏与内容刷新速查（`ContentRefresh`）**：支持页面头部「刷新表单示例」主动触发流光骨架（`immediate` 最小节拍），并可在底部对比预览 `dashboard`（Bento 趋势 + 环形图）与 `table` 两种流光骨架及无外框独立四瓣矢量加载图形（接入 `packages/ui` 共享 `content-refresh`）。

复验脚本：`scripts/e2e/forms-dialog.mjs`、`scripts/e2e/notifications.mjs`。规范正文见 [FRONTEND.md 表单弹窗与输入控件](../../../../../FRONTEND.md#表单弹窗与输入控件)。
