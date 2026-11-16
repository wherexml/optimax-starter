# 产品品牌素材

- `optimax-product-logo.png`：现有 OptiMax 产品 Logo，透明 PNG，登录页使用。
- `optimax-starter.svg`：Starter 专属、可编辑的纯矢量变体。延续四瓣轮廓与品牌蓝色，中心改为向前切口，表达启动；浏览器标签、内页侧栏、页面骨架及内容刷新使用。画布 `64×64`，无位图、外部字体或脚本。
- `optimax-starter-32.png`：从上述 SVG 在浏览器按 `32×32` 渲染的兼容图标。
- `../favicon.ico`：同款 32px PNG 封装的 ICO，供传统 favicon 入口使用。

浏览器标题与 SVG/PNG 图标引用在 `apps/web/index.html`，默认标题为 `Optimax Starter`。内页通过 `apps/web/src/config/app-config.ts` 的 `APP_CONFIG.logoSrc` 统一引用 SVG；展开、折叠、手机抽屉均为 32px 无外框图标。派生新产品时同步设置标题、logoSrc 和对应图标。

用户明确要求 SVG，按 imagegen skill 的代码原生矢量例外直接绘制路径；没有把生成位图嵌进 SVG。登录页品牌仍单独使用原有 `optimax-product-logo.png`；内页仅透传 `logoSrc`，不修改共享 UI 的默认品牌与侧栏导航布局。
