# 服务端智能助理（apps/server/src/agent）

可选模块，基于 [`@optimax-starter/agent`](../../../../packages/agent/README.md) 运行时。初始化时 `--no-agent` 会删除本目录及所有 `@starter:agent-*` 接入块，不涉及数据库迁移。

## 路由

均挂载在 `/console` 下，助理对话与模型配置只接受网页会话（Bearer 返回 `PERM_INTERACTIVE_REQUIRED`）。

| 方法与路径                   | 权限                     | 说明                                                                                  |
| ---------------------------- | ------------------------ | ------------------------------------------------------------------------------------- |
| `GET /agent/status`          | 已登录                   | `enabled`、`configured`、`circuitOpen`、`editable`；仅 `agent:use` 账户可见模型显示名 |
| `POST /agent/chat`           | `agent:use`              | UI Message SSE 流；只取最近 8 条消息、每条 4000 字；未配置或熔断时返回 503            |
| `POST /agent/test`           | `system:settings:manage` | 用已保存配置跑一次工具调用探针                                                        |
| `GET /system/ai/model`       | `system:settings:read`   | 模型配置（不含密钥，`hasKey` 仅表示是否存在）                                         |
| `POST /system/ai/model`      | `system:settings:manage` | 保存配置，16 KiB 上限，同一事务写 `system.ai_model` 审计                              |
| `POST /system/ai/model/test` | `system:settings:manage` | 用未保存的草稿配置探测连接                                                            |

每轮对话结束在同一事务写入 `agent.chat` 审计，只记录步数、轮次上限、工具名、结束原因、Skill 版本与 SHA-256、耗时；不记录提问、回答或密钥。

## 模型配置的两种模式

见 `model-settings.ts`。

- 在线维护（`editable: true`）：`STARTER_AI_CONFIG_KEY_FILE` 指向 64 位十六进制 AES-256-GCM 密钥文件。配置以 JSON 文本存于 `console_setting`（`key = "ai.model"`），API 密钥加密保存，留空沿用旧密钥；`revision` 做乐观锁；API 地址的 origin 必须等于 `STARTER_AI_BASE_URL` 或列在 `STARTER_AI_ALLOWED_ORIGINS`，更换服务时必须同时填写新密钥。
- 只读部署凭证（`editable: false`）：未配置或无法读取密钥文件时，只使用环境变量（`readAiConfig`），保存返回 `AI_CONFIG_READONLY`；仍可测试连接。

`managedGateway` 按 revision 与配置缓存网关，配置变化后旧网关在超时后关闭，进行中的对话不受影响。

## 写操作确认

需要确认的工具声明 `needsApproval: true`。服务端把 SDK 的确认 id 替换为 HMAC-SHA256 签名（绑定账户、调用 id、工具名、输入、15 分钟有效期，密钥只在进程内存中）。确认回传时 `routes.ts` 会：

1. 只接受最后一条助手消息上的 `approval-responded` 部件；
2. 校验工具在写工具表中、账户仍有对应模块权限、签名有效；
3. 工具 `execute` 内再次检查确认记录，并在事务中用 `lockPermission` 重新校验权限后写入，审计来源为 `agent`。

## Skill

`skills.ts` 按顺序查找 `<目录>/assistant/SKILL.md`：`STARTER_AGENT_SKILLS_DIR`，然后 `.local/skills`，然后内置的 `src/agent/skills`（生产镜像由 `Dockerfile.prod` 复制）。文件头含 `name`、`version`，正文按 `## 系统指引`、`## 收尾指引`、`## 重试指引` 分段；内容 SHA-256 写入审计。

## 为新业务模块添加工具

1. 新建 `apps/server/src/agent/<模块>-tools.ts`，导出 `xxxTools(context: AgentToolContext): ToolSet`，按 `context.actor.permissions` 决定注册哪些工具；只读工具把引用追加到 `context.citations`（`{ id: "E1", title, snippet, to, search }`），`to` 必须是站内路径。
2. 写工具声明 `needsApproval: true`，在 `execute` 中检查 `context.approvals.has(toolCallId)`，事务内 `lockPermission` 后写入并调用 `auditResource(..., "agent")`。同时导出 `{ 工具名: { permission, input } }`，在 `routes.ts` 的 `writeTools` 中注册。
3. 在 `registry.ts` 的 `buildAgentTools` 中合并工具；前端在 `features/assistant/ToolSteps.tsx` 的 `TOOLS`（以及写工具的 `WRITE_TOOLS`）里补充中文名称。
4. 参考 `example-assets-tools.ts`；示例块用 `// @starter:example-assets-*` 包裹，便于 `--no-example` 移除。
