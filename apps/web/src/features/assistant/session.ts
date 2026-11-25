// Browser-only, account-isolated assistant history. Nothing here is sent to the server except the
// trimmed messages of the active request.
import { hasDsml, unavailableConclusion } from "@optimax-starter/agent/conclusion";
import type { UIMessage } from "@optimax-starter/agent/react";
import { storageKey } from "@/config/app-config";
import type { AgentCitation, AgentScope } from "./api";

export type MessageMeta = {
  citations?: AgentCitation[];
  model?: string;
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  elapsedMs?: number;
  finishReason?: string;
  startedAt?: number;
};

export type Session = {
  id: string;
  title: string;
  draft: string;
  /** Page the conversation was started from; display and server context only. */
  scope?: AgentScope;
  messages: UIMessage[];
  pinned?: boolean;
  renamed?: boolean;
  parentId?: string;
  forkTurn?: number;
  updatedAt?: number;
};
export type History = { active: string; sessions: Session[] };

export const MAX_SESSIONS = 30;
export const historyKey = (accountId: number | string) =>
  storageKey(`agent.history.v1:${accountId}`);

export const blankSession = (seed: Partial<Session> = {}): Session => ({
  id: crypto.randomUUID(),
  title: "新对话",
  draft: "",
  messages: [],
  updatedAt: Date.now(),
  ...seed,
});

function isHistory(value: unknown): value is History {
  if (!value || typeof value !== "object") return false;
  const history = value as History;
  return (
    typeof history.active === "string" &&
    Array.isArray(history.sessions) &&
    history.sessions.every(
      (session) => session && typeof session.id === "string" && Array.isArray(session.messages),
    )
  );
}

export function readHistory(key: string): History {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (isHistory(saved) && saved.sessions.some((session) => session.id === saved.active)) {
      return saved;
    }
  } catch {
    /* A new session remains usable if storage is unavailable. */
  }
  const session = blankSession();
  return { active: session.id, sessions: [session] };
}

export function writeHistory(key: string, history: History): string {
  try {
    localStorage.setItem(key, JSON.stringify(history));
    return "";
  } catch {
    return "本机存储空间不足，部分对话无法保存。";
  }
}

/** Keeps pinned sessions and the newest unpinned ones within the cap. */
export function capSessions(sessions: Session[]) {
  const pinned = sessions.filter((session) => session.pinned);
  const rest = sessions.filter((session) => !session.pinned);
  return [...pinned, ...rest.slice(0, Math.max(0, MAX_SESSIONS - pinned.length))];
}

export const readableAssistantText = (text: string) =>
  hasDsml(text) ? unavailableConclusion : text;

export const messageText = (message: UIMessage) =>
  message.parts
    .flatMap((part) =>
      part.type === "text"
        ? [message.role === "assistant" ? readableAssistantText(part.text) : part.text]
        : [],
    )
    .join("");

export function turnCount(session: Session) {
  return session.messages.filter((message) => message.role === "user").length;
}

export function sessionSearchText(session: Session) {
  return `${session.title}\n${session.messages.map(messageText).join("\n")}`.toLocaleLowerCase();
}

import { messageCitations } from "./assistant-links-utils";

export {
  messageCitations,
  resolveMessageCitations,
  sessionCitations,
} from "./assistant-links-utils";

export const scopeLabel = (scope?: AgentScope) => (scope ? scope.label || scope.kind : "");

export function relativeTime(at?: number) {
  if (!at) return "";
  const diff = Date.now() - at;
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  const date = new Date(at);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function exportMarkdown(session: Session, appTitle: string) {
  const lines = [`# ${session.title}`, "", `- 系统：${appTitle}`];
  const label = scopeLabel(session.scope);
  if (label) lines.push(`- 页面范围：${label}`);
  lines.push(`- 导出时间：${new Date().toLocaleString("zh-CN")}`, "");
  for (const message of session.messages) {
    const text = messageText(message).trim();
    if (message.role === "user") {
      lines.push("## 问题", "", text, "");
      continue;
    }
    const meta = message.metadata as MessageMeta | undefined;
    lines.push(
      `## 回答${meta?.model ? `（${meta.model}）` : ""}`,
      "",
      text || "（无文本回答）",
      "",
    );
    const sources = messageCitations(message);
    if (sources.length) {
      lines.push(
        "引用来源：",
        ...sources.map(
          (source) =>
            `- ${source.id}：${source.title}${source.snippet ? `（${source.snippet}）` : ""}`,
        ),
        "",
      );
    }
  }
  const url = URL.createObjectURL(
    new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `${session.title.replace(/[\\/:*?"<>|]+/g, " ").trim() || "助理对话"}.md`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
