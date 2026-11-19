# 服务端模型客户端

资产自然语言筛选使用此模块直连 OpenAI-compatible Chat Completions API。配置来自服务端，浏览器只调用现有 `/console/assets/agent/*`；不依赖 Magpie 进程，也不新增对外代理接口。

## 组成与来源

- `token-field.ts`：两种 token 上限字段的归一化；官方 OpenAI 主机默认 `max_completion_tokens`，其他地址默认 `max_tokens`。只有 400/422 明确要求另一字段才修正一次；跳过额度、限流和上下文错误码。保留数值、messages 和 tools，成功修正后缓存 endpoint+model 的选择（最多 64 条，6 小时）。
- `errors.ts`：识别 OpenAI / Anthropic / Gemini 错误结构，返回固定文案、稳定 code 和安全元数据；不返回上游正文。Retry-After 支持秒与 HTTP 日期，向上取整，不截短供应商建议等待时间。
- `queue.ts`：单进程有界 FIFO，单用户活跃加排队限额；排队取消不发上游，超时退出，成功、失败和取消都释放，释放幂等。用户计数归零即删除；通过 `snapshot()` 向超管状态页只读暴露 `active / waiting / activeActors` 实时水位。多实例之间不共享限流状态。
- `client.ts`：私有文件凭证、HTTP(S) 传输、可信 CA、1MiB 响应上限；拒绝重定向。接入 `console_setting` 的 `ai.enabled` 全局熔断开关，开启熔断时在获取队列槽位与请求上游前直接抛出 `ai_circuit_open`（HTTP `503`）。一个截止时间覆盖排队、token 修正及业务工具参数修正。

所选逻辑移植自 Magpie 固定提交 `58cf764533743a84b93a8b2cbff61fde27350856`，未引入 Go 库。原函数、修改说明和原文件摘要见 [来源清单](../../../../../third_party/magpie-sources.json)，完整版权与许可见 [MIT](../../../../../third_party/licenses/magpie-MIT.txt)。`Dockerfile.prod` 把这些文件复制到最终镜像 `/app/third_party/`；后续摘取或升级需核对新增内容及其许可。

## 配置

完整环境配置与密钥挂载操作维护在 [部署文档](../../../../../DEPLOYMENT.md#可选服务端模型-api)，安全模板见根 `.env.example`。

| 配置 | 默认与边界 |
| --- | --- |
| `STARTER_AI_BASE_URL` / `STARTER_AI_MODEL` | OpenAI-compatible Base URL（如供应商 `/v1`）和明确模型 ID；不自动换供应商或模型 |
| `STARTER_AI_API_KEY_FILE` | API 容器内私有只读文件；非空普通文件、不超过 4KB、仅可打印 ASCII，不能对所有人可写；密钥值不进入 env |
| `STARTER_AI_CA_FILE` | 可选额外可信 CA 文件；默认系统信任，不关闭 TLS 验证 |
| `STARTER_AI_ALLOW_HTTP_HOSTS` | 仅开发/测试的明确 HTTP 主机白名单；生产拒绝 HTTP |
| `STARTER_AI_TOKEN_FIELD` | 可选 `max_tokens` 或 `max_completion_tokens`，覆盖首次选择 |
| `STARTER_AI_TIMEOUT_MS` | 60000；1000–120000，含排队与修正 |
| `STARTER_AI_CONCURRENCY` | 4；1–32 |
| `STARTER_AI_QUEUE_LIMIT` | 16；0–256 |
| `STARTER_AI_QUEUE_WAIT_MS` | 15000；0–120000，且不超过请求剩余截止时间 |
| `STARTER_AI_ACTOR_LIMIT` | 每登录用户 2；1–16，包含运行与等待请求 |

新模式三个主要配置均为空时默认关闭；任意一项填写即要求三项完整有效。URL 禁止 userinfo、query、fragment 和非 HTTP(S)。配置无效只关闭模型能力，不阻塞管理后台。配置和密钥首次读取后缓存在进程中，变更或轮换后重启 API。

仅当新模式未配置时，原 `STARTER_MAGPIE_RELAY_URL/MODEL` 两项可选兼容；只配一项无效。旧 relay 不做 token 改名、请求不携带 Authorization，使用上述队列与总超时（默认由原 85 秒改为 60 秒）；relay 自身的限制仍适用。普通项目与本次独立 E2E 均无需该兼容路径。

## 业务边界和错误

应用仅执行已有 `apply_asset_filters` 工具白名单，前后端 Zod 校验、Session/Origin 校验、草稿冲突与停止检查仍生效；模型响应不直接执行，也不暴露给页面。供应商助手消息的扩展字段在校验已知结构后保留，用于后端工具回传，不进入页面或日志。

模型错误保留 `{ error: string }` 契约，并增加大写 `code`（如 `UPSTREAM_AUTH`、`QUEUE_FULL`）和可选 `upstreamStatus`、`errorShape`、`retryAfter`。上游 401/403 映射本应用 502，不触发前端登录失效；限流和队列满返回 429，超时 504，排队超时或无效配置 503。回执失败继续明确“筛选结果已确认，模型回执暂不可用”，其 HTTP 状态按错误类别返回。

## 验证

命令和证据统一见 [TESTING](../../../../../TESTING.md) 与 [HTTP/浏览器 E2E](../../../../../scripts/e2e/ai-client/README.md)。测试使用真实应用与隔离数据库，供应商由脚本模拟；不将其结果称为真实模型理解能力通过。
