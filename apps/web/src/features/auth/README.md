# 登录与品牌

本地入口：[登录](http://127.0.0.1:38140/login)。认证契约见 [AUTH](../../../../../AUTH.md)，本模块只维护登录界面和会话读取。

- `LoginPage.tsx`：左侧为无外框 OptiMax 产品 Logo、`APP_CONFIG.loginTitle`（默认 `Optimax Starter`，派生项目传入 `VITE_APP_TITLE` 后自动透传）和产品价值介绍（介绍首句同样插值 `APP_CONFIG.loginTitle`，默认原文为 `Optimax Starter 为企业应用提供...`，派生项目的标题会同时出现在 H1 与介绍中）；记住账户名按 `storageKey("rememberedUsername")` 隔离。右侧沿用账户密码表单。小屏改为自然纵向排列，按钮保持触控高度。
- 企业单点登录：页面挂载后非阻塞请求 `GET /console/auth/providers`（`api.auth.providers.$get()`），失败静默忽略，账户密码登录始终可用。仅渲染 `loginPath` 匹配 `^/(?!/)` 或 `^https://` 的条目；默认关闭状态下列表为空，页面不渲染任何 SSO 区域。有可用条目时在 `[data-login-panel]` 内表单下方显示分隔文案“或使用企业单点登录”和整宽描边链接按钮；当提供方携带 `icon: "feishu"`（或 `id === "feishu"`）时，按钮左侧渲染 [FeishuLogo.tsx](./FeishuLogo.tsx) 飞书官方三色飞鸟矢量图标（几何路径源自 MIT 许可的 `@douyinfe/semi-icons`，按飞书品牌三色 `#00D6B9` / `#133C9A` / `#3370FF` 分层填充，无外链图片请求）。当服务端返回 `passwordLoginDisabled: true`（由 `AUTH_PASSWORD_LOGIN_ENABLED=false` 且存在有效 SSO 时下发）时，登录页隐藏口令表单并直接显示企业单点登录主入口（`[data-login-sso-only="true"]`）；按需开启步骤见 [feishu-auth](../../../../../.agents/skills/feishu-auth/SKILL.md)。
- `/brand/optimax-product-logo.png`：复用邻近 World Model 项目的 `src/assets/optimax-logo-mark-clean.png`，PNG 字节一致，保留透明背景；没有重绘商标或添加外框。
- 浏览器标签使用独立的 Starter SVG 变体和 `<title>`（由 `bootstrap-project.sh --title` 改写），配置在 `apps/web/index.html`，素材见 [brand](../../../public/brand/README.md)。登录页主 Logo 保留上述产品标识。
- `/login-background-4k.webp`：由 3840×2160 导出版使用 `cwebp -q 80` 压制（约 374 KB，保持真实 UHD 4K 像素尺寸），并清理冗余未使用的旧 PNG。
- 生成提示词和用途约束见 [背景 Prompt](../../../../../docs/design/login-background.prompt.md)。背景是装饰图，留空 alt，不包含产品标题、表单或 Logo。
- 本轮不变更登录请求、Session、错误处理、记住账户名语义和密码自动填充；左侧导航不在本模块范围。

复验：`scripts/e2e/login-brand.mjs` 的 `verifyLoginBrand(task, { evidenceDir })`。记录图片实际尺寸、多端截图、URL、必填反馈、密码显示切换和键盘操作；不提交密码、不打印密码、不改变已有用户会话。
