# 登录与品牌

本地入口：[登录](http://127.0.0.1:38140/login)。认证契约见 [AUTH](../../../../../AUTH.md)，本模块只维护登录界面和会话读取。

- `LoginPage.tsx`：左侧为无外框 OptiMax 产品 Logo、`Optimax Starter` 标题和 Steve 本次要求的 154 字产品价值介绍；右侧沿用账户密码表单。小屏改为自然纵向排列，按钮保持触控高度。
- `/brand/optimax-product-logo.png`：复用邻近 World Model 项目的 `src/assets/optimax-logo-mark-clean.png`，PNG 字节一致，保留透明背景；没有重绘商标或添加外框。
- 浏览器标签使用独立的 Starter SVG 变体和 `Optimax Starter` 标题，配置在 `apps/web/index.html`，素材见 [brand](../../../public/brand/README.md)。登录页主 Logo 保留上述产品标识。
- `/login-background.png`：内置 imagegen 新绘并细化的 AI 原图，1672×941，保留供核对。
- `/login-background-4k.png`：按 Steve 明确确认的本地高质量缩放方式，使用 macOS `sips` 导出为 3840×2160，登录页实际引用此文件。这是 4K 导出版，不宣称原生 4K 生成细节。
- 生成提示词和用途约束见 [背景 Prompt](../../../../../docs/design/login-background.prompt.md)。背景是装饰图，留空 alt，不包含产品标题、表单或 Logo。
- 本轮不变更登录请求、Session、错误处理、记住账户名语义和密码自动填充；左侧导航不在本模块范围。

复验：`scripts/e2e/login-brand.mjs` 的 `verifyLoginBrand(task, { evidenceDir })`。记录图片实际尺寸、多端截图、URL、必填反馈、密码显示切换和键盘操作；不提交密码、不打印密码、不改变已有用户会话。
