# OptiMax 团队 API 契约规范

> 本文件定义 OptiMax 团队统一 API 规则。内部实现可以是 tRPC、REST、GraphQL 或混合，但前端、第三方和 Agent 看到的行为必须稳定一致：认证、错误、分页、时间、权限、幂等、文件、长任务和审计不能各项目随意发挥。

---

## 1. 核心原则

- 内部 Web 应用优先使用强类型 API，确保前后端类型来自同一份契约。
- 第三方、移动端、Webhook、文件上传、OAuth callback 优先使用 REST 或明确的 HTTP 入口。
- API 风格可以不同，但认证、错误、分页、时间、权限、幂等和审计规则必须统一。
- API 文档必须描述真实已实现行为，不用规划覆盖现实；逐接口说明路径、方法、鉴权、请求、响应、错误、分页/排序/筛选和时间口径。
- 前端不得根据后端内部表结构猜字段，后端不得静默改变字段语义。
- 任何会影响前端展示、权限或数据口径的 API 变化都算契约变化。

---

## 2. API 事实卡

| 项 | 内容 |
| --- | --- |
| API 主风格 | <!-- tRPC / REST / GraphQL / 混合 --> |
| Base URL | <!-- /api/trpc / /api/v1 / 其他 --> |
| 认证传递 | 见 [AUTH.md](./AUTH.md#2-认证事实卡) |
| 错误格式 | <!-- 本文件标准格式或项目差异 --> |
| 分页方式 | <!-- cursor / page / offset --> |
| 实时通道 | <!-- SSE / WebSocket / subscription / 无 --> |
| 文件入口 | <!-- 上传、下载、预览路径 --> |
| 外部入口 | <!-- Webhook / OpenAPI / 无 --> |
| 契约生成 | <!-- shared schemas / OpenAPI / tRPC type / 无 --> |
| requestId | <!-- 由网关生成 / 服务生成 / 未配置 --> |

---

## 3. API 类型分层

| 类型 | 适合场景 | 必须满足 |
| --- | --- | --- |
| 强类型 RPC | 内部 Web、复杂表单、后台管理 | 共享 schema、稳定错误码、权限分级 |
| REST JSON | 外部系统、移动端、通用 CRUD | 明确路径、方法、版本、响应 envelope |
| 文件 HTTP | 上传、下载、预览 | 鉴权、大小限制、MIME、sandbox |
| Webhook | 外部系统推送 | 签名、幂等、重试、原始 payload 策略 |
| SSE/WebSocket | Agent、长任务、通知 | 断线恢复、心跳、权限、资源清理 |

---

## 4. 响应格式

成功响应：

```json
{
  "data": {}
}
```

列表响应：

```json
{
  "data": {
    "items": [],
    "pageInfo": {
      "nextCursor": null,
      "hasMore": false
    }
  }
}
```

错误响应：

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Validation failed",
    "details": {}
  }
}
```

规则：

- REST 必须直接使用以上 envelope。
- tRPC 等强类型 RPC 可以保留框架 envelope，但业务错误码、message、字段错误必须能稳定取到。
- 成功响应不要混用 `{ "success": true }` 和 `{ "data": ... }`。
- Webhook 可返回 `{ "data": { "accepted": true, "id": "..." } }`。
- 生产环境错误不得包含 stack、SQL、绝对路径、token、密钥或第三方完整原始错误。

---

## 5. 错误码

错误码使用大写蛇形命名。团队推荐前缀：

| 前缀 | 场景 | 示例 |
| --- | --- | --- |
| `AUTH_` | 登录、会话、OAuth | `AUTH_INVALID_CREDENTIALS` |
| `PERM_` | 权限、租户隔离 | `PERM_DENIED` |
| `VALIDATION_` | 参数、字段、格式 | `VALIDATION_FAILED` |
| `BIZ_` | 业务状态、状态机 | `BIZ_INVALID_STATE_TRANSITION` |
| `DATA_` | 数据不存在、冲突、重复 | `DATA_NOT_FOUND` |
| `FILE_` | 上传、下载、预览 | `FILE_TOO_LARGE` |
| `JOB_` | 后台任务、队列 | `JOB_TIMEOUT` |
| `EXTERNAL_` | 第三方系统 | `EXTERNAL_UNAVAILABLE` |
| `RATE_` | 限流、配额 | `RATE_LIMITED` |
| `SYS_` | 系统内部错误 | `SYS_INTERNAL_ERROR` |

HTTP / RPC 映射：

| HTTP | RPC 语义 | 典型错误码 |
| --- | --- | --- |
| 400 | Bad Request | `VALIDATION_BAD_REQUEST` |
| 401 | Unauthorized | `AUTH_REQUIRED` |
| 403 | Forbidden | `PERM_DENIED` |
| 404 | Not Found | `DATA_NOT_FOUND` |
| 409 | Conflict | `DATA_CONFLICT` |
| 413 | Payload Too Large | `FILE_TOO_LARGE` |
| 415 | Unsupported Media Type | `FILE_UNSUPPORTED_TYPE` |
| 422 | Validation Error | `VALIDATION_FAILED` |
| 429 | Too Many Requests | `RATE_LIMITED` |
| 500 | Internal Error | `SYS_INTERNAL_ERROR` |
| 503 | Service Unavailable | `EXTERNAL_UNAVAILABLE` |

字段校验错误必须能定位到字段：

```json
{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Validation failed",
    "fields": {
      "email": ["Invalid email"]
    }
  }
}
```

---

## 6. 分页、筛选与排序

默认使用 cursor 分页：

```json
{
  "cursor": "opaque-cursor",
  "limit": 20
}
```

REST 完整成功响应（沿用 §4 的 `data` 包装）：

```json
{
  "data": {
    "items": [],
    "pageInfo": {
      "nextCursor": "opaque-cursor",
      "hasMore": true
    }
  }
}
```

允许 page/pageSize 的场景：

- 审计日志、后台管理、报表导出等需要明确页码的内部工具。
- 已有项目迁移期，但必须在事实卡写清。

统一约束：

- `limit` 默认 20，最大 100。
- 排序参数使用 `sortBy` / `sortOrder` 或项目已定口径，但同一项目不得混用。
- 时间筛选统一使用 ISO 8601 UTC 字符串。
- 列表接口必须说明支持哪些筛选；后端不支持的筛选，前端不能假装支持。
- 服务端必须忽略或拒绝未知筛选，不能悄悄产生误导结果。

---

## 7. 时间、数字与枚举

- API 传输时间统一 ISO 8601 UTC，例如 `2026-06-17T10:00:00Z`。
- 前端按用户时区显示，后端不返回本地化时间字符串。
- 金额必须写清币种、精度和单位。
- 百分比必须写清是 `0-1` 还是 `0-100`。
- 枚举必须集中定义，不能由多个接口各写一套。
- 状态变化必须通过状态机或集中校验函数，不允许直接写状态字段。

---

## 8. 权限与租户

> 「前端隐藏入口≠权限边界」「后端最终鉴权」等通用红线见 [AGENTS.md 核心约束](./AGENTS.md#核心约束)；RBAC 角色、权限码、账号生命周期见 [AUTH.md](./AUTH.md)。本节只讲 API 层的权限与租户细则。

- 租户上下文来自 session/context，不来自前端请求体。
- 权限码统一使用 `resource:action` 语义，例如 `report:export`、`user:manage`。
- 高风险接口必须同时检查角色、资源权限和租户归属。
- 管理员接口、导出、删除、补跑、外部系统配置必须写审计日志。
- 详情接口不能只按 `id` 查询，必须同时检查租户和权限。

---

## 9. 幂等、并发与批量操作

写接口必须考虑重复点击、网络重试和后台补跑。

| 场景 | 要求 |
| --- | --- |
| 创建资源 | 支持幂等 key 或唯一约束冲突处理 |
| 更新资源 | 重要对象建议支持 version、updatedAt 或 ETag |
| 删除/归档 | 返回影响范围，重复调用结果要可解释 |
| 批量操作 | 返回每个对象的成功/失败明细 |
| 后台补跑 | 写入审计日志和补跑原因 |

批量响应示例：

```json
{
  "data": {
    "succeeded": ["id_1"],
    "failed": [
      {
        "id": "id_2",
        "error": {
          "code": "PERM_DENIED",
          "message": "Permission denied"
        }
      }
    ]
  }
}
```

---

## 10. 文件接口

文件上传、下载、预览不强行走 JSON-RPC，可以使用原生 HTTP。

最低要求：

- 上传、下载、预览都必须鉴权。
- 限制大小、扩展名、MIME 类型。
- 服务端生成存储文件名，不信任用户文件名。
- 返回字段至少包含 `id`、`filename`、`size`、`mimeType`、`url` 或下载入口。
- HTML/SVG/Office/PDF 预览必须写清安全策略。
- 下载接口要重新校验权限，不能只靠隐藏 URL。

---

## 11. Webhook 与外部 API

Webhook 请求必须有：

- Secret、签名、时间戳或来源白名单。
- 幂等键，例如外部事件 ID。
- 明确的成功响应和失败响应。
- 原始 payload 保存策略。
- 重试策略和去重策略。
- 审计日志或接收记录。

外部 API 公开给第三方时，必须补：

- OpenAPI 或等价文档。
- 版本号，例如 `/api/v1`。
- 认证方式和权限范围。
- 限流、配额、错误码。
- 向后兼容和废弃策略。

---

## 12. 长任务与实时结果

长任务不得让请求一直等待。

标准流程：

1. mutation/request 创建任务。
2. 后端返回 `jobId`。
3. 前端轮询任务详情或订阅实时进度。
4. 任务完成后返回结果 ID、下载地址或失败原因。

任务响应：

```json
{
  "data": {
    "jobId": "job_123",
    "status": "queued"
  }
}
```

任务详情：

```json
{
  "data": {
    "id": "job_123",
    "status": "failed",
    "progress": 60,
    "error": {
      "code": "EXTERNAL_UNAVAILABLE",
      "message": "External service unavailable"
    }
  }
}
```

实时通道要求：

- 有心跳或 ping。
- 有鉴权和租户校验。
- 有断线恢复或轮询降级。
- 退出页面时清理连接。

---

## 13. 契约变更

破坏性变更包括：

- 删除字段、改字段含义、改枚举值。
- 改认证方式、权限要求、租户口径。
- 改错误码、分页结构、时间格式。
- 改文件下载或预览安全边界。
- 改长任务状态或实时事件格式。

破坏性变更必须同步：

- 后端 schema / router / service。
- 前端调用方和错误态。
- 共享类型或 OpenAPI 文档。
- 测试和演示数据。
- 对应专项文档和调用方 E2E 场景；AGENTS.md 仅在入口变化时更新。

---

## 14. 验收清单

- [ ] 每个接口有鉴权、请求字段、响应字段、错误码说明。
- [ ] 参数经过 schema/DTO 校验。
- [ ] 列表接口分页、排序、筛选口径明确。
- [ ] 时间、金额、百分比、枚举口径明确。
- [ ] 权限和租户隔离在服务端执行。
- [ ] 错误响应不泄露内部信息。
- [ ] 长任务返回任务 ID，并能查询状态。
- [ ] 文件和 Webhook 有独立安全策略。
- [ ] 批量和重试场景有幂等或冲突处理。
- [ ] 已用真实或代表性请求跑过 smoke。
