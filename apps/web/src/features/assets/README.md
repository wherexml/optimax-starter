# 资产台账与自然语言筛选

台账继续使用真实 `/console/assets` 数据、TanStack Table、动态 FilterBar 和 URL。筛选语义与持久化规则见 [FILTERS](../../../../../FILTERS.md)。自然语言试点只改变当前筛选，不写资产或账户；管理员手动新增、编辑、删除资产走独立的写接口并记录操作日志。

筛选条件、顺序、空行和未应用草稿按账户保留，刷新后恢复；草稿不会自动变成已应用条件。手动筛选与自然语言输入均按搜索框声明并带 `data-1p-ignore`，登录框的密码自动填充保持原样。具体键与 URL 优先规则见 [刷新恢复](../../../../../FILTERS.md#刷新恢复与输入语义)。

## 接入结构

- `AssetAgent.tsx`：自然语言输入、停止、草稿/页面状态检查、UI SDK 动作执行及实际结果回传。
- `filter-primitive.ts` / `AssetFilterScope.tsx`：为现有筛选提供 `asset-filters.setValue`，保留现有 Radix 控件；受控值来自路由，没有第二份业务状态。
- `agent-bridge.ts`：单个 UI SDK bridge，只允许该 primitive 的 `setValue`；输入框不进入 snapshot。UI SDK React/Core 固定同一版本，当前为 `0.1.0-beta.3`。
- `packages/api/src/asset-agent.ts`：前后端共用严格参数校验。只支持 `q/qOp/stage/domain`；不存在的状态、业务域或额外字段被拒绝。
- `apps/ai-service/src/asset-agent.ts`：经现有 Session/Origin 校验的模型计划与结果回传，调用 [服务端 AI 模块](../../../../ai-service/src/core/ai/README.md)。模型只获得指令、当前筛选和可选值，不接收 Cookie、账号或整张资产表。

手动草稿有未应用值时不能开始自然语言筛选；模型等待期间手动改变条件也不能被覆盖。停止或离开页面会中止浏览器请求并禁止迟到动作；已经提交给上游的推理可能仍结束。页面会核对实际路由状态，再将筛选与匹配条数回传模型；`act.ok` 单独不视为成功。

## 模型接入

不配置时保持普通台账；`GET /console/assets/agent/config` 返回 `enabled: false`，不显示自然语言输入，不依赖模型服务启动。

默认使用 `STARTER_AI_BASE_URL`、`STARTER_AI_MODEL` 和容器内的私有 `STARTER_AI_API_KEY_FILE` 直连 OpenAI-compatible API，不需要启动 Magpie 或转发进程。配置、可信 CA、只读文件挂载、队列参数和密钥轮换见 [部署文档](../../../../../DEPLOYMENT.md#可选服务端模型-api)。凭证值不写 `.env`、源码、前端、Docker 环境或日志。

### 原 Magpie 转发（可选兼容）

仅当新客户端未配置时才采用以下旧路径。2026-11-16 原试点曾核验 Magpie `https://10.0.0.164/v1` 的 `minimax/MiniMax-M3`，该历史结果不代表这次客户端移植运行过真实模型。

1. 在主机项目根目录启动 `node scripts/magpie-relay.mjs`，监听 `127.0.0.1:38142`。CA 默认读取现有 Magpie CA，可通过 `MAGPIE_CA_FILE` 指向已有可信证书；禁止关闭 TLS 校验。
2. 在已授权的 ego TaskSpace 中打开 Magpie 官方管理页，确认已有登录态。用 `scripts/e2e/bootstrap-magpie.mjs` 的 `bootstrapMagpieRelay(page)` 将现有启用的普通 `Magpie` Key 直接传入转发进程内存；该方法不输出或落盘 Key，也不新增 Key。转发重启后需要重新装载。
3. 启动本地服务（仍使用原 Compose 项目及数据卷）：

```sh
STARTER_MAGPIE_RELAY_URL=http://host.docker.internal:38142/chat/completions \
STARTER_MAGPIE_MODEL=minimax/MiniMax-M3 \
docker compose up -d --build api web
```

4. 打开 `http://127.0.0.1:38140/assets`，使用项目已有本地演示登录。API 端口仍为 `38141`。

前端只调用同源 `/console`；只有 API 访问本地转发。转发仅接受回环连接、拒绝浏览器 Origin，并只调用固定 Magpie 地址。不会通过网页 CORS 向应用浏览器提供模型凭证。

## API 契约

模型工具只修改显式提供的字段，未提供的字段保留；`clear_all: true` 明确清空，再应用同次指令提供的条件。无效工具参数最多向同一模型回传一次校验错误进行纠正，仍失败则不执行。新客户端仅对明确的 token 字段名拒绝修正一次；其他 HTTP 故障不自动重试，不切换模型。拒绝文案由应用生成，不把模型思考文本交给页面。

| 路径 | 内容 |
| --- | --- |
| `GET /console/assets/agent/config` | `{ enabled }`（需 `assets:read`；环境未配置或超管开启全局熔断时均为 `false`），不返回凭证 |
| `POST /console/assets/agent/plan` | `{ instruction, current }`；返回 `{ filters, runId, model, callId, corrections }`，`filters` 是完整目标条件，`corrections` 为 0 或 1 |
| `POST /console/assets/agent/result` | `{ runId, ok, filters, matched, error? }`；模型收到真实执行回执后写入一条 `actor_source = "agent"` 的 `agent.asset_filter` 脱敏审计记录（不存指令原文），并返回 `{ acknowledged, model, callId }` |

指令最多 500 字，JSON 请求体最多 8KB。计划与当前登录账户绑定，5 分钟过期、单次回传；结果只留在有界进程内存，不新增业务数据表。非法输入 400、未登录 401、来源不符 403、过期 404、过大 413、不支持的自然语言请求 422。

模型错误保留 `error` 字符串，增加稳定 `code` 和可选 `upstreamStatus/errorShape/retryAfter`；具体错误码见 [AI 模块](../../../../ai-service/src/core/ai/README.md#业务边界和错误)。上游认证失败返回 502，限流/队列满 429，超时 504，无效配置/队列等待超时 503；适用响应保留 Retry-After。回执失败时页面继续显示“筛选已应用，模型回执暂不可用”，不会误报筛选未执行。

## 台账管理与服务端分页参考接口

- `AssetsPage.tsx` 基于 [ResourceTableSlot](../../components/crud/README.md) 构建：成员仅可查看与筛选；管理员额外展示右上角「新增资产」按钮与行尾「编辑 / 删除」操作，`AssetFormDialog.tsx` 复用 `@optimax-starter/api` 的 `assetInputSchema` 并内置未保存离开拦截与触发按钮焦点归还。
- 写接口（仅管理员，均在 `ADMIN_LOCK` 咨询锁事务内执行并由 `auditResource` 追加 `asset.create / asset.update / asset.delete` 日志）：`POST /console/assets`、`PATCH /console/assets/:id`、`DELETE /console/assets/:id`。
- 大规模数据参考接口：`GET /console/assets/page` 支持 `q`、`qOp`（`contains` / `equals`）、多值 `stage`、多值 `domain` 及 `page` / `size` 服务端 SQL 分页过滤，返回 `{ items, total, page, size }`。

## 验收

E2E 入口与证据统一见 [TESTING](../../../../../TESTING.md) 和 [脚本说明](../../../../../scripts/e2e/README.md)。新增 UI SDK 调用先读项目 [starter-ui-sdk](../../../../../.agents/skills/starter-ui-sdk/SKILL.md)，由其路由到当前安装版本的文档与 primitive/Agent 接入方式。不读取或修改 `dist/*.js`。
