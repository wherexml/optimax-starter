# 前端智能助理（features/assistant）

右侧停靠的流式智能助理，以及 `/system` 基础配置页中的 AI 模型配置卡片。服务端契约见 [apps/server/src/agent](../../../../server/src/agent/README.md)。`--no-agent` 会删除本目录及宿主文件中的 `@starter:agent-*` 块。

## 结构

| 文件                                                      | 作用                                                                                                                                                                    |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AssistantDrawer.tsx`                                     | 模块级状态驱动的抽屉：`<AssistantDock />`（门户渲染面板、桌面全屏下隔离主内容焦点）、`<SidebarAssistantTrigger />`、`<AskAssistant />`、`useAssistantAvailability()`；全屏偏好持久化至 `agent.drawer-wide` |
| `AssistantPanel.tsx`                                      | 懒加载的工作台：顶部栏、历史、引用来源、导出、全屏展开/退出全屏；未配置或熔断时显示说明卡片与全屏切换                                                                                               |
| `Conversation.tsx`                                        | `useChat` 接入 `/console/agent/chat`：外发最近 8 条纯文本与最后一条的确认回执，确认后自动续传；客户端工具 `navigate_console` 在主区域跳转（全屏态临时退回窄抽屉对照）；写工具完成后刷新相关查询缓存 |
| `ChatMessage.tsx` / `ToolSteps.tsx`                       | Markdown、表格、代码块、思考过程、工具时间线与写操作确认卡                                                                                                                                            |
| `Composer.tsx`                                            | `/` 快捷指令、页面范围标签（可移除、可重新附带）、输入法保护、空输入按上键调出上一问、字数与 token 估算                                                                                               |
| `SessionRail.tsx` / `SourceRail.tsx` / `CitationLink.tsx` | 历史对话（新建、搜索、置顶、重命名、删除、分支）与引用来源；编号徽标与标题均支持点击在主区域打开 `to + search`，全屏态点击引用临时退回窄抽屉，点引用定位后收起侧栏，点左侧导航则自动收起助理 |
| `assistant-links-utils.ts` / `EntityRefChip.tsx`          | 纯逻辑与快捷跳转芯片：跨轮次引用继承覆盖解析（`resolveMessageCitations` / `sessionCitations`），以及可扩展业务编码链接注册表（`DEFAULT_ENTITY_LINK_RULES` 含 `--no-example` 示例标记），正文、行内代码与表格单元格统一渲染芯片 |
| `AiModelSettingsCard.tsx`                                 | 模型配置：始终支持网页端直接配置（API 地址、密钥与接口协议、模型 ID、结构化输出方式均衡两行容器查询栅格），卡片头部提供「测试连接」与「清空配置」，提交归属 `/system` 顶部统一「应用」 |
| `assistant.css`                                           | 抽屉、右侧正文区全屏覆盖（与左侧菜单 `208px` / `64px` 联动对齐）、`minmax(0, 1fr)` / `overflow-x: hidden` 防横向撑破约束与实体芯片样式，仅使用主题变量，深浅色通用；抽屉关闭时不影响页面布局 |

## 历史记录

只保存在浏览器 `localStorage`，键为 `storageKey("agent.history.v1:" + 账户 id)`，按账户隔离，最多 30 个会话（置顶优先保留）。服务端不保存对话正文。

## 显示规则

- 没有 `agent:use` 的账户看不到任何入口。
- 模型已配置且未熔断：有 `agent:use` 即可使用。
- 未配置或已熔断：只有具备 `system:settings:read` 或 `system:ai:read` 的账户能看到入口（标注“待配置”或“已熔断”），面板内给出前往 `/system?tab=settings` 的链接；普通成员看不到入口。

## 在业务页面接入

```tsx
// @starter:agent-start
import { AskAssistant } from "@/features/assistant/AssistantDrawer";
// @starter:agent-end

<AskAssistant scope={{ kind: "vendors", label: "供应商台账", route: "/vendors", filters }} />;
```

`scope` 只作为显示与提示上下文，不参与授权。JSX 中用 `{/* @starter:agent-start */}` / `{/* @starter:agent-end */}` 包裹，`--no-agent` 可原样移除。新工具的中文名写进 `ToolSteps.tsx` 的 `TOOLS`，写工具同时加入 `WRITE_TOOLS`。

## 来源与许可

`beautiful-pi/` 及多个组件改编自 Beautiful Pi Web（提交 4a308ed，MIT 许可，版权所有 agegr），许可全文见 [beautiful-pi/LICENSE](./beautiful-pi/LICENSE)。
