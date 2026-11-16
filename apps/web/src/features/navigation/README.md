# 快速导航

`QuickNav.tsx` 复用共享 Radix Dialog；页面入口与按有效权限过滤（`getVisibleNavItems`）统一来自 `config/app-config.ts`，不维护第二份导航表。

- 搜索使用中文页面名及英文别名；输入提示只保留“搜索页面”。
- `.quick-nav-list` 为可滚动单列，`.quick-nav-item` 是整行按钮，最小高度 44px。选中项用主题浅蓝背景，图标、名称和当前页标记对齐。
- 样式按类名绑定，不依赖 DOM 是 `ul/li` 还是 `div/button`。2026-11-16 修复了旧标签选择器与实际 DOM 不匹配导致的选项横排、文字拥挤。
- 弹窗限制视口内高度，列表单独滚动；方向键选择自动滚入可视区。关闭按钮与搜索输入各有独立空间。
- Cmd/Ctrl+K 打开，↑/↓ 循环选择，Enter 跳转，Esc 关闭并归还焦点；保留输入法组合输入保护。

## 浏览器验收

先启动本地 Compose 并以本地演示管理员登录，在 Ego TaskSpace 执行：

```js
const { verifyQuickNav } = await import('/Users/steve/Projects/00-optimax/optimax-starter/scripts/e2e/quick-nav.mjs');
console.log(await verifyQuickNav(task, {
  evidenceDir: '/Users/steve/Projects/00-optimax/optimax-starter/evidence/quick-nav',
}));
```

默认页面 `http://127.0.0.1:38140/assets`；其他部署传入 `baseUrl`。脚本保存桌面、375px 手机、375×400 低高度视口截图及 `results.json`。检查单列、最小点击高度、输入框避让、无横向溢出、快捷键、过滤/空态、跳转、焦点恢复和选中项滚动。测试只读取资产，不创建或修改业务数据。
