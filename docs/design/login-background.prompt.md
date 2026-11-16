# Starter 登录背景

生成方式：内置 `image_gen` 新绘背景；不改动旧登录图。生成工具原始输出为 1672×941；最终按 Steve 确认的本地高质量缩放方式导出 3840×2160、16:9。实际文件与验收结果见登录模块 README。

Prompt:

Use case: stylized-concept.
Asset type: premium enterprise software login background artwork, a standalone image asset, NOT a UI mockup.
Create a completely new ultra-detailed 4K landscape image at exactly 3840 x 2160 pixels, aspect ratio 16:9. A refined cinematic digital Earth at night, viewed obliquely from orbit. A large partial globe occupies the lower-left and middle-left, with realistic continent contours, delicate city lights and a thin atmospheric blue rim. A small number of elegant cyan-blue data arcs connect subtle points across the globe, suggesting connected enterprise operations and intelligent systems. Crisp fine detail and natural depth, restrained and sophisticated rather than a busy science-fiction interface. Deep navy and midnight blue, precise cool blue light, a few warm city-light accents. The top-left area must remain dark, calm and low-detail for a product logo, title and a short paragraph added later in HTML. Keep the rightmost 45 percent quiet with a smooth deep navy gradient so a light login form can sit over it. The artwork should feel spacious, polished and contemporary, with the visual weight in the lower-left and a gentle fade into negative space on the right. No text, no letters, no logos, no watermark, no UI panels, no controls, no frames, no large decorative HUD rings, no dense grids, no spaceship, no bright flares behind text. Render as a final high-resolution background artwork, not a screenshot.


## 第二次生成

使用第一张新绘图作为编辑参考，要求保留构图并重绘为实际 3840×2160；内置工具仍返回 1672×941。未据此宣称原生 4K。第二张原图保留在 `/login-background.png`；Steve 随后明确允许本地导出 4K，登录页接入 `/login-background-4k.png`。


## 经确认的本地导出

```sh
sips --resampleHeightWidth 2160 3840 apps/web/public/login-background.png --out apps/web/public/login-background-4k.png
```

实际 PNG 像素为 3840×2160。这是 AI 新绘原图的高质量放大导出版，不声称原生生成了 4K 细节。原图与最终图都在项目内保留；Logo 直接复用既有产品素材，不由图像模型重绘。
