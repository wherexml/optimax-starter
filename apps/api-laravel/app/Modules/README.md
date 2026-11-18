# app/Modules —— 业务模块（映射 apps/server/src/modules/）

每个模块一个子目录：Controller（编排）+ FormRequest（继承 SchemaRequest，LB-03）+ Repository（Eloquent）+ Resource（响应形状）。路由在模块内注册并统一挂 `/console` 前缀。

对等迁移顺序（LARAVEL.md 阶段 C）：Audit → Auth → System → Accounts → Assets → AssetAgent。

开发任何端点严格按 [LARAVEL.md 模块标准开发流程](../../../LARAVEL.md) 八步推进。
