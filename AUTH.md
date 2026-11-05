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
| 登录方式 | <!-- 密码 / OAuth / SSO / 邀请码 / 无 --> |
| Session 存储 | <!-- PostgreSQL / Redis / 内存 / 第三方 --> |
| Token 传递 | <!-- HttpOnly Cookie / Bearer / 双支持 --> |
| Session 有效期 | <!-- 例如 7 天 --> |
| 记住我 | <!-- 例如 30 天 / 不支持 --> |
| OAuth Provider | <!-- Google / GitHub / 企业 SSO / 无 --> |
| 注册限制 | <!-- 邀请码 / 域名白名单 / 管理员创建 / 开放注册 --> |
| 登录限流 | <!-- 次数、窗口、锁定时间 --> |
| 权限模型 | <!-- RBAC / ABAC / 混合 --> |
| 租户字段 | <!-- orgId / workspaceId / projectId / 无 --> |
| 审计日志 | <!-- 覆盖哪些安全操作 --> |

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
- 服务端发现 session 失效时返回 `AUTH_SESSION_EXPIRED` 或同等稳定错误码。
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

---

## 5. OAuth / SSO

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

## 账户管理规则

- `/console/accounts*` 全部写入由服务端再次校验管理员身份；成员不能读取账户列表或在线会话。
- `PATCH /console/me` 任何登录用户可修改自己的显示名称；`PATCH /console/accounts/:id` 由管理员修改名称、角色与启停。
- 不能停用自己、不能把自己降为成员；重置密码与强制下线不能作用于当前账户。
- 影响管理员集合的修改在事务内先取 `pg_advisory_xact_lock(7140301)` 串行化，复核操作者仍为启用管理员，写入后若启用管理员为 0 则整体回滚（409）。
- 停用、重置密码会删除目标账户全部会话；`POST /console/accounts/:id/revoke` 单独强制下线。
- 前端对停用、强制下线、角色变更使用显式确认；启用和改名直接生效。

## 操作日志

- 表 `console_audit` 为新增表（只增不改）。API 只写入不更新、不删除，查询接口为 `GET /console/audit`（仅管理员）。
- 查询参数：`action`、`actor`（匹配操作人姓名或账户名）、`start`/`end`（`YYYY-MM-DD`，按 UTC+8 自然日，含结束当天，`start > end` 或日期无效返回 400）、`page`、`size`（服务端上限 100）。按时间、ID 倒序排列。
- 记录的操作：新增账户、修改姓名、调整角色、变更状态、重置密码、强制下线、修改本人名称。日志与账户变更在同一事务内写入，失败的操作和读取操作都不记录；没有实际变化的修改不写入。
- 每条记录保存操作人和对象当时的 ID、账户名与姓名。`detail` 只允许 `from/to/role/sessions`，不记录密码、哈希、Cookie 或令牌。
- 管理员写操作在咨询锁内复核操作者仍是启用的管理员。`requireAdmin` 逐个路由挂载，不再用通配 `use` 重复执行。

## 本人资料与密码

- `PATCH /console/me`、`POST /console/me/password` 的契约见 [EASM_REUSE.md](./EASM_REUSE.md)。
