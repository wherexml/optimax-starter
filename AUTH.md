# OptiMax 团队认证与权限规范

> 本文件定义 OptiMax 团队统一认证、安全和权限规则。它参考团队 RiskOps 项目的 Session-first、RBAC、登录限流、租户隔离、审计日志实践，同时保留 OAuth、SSO、JWT 或其他项目技术选择空间。
>
> 团队通用红线（不提交密钥/token、生产默认只读、前端隐藏入口≠权限、真实数据优先等）以 [AGENTS.md 核心约束](./AGENTS.md#核心约束) 为唯一正文，本文件不再重述，只补充认证权限领域细则。

---

## 1. 核心决策

默认推荐 Session-first：

- 浏览器场景优先使用 HttpOnly Cookie。
- API、CLI、Agent 场景可以使用 `Authorization: Bearer <session_id>`。
- Session 必须可撤销、可过期、可列出、可全部退出。
- 不默认使用纯 JWT 作为长期登录态；如果使用 JWT，必须说明撤销、轮换、黑名单和泄露后的处理方式。

项目可以选择 Cookie、Bearer 或双支持，但必须在事实卡写清。无论选择哪种方式，服务端必须是最终安全边界。

---

## 2. 认证事实卡

| 项 | 内容 |
| --- | --- |
| 登录方式 | 账户名 + 密码（Argon2id `@node-rs/argon2`）；可选标准 OIDC 企业单点登录（授权码 + PKCE S256，`AUTH_OIDC_*`，默认关闭），见 [§5](#5-oauth--sso) |
| Session 存储 | PostgreSQL `console_session`（仅存随机令牌的 SHA-256 摘要；记录登录 `ip_address`，`last_seen_at` 由会话中间件每 60 秒最多刷新一次） |
| Token 传递 | 浏览器：HttpOnly、`SameSite=Strict` Cookie（名称由 `SESSION_COOKIE_NAME` 配置，本地默认 `optimax_console`）；Agent / 集成：`Authorization: Bearer optx_…` 个人 API 密钥（`console_api_token`，见 [§12](#12-cookiebearer-与本地存储)） |
| Session 有效期 | 8 小时（`28800` 秒） |
| 记住我 | 登录页可选仅在本地记住账户名，不延长服务端会话 |
| OAuth Provider | 默认无；`AUTH_OIDC_*` 配置标准 OIDC（仅关联已有启用账户，绝不自动建号）；旧 `AUTH_SSO_*` 自定义入口仍兼容 |
| 注册限制 | 无开放注册，由具备 `accounts:manage` 的管理员创建成员账户（设置初始密码或生成 72 小时一次性激活链接）；`admin` 与 `super_admin` 角色仅超级管理员可分配 |
| 登录限流 | 应用层 PostgreSQL `console_login_guard`：账户 `user:<小写账户名>` 30 分钟内失败 5 次锁 30 分钟；来源 `ip:<客户端 IP>` 15 分钟内失败 20 次锁 30 分钟；锁定期返回 `429` + `Retry-After` + `AUTH_LOCKED`，见 [§4](#4-密码登录) |
| 客户端 IP | 默认取 TCP 对端地址；仅 `TRUST_PROXY=true` 时信任 `X-Forwarded-For` 首跳 / `X-Real-IP`（必须是合法 IPv4/IPv6） |
| 权限模型 | 三层角色（`super_admin`、`admin`、`member`）+ `console_role_permission` 模块级「查看 / 操作」权限矩阵；同一咨询锁 key 分共享/独占两种模式：业务写入取 `PERMISSION_SHARED_LOCK`（互不阻塞），账户、权限矩阵、系统设置、本人改密、激活与 SSO 关联取独占 `ADMIN_LOCK`；锁内二次复核操作者启用态、角色与实时有效权限 |
| 租户字段 | 无（单组织后台基线） |
| 审计日志 | `console_audit` 只追加表，记录 `actor_source`（`human` / `agent` / `system`；Cookie 会话恒为 `human`，Bearer 取密钥创建时选择的 `agent` 或 `system`）并对敏感键名递归 `[REDACTED]` 脱敏；同事务覆盖账户生命周期、激活链接生成/撤销/使用、本人资料与改密、权限矩阵修改/恢复默认、系统时区与 AI 熔断开关变更、资产增删改及 Agent 筛选回执；另记录 `auth.login` / `auth.login_failed`（含 `ip`、`reason`）/ `auth.logout` / `auth.sso_login` / `auth.sso_failed`。本人改密时“当前密码错误”不写审计 |

---

## 3. Session 规则

Session 表最低字段：

| 字段 | 说明 |
| --- | --- |
| `id` | 随机 session ID |
| `user_id` | 用户 ID |
| `expires_at` | 过期时间 |
| `created_at` | 创建时间 |
| `last_seen_at` | 最近使用时间，建议保留 |
| `ip_address` | 创建 IP，建议保留 |
| `user_agent` | 创建设备，建议保留 |

必须提供：

- `login`
- `logout`
- `logoutAll`
- `me`
- `listSessions`
- `revokeSession`

Session 续期：

- 可以使用 idle timeout，但续期必须由服务端控制。
- 服务端发现 session 失效时返回 `AUTH_SESSION_EXPIRED` 或同等稳定错误码（Starter 当前统一返回 `401` + `AUTH_REQUIRED`）。

Starter 实现（2026-11-21）：`console_session` 已有 `id`、`account`、`created_at`、`expires`、`user_agent`，并新增 `ip_address`（登录 IP，随访问 IP 变化刷新）与 `last_seen_at`（非阻塞更新，60 秒节流）；`GET /console/me/sessions` 返回 `ipAddress`、`lastSeenAt`，个人设置「在线会话」展示。
- 客户端对过期、撤销与退出的响应统一见 [FRONTEND.md §8](./FRONTEND.md#8-登录态权限与启动自检)。

---

## 4. 密码登录

最低要求：

- 邮箱统一小写后存储和查询。
- 密码长度不少于 8 位；面向生产建议提高到 12 位。
- 密码只存哈希，不存明文。
- 推荐 bcrypt、argon2 或同等级算法。
- 登录失败不得暴露“邮箱存在但密码错”这类差异。
- 成功登录后清理失败计数。

默认登录保护：

| 项 | 默认值 |
| --- | --- |
| 最大失败次数 | 5 次 |
| 锁定时间 | 30 分钟 |
| 限流维度 | email + IP |
| 成功后 | 清理失败计数 |

Starter 实现（`apps/server/src/core/login-guard.ts`，2026-11-21）：

| 桶 | 键 | 阈值 | 锁定 |
| --- | --- | --- | --- |
| 账户 | `user:<小写账户名>` | 30 分钟窗口内失败 5 次 | 30 分钟 |
| 来源 | `ip:<客户端 IP>` | 15 分钟窗口内失败 20 次（兼顾企业 NAT 与本机连续跑验收脚本） | 30 分钟 |

- 计数通过单条 `INSERT … ON CONFLICT DO UPDATE` 原子累加，并发失败不会丢计数；窗口或锁到期后自动开启新窗口。
- 未知账户名与真实账户名同样计数，并做一次等价 Argon2id 校验，响应始终为 `401` `"账户或密码错误"`（`AUTH_INVALID_CREDENTIALS`），不泄露账户是否存在；停用账户同样计为失败。
- 任一桶锁定期内直接返回 `429`、`Retry-After`（整数秒 ≥ 1）与 `{ error: "登录失败次数过多，请于 X 分钟后再试", code: "AUTH_LOCKED", requestId }`，即使密码正确也拒绝；同时写 `auth.login_failed`（`reason: "locked"`）。
- 登录成功只清理账户桶，来源桶自然衰减；管理员重置密码、重新启用账户、本人通过激活链接设置密码、SSO 登录成功都会删除该账户桶。
- 公开激活接口 `GET/POST /console/auth/invites/:token*` 共用来源桶：无效令牌计入失败，锁定期返回 `429`。

---

## 5. OAuth / SSO

Starter 实现（`apps/server/src/core/oidc.ts`，2026-11-21，零第三方 OAuth 依赖，仅 Node 24 `fetch` + `node:crypto`）：

| 项 | 实现 |
| --- | --- |
| 开关 | `AUTH_OIDC_ENABLED=true` 且 `AUTH_OIDC_ISSUER`、`AUTH_OIDC_CLIENT_ID`、`AUTH_OIDC_LABEL` 均有效时，`GET /console/auth/providers` 返回 `{ id, label, loginPath: "/console/auth/sso/<id>/start" }`；旧 `AUTH_SSO_*` 条目保留且不重复 ID |
| 回调 | 固定 `/console/auth/sso/<provider>/callback`（`AUTH_OIDC_REDIRECT_URI` 可覆盖），需在 IdP 注册 |
| 发现与密钥 | `.well-known/openid-configuration` 与 JWKS 内存缓存 1 小时；生产强制 HTTPS、校验 `issuer` 一致、禁止重定向；未知 `kid` 刷新 JWKS 一次 |
| 防护 | `state`（库内仅存 SHA-256，10 分钟，`DELETE … RETURNING` 一次性消费）+ HttpOnly `SameSite=Lax` 绑定 Cookie（`timingSafeEqual`）+ PKCE S256 + `nonce` |
| id_token | 支持 `RS256/384/512`、`PS256/384/512`、`ES256/384/512`、`EdDSA`，以及 IdP 声明时的 `HS256`（client secret）；拒绝 `alg=none`，校验 `iss`、`aud`（多受众时 `azp`）、`exp`/`nbf`/`iat`（60 秒偏差）与 `nonce` |
| 账户关联 | 先查 `console_auth_identity (provider, subject)`；未关联且 `AUTH_OIDC_ALLOW_EMAIL_LINK` 不为 `false` 时，按 `email_verified=true` 的邮箱（大小写不敏感，多账户命中视为未匹配）或 `preferred_username` 精确匹配已有启用账户并写入关联；`preferred_username` 不会自动关联 `admin` / `super_admin`；绝不自动建号 |
| 成功 | 创建 Session（含 IP / `last_seen_at`）、`SameSite=Strict` Cookie、清理账户锁定桶、写 `auth.sso_login`（`provider`、`ip`），302 回站内相对路径 |
| 失败 | 只重定向到 `/login?sso_error=` 固定枚举：`provider_disabled`、`cancelled`、`state_invalid`、`token_failed`、`unmatched`、`inactive`、`internal`；`unmatched` / `inactive` 写 `auth.sso_failed`；不回显上游错误文本 |
| 密钥 | 优先 `AUTH_OIDC_CLIENT_SECRET_FILE`（私有文件），回退 `AUTH_OIDC_CLIENT_SECRET`；不进日志、审计或响应 |

OAuth 必须包含：

- 固定回调路径，例如 `/auth/callback/:provider`。
- `state` 校验；支持时使用 PKCE。
- Provider 配置只放环境变量或密钥管理。
- 登录后必须绑定内部用户、组织和角色。
- 未绑定用户时按项目规则走邀请、域名白名单或管理员确认。
- OAuth 登录和失败也要写审计日志。

禁止：

- 把 OAuth client secret 写进仓库。
- 只靠前端回调参数判断登录成功。
- 不校验 state 直接创建 session。

---

## 6. RBAC 权限模型

团队统一使用 `resource:action` 权限语义。

基础角色：

| 角色 | 含义 |
| --- | --- |
| `super_admin` | 跨组织或平台级管理员 |
| `org_admin` | 组织管理员 |
| `member` | 普通可写成员 |
| `analyst` | 业务分析和处置人员 |
| `viewer` | 只读用户 |
| `readonly` | 受限只读用户，可用于外部审阅 |

项目可以扩展业务角色，例如 `operator`、`auditor`、`approver`，但必须映射到清晰权限集合。

权限码示例：

| 资源 | 动作 |
| --- | --- |
| `organization` | `read`、`update`、`manage` |
| `user` | `read`、`list`、`create`、`update`、`delete` |
| `event` | `read`、`list`、`create`、`update`、`assign`、`archive` |
| `case` | `read`、`list`、`create`、`update`、`assign`、`close` |
| `supplier` | `read`、`list`、`update`、`export` |
| `rule` | `read`、`list`、`create`、`update`、`configure` |
| `report` | `read`、`list`、`create`、`export` |
| `audit_log` | `read`、`list`、`export` |
| `settings` | `read`、`update`、`admin` |

检查规则：

- 所有写操作必须检查权限。
- 所有读操作必须检查租户归属。
- 权限矩阵应放在共享包或共享目录，前端只用于展示控制，后端用于最终裁决。「前端隐藏入口≠权限边界」见 [AGENTS.md 核心约束](./AGENTS.md#核心约束)。

---

## 7. API 权限分级

无论使用 tRPC、REST 还是 GraphQL，都要有等价分级：

| 分级 | 适用场景 | 最低要求 |
| --- | --- | --- |
| Public | 登录、公开健康、OAuth callback | 限流、输入校验、无敏感数据 |
| Protected | 登录用户通用接口 | 有效 session/user |
| Tenant | 多组织/多项目业务数据 | 服务端 context 注入租户 |
| Admin | 用户、角色、配置、审计、导出 | 角色 + 权限 + 审计 |
| System | 定时任务、Webhook、内部 Agent | 签名、密钥或服务身份 |

---

## 8. 租户隔离

多组织、多 workspace、多项目系统必须服务端隔离。

- `orgId` / `workspaceId` / `projectId` 来自 session/context。
- 创建数据时服务端注入租户字段。
- 查询、更新、删除必须带租户条件。
- 详情页接口不能只按资源 ID 查询。
- 后台任务 payload 必须带租户字段，并在执行时再次校验资源归属。
- 审计日志必须记录租户字段。

禁止：

- 前端传 `orgId` 后后端直接信任。
- 详情页只按资源 ID 查询。
- 导出接口绕过租户过滤。
- 管理员接口在没有组织边界的情况下直接全表操作。

---

## 9. 审计范围

以下操作必须写审计日志：

- 登录成功、登录失败、登出、全部登出。
- 修改密码、重置密码、撤销 session。
- 创建、删除、禁用用户。
- 修改角色、权限、组织设置。
- 导出、下载敏感报告或批量数据。
- Webhook 接收和失败。
- 后台任务补跑、取消、失败。
- 管理员配置外部系统、密钥别名、模型或 Agent。
- 高风险业务状态变化，例如关闭、归档、发布、回滚。

审计日志不写密码、token、secret、完整 Cookie。

---

## 10. 浏览器实现入口

启动身份确认、权限反馈、缓存隔离及连接生命周期统一维护在 [FRONTEND.md §8](./FRONTEND.md#8-登录态权限与启动自检)。本文件负责服务端身份、Session、授权契约与凭证安全；浏览器验收场景见 [TESTING.md](./TESTING.md)。

---

## 11. 账号生命周期

项目只要有多人使用，就要定义账号生命周期：

| 状态 | 说明 | 行为 |
| --- | --- | --- |
| `invited` | 已邀请未激活 | 只能完成注册/接受邀请 |
| `active` | 正常账号 | 按角色权限访问 |
| `disabled` | 被停用 | 不能登录，现有 session 应撤销 |
| `locked` | 登录失败过多或安全锁定 | 暂时不能登录 |
| `deleted` | 逻辑删除 | 不再登录，历史审计保留 |

禁用、删除、角色变更后必须考虑现有 session 是否立即失效。

Starter 激活链接（2026-11-21）：

- 新增账户可选「生成一次性激活链接」（`inviteOnly: true`）：账户以随机不可用密码创建并保持停用（对应 `invited`），返回仅显示一次的 `invitePath` 与 `expiresAt`。
- `POST /console/accounts/:id/invite` 为已有账户重新生成链接（不可为本人生成；普通 `admin` 仅限 `member`），同时撤销该账户所有未使用链接（`account.invite_revoke`）。
- `console_account_invite` 只存令牌 SHA-256，72 小时有效、仅可使用一次；`GET /console/auth/invites/:token` 返回 `404` 无效 / `410` 已撤销、已使用、已过期。
- `POST /console/auth/invites/:token/accept` 在独占 `ADMIN_LOCK` 事务内复核并锁定链接、设置密码并启用账户、撤销该账户全部 Session 与其余未使用链接、清理账户锁定桶，写 `account.invite_accept`。
- 停用账户会同时撤销其未使用的激活链接，避免旧链接绕过停用。

---

## 12. Cookie、Bearer 与本地存储

Cookie：

- 生产环境必须启用 `Secure`。
- 默认 `HttpOnly`。
- `SameSite` 按跨域需求选择，不能随意放宽。
- 登出时设置空 Cookie 或服务端失效。

Bearer：

- 只放在内存、系统安全存储或服务端环境变量。
- 不写入日志、URL、localStorage 或公开文档。
- 泄露后必须能撤销或过期。

Starter 个人 API 密钥（`apps/server/src/modules/tokens.ts`、`core/bearer.ts`，前端 `/settings` 「API 密钥」卡片）：

| 项 | 规则 |
| --- | --- |
| 格式与存储 | `optx_` + 32 位 base64url（24 字节随机）；库内只存 SHA-256 摘要与显示前缀，明文仅在创建响应中返回一次 |
| 管理 | `GET/POST /console/me/tokens`、`DELETE /console/me/tokens/:id` 仅允许网页 Cookie 会话；Bearer 调用 `/me/password`、`/me/sessions*`、`/me/tokens*` 返回 `403 PERM_INTERACTIVE_REQUIRED` |
| 字段 | `name`、`actorSource`（`agent` / `system`）、`ttlDays`（1 / 7 / 30 / 90 / 365）、`scopes`（必须是本人当前有效权限子集）；每账户最多 20 个有效密钥 |
| 有效权限 | 每次请求实时计算 `getEffectivePermissions(role) ∩ scopes`；角色降级、账户停用、撤销或过期立即生效 |
| 鉴权 | 只要请求头的方案是 Bearer（含缺失或畸形凭证）即只走密钥校验，失败 `401 AUTH_INVALID_TOKEN`，绝不回退 Cookie |
| CSRF | Bearer 请求免 `Origin` 校验（浏览器不会跨站自动附带 Authorization 头），仍受 `REQUEST_POLICIES` 的 Content-Type 与体积限制；Cookie 请求（含 multipart 上传与 CSV 导入）始终要求 `Origin === CORS_ORIGIN` |
| 使用记录 | `last_used_at` / `last_used_ip` 每分钟最多刷新一次（IP 变化时立即刷新），非阻塞 |
| 审计 | `token.create`（前缀、来源、scopes、到期时间）/ `token.revoke`（前缀）；Bearer 发起的写操作以密钥的 `actorSource` 记录 |

localStorage：

- 只能放非敏感偏好，例如主题、列宽、最近视图。
- 与用户绑定的偏好 key 要包含用户或组织隔离。
- 不存 session、token、密码、API key。

---

## 13. 安全清单

- [ ] Session 可撤销、可过期、可全部退出。
- [ ] 密码只存哈希。
- [ ] 登录失败有限流和锁定。
- [ ] OAuth 有 state 校验。
- [ ] 所有写操作做服务端权限检查。
- [ ] 所有租户数据查询带租户条件。
- [ ] 详情接口不只按资源 ID 查询。
- [ ] 管理员路径验证普通用户不能访问。
- [ ] 审计日志覆盖安全操作。
- [ ] 错误不泄露账号存在性、密钥、SQL、堆栈。
- [ ] Cookie 设置 `HttpOnly`、`Secure`、`SameSite`；Bearer token 不写入日志。
- [ ] 登出、切换账号、切换组织会清理前端缓存和实时连接。

## 账户管理与系统权限规则

- `/console/accounts*` 读接口要求 `accounts:read`，写接口要求 `accounts:manage` 并在事务锁内复核实时有效权限。
- 三层提权防线：普通 `admin` 仅可创建、编辑、启停、重置密码或撤销 `member` 账户，不能创建 `admin` / `super_admin`、不能修改任何账户的系统角色、也不能改动其他管理员或超级管理员（返回 `403`）。
- 不能停用自己、不能更改当前账户角色；核心引导超级管理员不可停用或降级；系统在 `pg_advisory_xact_lock(7140301)` 内强制保证至少保留 1 名启用的 `super_admin`（否则 `409` 回滚）。
- `/console/system/permissions`（`/permissions`）仅 `super_admin` 可查看与维护：前端以「模块 × 角色（查看 / 操作）」双按钮展示并联动，后端强制锁定 `super_admin` 完整权限且拒绝将 `system:permission:*`、`system:ai:manage`、`system:manage` 分配给其他角色；关闭某角色的模块查看权限后，前端自动隐藏对应菜单并在直达时跳转首个可访问页，后端接口及 Agent 路由同步返回 `403`。

## 操作日志

- 表 `console_audit` 只增不改，新增 `actor_source`（`human` | `agent`），查询接口为 `GET /console/audit`（要求 `audit:read`）。
- 查询参数：`source`（`human` / `agent`）、`action`、`actor`、`start`/`end`（`YYYY-MM-DD`，按当前生效的 `console_setting.timezone` 系统时区解释自然日，默认 `Asia/Shanghai`）、`page`、`size`（上限 100）。响应一并返回当前 `timezone` 供前端一致格式化。
- 服务端 `sanitizeAuditDetail` 在落库前对含 `password`、`secret`、`token`、`cookie`、`hash`、`prompt`、`instruction` 等敏感键递归脱敏；Agent 筛选回执仅记录命中数、模型名与参数自愈次数，不存用户自然语言输入原文。

## 本人资料与密码

- `PATCH /console/me`、`POST /console/me/password` 的契约见 [EASM_REUSE.md](./EASM_REUSE.md)。
