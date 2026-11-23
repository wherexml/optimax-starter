// Transcript, process timeline and composer wiring, adapted from Beautiful Pi Web ChatWindow (4a308ed, MIT, see beautiful-pi/LICENSE).
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
  useChat,
} from "@optimax-starter/agent/react";
import { AGENT_MAX_MESSAGES, AGENT_MAX_TEXT_CHARS } from "@optimax-starter/api";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { ArrowDown } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { isPathAccessible } from "@/config/app-config";
import type { Account } from "@/console-client";
import {
  type AgentCitation,
  type AgentScope,
  CHAT_ENDPOINT,
  isInternalPath,
  mapAgentError,
} from "./api";
import { AgentLoadingState } from "./beautiful-pi/AgentLoadingState";
import { ChatMinimap } from "./beautiful-pi/ChatMinimap";
import { buildConversationReferencePrompt } from "./beautiful-pi/composer";
import { StreamMessage } from "./ChatMessage";
import { COMMANDS, type Command, Composer, type ComposerHandle } from "./Composer";
import {
  messageCitations,
  messageText,
  readableAssistantText,
  type Session,
  scopeLabel,
} from "./session";
import { toolName, WRITE_TOOLS } from "./ToolSteps";

type Banner = { kind: "error" | "stopped"; text: string };

/** Query caches refreshed after an approved write tool completes. */
const WRITE_INVALIDATES: readonly (readonly string[])[] = [
  ["audit"],
  ["dashboard-module"],
  // @starter:example-assets-start
  ["assets"],
  // @starter:example-assets-end
];

const QUICK_COMMANDS = COMMANDS.filter((command) => command.prompt && command.id !== "navigate");

/** Only text (and approval responses on the newest message) leave the browser; the server rebuilds tool context. */
function outbound(messages: UIMessage[]) {
  const recent = messages.slice(-AGENT_MAX_MESSAGES);
  return recent.map(({ id, role, parts }, index) => ({
    id,
    role,
    parts: parts.flatMap((part): UIMessage["parts"] => {
      if (part.type === "text") {
        const text = role === "assistant" ? readableAssistantText(part.text) : part.text;
        return [{ type: "text", text: text.slice(0, AGENT_MAX_TEXT_CHARS) }];
      }
      return index === recent.length - 1 && "state" in part && part.state === "approval-responded"
        ? [part]
        : [];
    }),
  }));
}

export function Conversation({
  session,
  account,
  pageScope,
  storageError,
  onBusy,
  onCitations,
  onNew,
  onExport,
  onShowSources,
  save,
  fork,
}: {
  session: Session;
  account: Account;
  pageScope?: AgentScope;
  storageError: string;
  onBusy: (busy: boolean) => void;
  onCitations: (citations: AgentCitation[]) => void;
  onNew: () => void;
  onExport: () => void;
  onShowSources: (citations: AgentCitation[]) => void;
  save: (change: (session: Session) => Session) => void;
  fork: (seed: Partial<Session>) => void;
}) {
  const navigate = useNavigate();
  const cache = useQueryClient();
  const [draft, setDraft] = useState(session.draft);
  const [scope, setScope] = useState<AgentScope | undefined>(session.scope);
  const [banner, setBanner] = useState<Banner>();
  const [atBottom, setAtBottom] = useState(true);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const viewport = useRef<HTMLDivElement>(null);
  const composer = useRef<ComposerHandle>(null);
  const follow = useRef(true);
  const saveRef = useRef(save);
  saveRef.current = save;
  const accountRef = useRef(account);
  accountRef.current = account;

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: CHAT_ENDPOINT,
        body: () => ({ scope: scopeRef.current }),
        prepareSendMessagesRequest: ({ messages, body }) => ({
          body: { ...body, messages: outbound(messages) },
        }),
      }),
    [],
  );
  const [initialMessages] = useState(() => session.messages);

  const chat = useChat({
    id: session.id,
    transport,
    messages: initialMessages,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onFinish: ({ isDisconnect }) => {
      if (isDisconnect) setBanner({ kind: "error", text: "连接中断，请重试" });
    },
    onToolCall: ({ toolCall }) => {
      if (toolCall.toolName !== "navigate_console") return;
      const input = (toolCall.input ?? {}) as { to?: unknown; search?: unknown };
      const target = isInternalPath(input.to) ? input.to : undefined;
      if (!target || !isPathAccessible(target, accountRef.current)) {
        void chat.addToolOutput({
          tool: "navigate_console",
          toolCallId: toolCall.toolCallId,
          state: "output-error",
          errorText: "目标页面不存在或当前账号无权访问",
        });
        return;
      }
      const search =
        input.search && typeof input.search === "object" && !Array.isArray(input.search)
          ? input.search
          : {};
      void navigate({ to: target as never, search: search as never });
      void chat.addToolOutput({
        tool: "navigate_console",
        toolCallId: toolCall.toolCallId,
        output: { navigated: true },
      });
    },
  });
  const busy = chat.status === "submitted" || chat.status === "streaming";

  useEffect(() => {
    onBusy(busy);
  }, [busy, onBusy]);
  // The panel may attach a new page scope to this (empty) session from outside.
  useEffect(() => {
    setScope(session.scope);
  }, [session.scope]);

  // Latest values for the unmount cleanup, which must not depend on render-time closures.
  const latestMessagesRef = useRef(chat.messages);
  latestMessagesRef.current = chat.messages;
  const latestInputRef = useRef({ draft, scope });
  latestInputRef.current = { draft, scope };
  function persist(messages: UIMessage[], input: { draft: string; scope?: AgentScope }) {
    saveRef.current((previous) => {
      const question = messages.find((message) => message.role === "user");
      return {
        ...previous,
        messages,
        draft: input.draft,
        scope: input.scope,
        title:
          previous.renamed || !question
            ? previous.title
            : messageText(question).slice(0, 34) || previous.title,
        updatedAt: previous.messages.length !== messages.length ? Date.now() : previous.updatedAt,
      };
    });
  }
  useEffect(
    () => () => {
      // Switching sessions mid-stream keeps the question and the partial answer.
      if (latestMessagesRef.current.length > 0) {
        persist(latestMessagesRef.current, latestInputRef.current);
      }
      onBusy(false);
      void chat.stop();
    },
    [chat.stop, onBusy],
  );

  const latest = useMemo(() => {
    const message = [...chat.messages].reverse().find((entry) => entry.role === "assistant");
    return message ? messageCitations(message) : [];
  }, [chat.messages]);
  const latestKey = latest.map((citation) => citation.id + citation.title).join(",");
  useEffect(() => {
    onCitations(latest);
  }, [latestKey]);

  useEffect(() => {
    if (busy) return; // Completed turns only; streaming deltas are not written to storage.
    persist(chat.messages, { draft, scope });
  }, [chat.messages, draft, scope, busy]);

  useEffect(() => {
    if (follow.current && viewport.current) {
      viewport.current.scrollTop = viewport.current.scrollHeight;
    }
  }, [chat.messages, chat.status]);

  // Refresh business pages after an approved write tool finished in this conversation.
  const seenWrites = useRef<Set<string> | null>(null);
  useEffect(() => {
    const done = chat.messages.flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type.startsWith("tool-") &&
        "state" in part &&
        part.state === "output-available" &&
        WRITE_TOOLS.has(toolName(part as Parameters<typeof toolName>[0]))
          ? [(part as { toolCallId: string }).toolCallId]
          : [],
      ),
    );
    if (!seenWrites.current) {
      seenWrites.current = new Set(done);
      return;
    }
    const fresh = done.filter((id) => !seenWrites.current?.has(id));
    if (!fresh.length) return;
    for (const id of fresh) seenWrites.current.add(id);
    for (const queryKey of WRITE_INVALIDATES) void cache.invalidateQueries({ queryKey });
  }, [chat.messages, cache]);

  const lastQuestion = [...chat.messages].reverse().find((message) => message.role === "user");

  function send(text = draft) {
    const question = text.trim();
    if (!question || busy) return;
    const label = scopeLabel(scopeRef.current);
    setBanner(undefined);
    chat.clearError();
    follow.current = true;
    void chat.sendMessage({ text: question, metadata: label ? { scope: label } : undefined });
    setDraft("");
  }

  function run(command: Command) {
    if (command.action === "new") return onNew();
    if (command.action === "export") return onExport();
    if (command.id === "navigate" && command.prompt) {
      setDraft(`${command.prompt} `);
      composer.current?.focus();
      return;
    }
    if (command.prompt) send(command.prompt);
  }

  function respond(id: string, approved: boolean) {
    setBanner(undefined);
    void chat.addToolApprovalResponse({ id, approved });
  }

  const error = chat.error ? { kind: "error" as const, text: mapAgentError(chat.error) } : banner;
  const turns = chat.messages
    .filter((message) => message.role === "user")
    .map((message) => ({ id: message.id, question: messageText(message) }));

  return (
    <>
      <div className="pi-transcript-wrap">
        <div
          ref={viewport}
          className="pi-transcript"
          role="region"
          aria-label="对话消息"
          onScroll={(event) => {
            const el = event.currentTarget;
            const near = el.scrollHeight - el.clientHeight - el.scrollTop < 90;
            follow.current = near;
            if (near !== atBottom) setAtBottom(near);
          }}
        >
          <div className="pi-transcript-inner">
            {!chat.messages.length && (
              <div className="pi-empty">
                <h2>有什么可以帮你？</h2>
                <div className="pi-quick-actions">
                  {QUICK_COMMANDS.map((command) => (
                    <button
                      key={command.id}
                      type="button"
                      className="pi-quick-card"
                      onClick={() => run(command)}
                    >
                      <span className="pi-quick-icon">{command.icon}</span>
                      <strong>{command.description}</strong>
                      <small>/{command.id}</small>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {chat.messages.map((message, index) => {
              const live =
                busy && index === chat.messages.length - 1 && message.role === "assistant";
              const node = (
                <StreamMessage
                  key={message.id}
                  message={message}
                  live={live}
                  busy={busy}
                  respond={respond}
                  onRegenerate={
                    busy
                      ? undefined
                      : () => {
                          setBanner(undefined);
                          chat.clearError();
                          follow.current = true;
                          void chat.regenerate({ messageId: message.id });
                        }
                  }
                  onFork={
                    busy
                      ? undefined
                      : () => {
                          const upTo = chat.messages.slice(0, index + 1);
                          const questions = upTo.filter((entry) => entry.role === "user");
                          fork({
                            title: `分支：${messageText(questions.at(-1) ?? message).slice(0, 28)}`,
                            messages: upTo,
                            scope,
                            forkTurn: questions.length,
                          });
                        }
                  }
                  onQuote={(text) => {
                    setDraft(buildConversationReferencePrompt(draft, [text.slice(0, 800)]));
                    composer.current?.focus();
                  }}
                  onSources={onShowSources}
                />
              );
              return message.role === "user" ? (
                <div key={message.id} className="pi-turn-anchor" data-turn-id={message.id}>
                  {node}
                </div>
              ) : (
                node
              );
            })}
            {chat.status === "submitted" && chat.messages.at(-1)?.role === "user" && (
              <div className="pi-msg-assistant pi-msg-pending">
                <AgentLoadingState label="正在连接模型…" />
              </div>
            )}
            {error && (
              <div
                className="pi-banner"
                data-kind={error.kind}
                role={error.kind === "error" ? "alert" : "status"}
              >
                <span>{error.text}</span>
                <button
                  type="button"
                  className="pi-button"
                  disabled={busy}
                  onClick={() => {
                    setBanner(undefined);
                    chat.clearError();
                    follow.current = true;
                    void chat.regenerate();
                  }}
                >
                  {error.kind === "error" ? "重试" : "重新生成"}
                </button>
              </div>
            )}
          </div>
        </div>
        {chat.messages.length >= 4 && <ChatMinimap turns={turns} scroller={viewport} />}
        {!atBottom && (
          <button
            type="button"
            className="pi-scroll-bottom"
            onClick={() => {
              follow.current = true;
              viewport.current?.scrollTo({
                top: viewport.current.scrollHeight,
                behavior: "smooth",
              });
            }}
          >
            <ArrowDown size={14} />
            回到底部
          </button>
        )}
      </div>
      <Composer
        ref={composer}
        draft={draft}
        setDraft={setDraft}
        scope={scope}
        pageScope={pageScope}
        setScope={setScope}
        busy={busy}
        onSend={() => send()}
        onStop={() => {
          void chat.stop();
          setBanner({ kind: "stopped", text: "已停止生成" });
        }}
        onCommand={run}
        lastQuestion={lastQuestion ? messageText(lastQuestion) : undefined}
        notice={
          storageError ? (
            <span role="alert" className="pi-storage-error">
              {storageError}
            </span>
          ) : undefined
        }
      />
    </>
  );
}
