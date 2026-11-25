// Message surfaces adapted from Beautiful Pi Web MessageView / MarkdownBody (4a308ed, MIT, see beautiful-pi/LICENSE).
import type { ToolUIPart, UIMessage } from "@optimax-starter/agent/react";
import { Brain, Check, ChevronRight, Copy, Files, GitFork, Quote, RefreshCw } from "lucide-react";
import { memo, type ReactNode, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AgentCitation } from "./api";
import { AgentLoadingState } from "./beautiful-pi/AgentLoadingState";
import { CodeBlock } from "./beautiful-pi/CodeBlock";
import { copyText } from "./beautiful-pi/clipboard";
import { RichDataTable } from "./beautiful-pi/RichDataTable";
import { CITATION_HREF_PREFIX, extractHastTable } from "./beautiful-pi/data-table";
import {
  ENTITY_HREF_PREFIX,
  resolveEntityToken,
  rewriteMarkdownEntityTokens,
  splitTextByEntityTokens,
} from "./assistant-links-utils";
import { CitationLink } from "./CitationLink";
import { EntityRefChip } from "./EntityRefChip";
import { type MessageMeta, messageCitations, messageText, readableAssistantText } from "./session";
import { ApprovalCard, ToolGroup, toolName, WRITE_TOOLS } from "./ToolSteps";

function renderRichMarkdown(markdown: string, citations: AgentCitation[]) {
  // Literal examples in fenced or inline code are not rewritten. Unknown ids stay plain text.
  const withCitations = markdown
    .split(/(```[\s\S]*?```|`[^`\n]*`)/)
    .map((part, index) =>
      index % 2
        ? part
        : part.replace(/\[\[(E\d+)\]\]|\[(E\d+)\](?!\()/g, (_, wrapped, bare) => {
            const id = wrapped || bare;
            return citations.some((citation) => citation.id === id)
              ? `[${id}](${CITATION_HREF_PREFIX}${id})`
              : `\\[\\[${id}\\]\\]`;
          }),
    )
    .join("");
  return rewriteMarkdownEntityTokens(withCitations);
}

/** Table cells carry [[E1]] tokens from extractHastTable or registered entity tokens; both become pills/chips. */
function richCell(value: string, citations: AgentCitation[]): ReactNode {
  const parts = value.includes("[[E") ? value.split(/(\[\[E\d+\]\])/) : [value];
  const nodes: ReactNode[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i] ?? "";
    const id = /^\[\[(E\d+)\]\]$/.exec(part)?.[1];
    if (id) {
      const source = citations.find((citation) => citation.id === id);
      nodes.push(source ? <CitationLink key={`c-${i}`} source={source} compact /> : part);
      continue;
    }
    const pieces = splitTextByEntityTokens(part);
    for (let j = 0; j < pieces.length; j += 1) {
      const piece = pieces[j];
      if (typeof piece === "string") {
        if (piece) nodes.push(piece);
      } else if (piece) {
        nodes.push(<EntityRefChip key={`e-${i}-${j}`} target={piece} compact />);
      }
    }
  }
  return nodes.length === 1 ? nodes[0] : nodes;
}

const CITATION_LINK = new RegExp(`^${CITATION_HREF_PREFIX}(E\\d+)$`);

export const Markdown = memo(function Markdown({
  text,
  citations,
}: {
  text: string;
  citations: AgentCitation[];
}) {
  return (
    <div className="pi-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          img({ alt }) {
            return <span>{alt}</span>;
          },
          pre({ children }) {
            return <>{children}</>;
          },
          code({ className, children }) {
            const body = String(children);
            const language = /language-([\w-]+)/.exec(className ?? "")?.[1];
            if (language || body.includes("\n")) {
              return <CodeBlock language={language ?? ""} text={body} />;
            }
            const target = resolveEntityToken(body);
            return target ? <EntityRefChip target={target} compact /> : <code>{children}</code>;
          },
          table({ node, children }) {
            const data = extractHastTable(node);
            return data ? (
              <RichDataTable {...data} renderCell={(value) => richCell(value, citations)} />
            ) : (
              <table>{children}</table>
            );
          },
          a({ href, children }) {
            const rawHref = href ?? "";
            if (rawHref.startsWith(ENTITY_HREF_PREFIX)) {
              const code = decodeURIComponent(rawHref.slice(ENTITY_HREF_PREFIX.length));
              const target = resolveEntityToken(code);
              if (target) return <EntityRefChip target={target} compact />;
            }
            const id = CITATION_LINK.exec(rawHref)?.[1];
            const source = id ? citations.find((citation) => citation.id === id) : undefined;
            return source ? <CitationLink source={source} compact /> : <span>{children}</span>;
          },
        }}
      >
        {renderRichMarkdown(text, citations)}
      </ReactMarkdown>
    </div>
  );
});

function Thinking({ text, streaming }: { text: string; streaming: boolean }) {
  return (
    <details className="pi-thinking" open={streaming || undefined}>
      <summary>
        <Brain size={14} aria-hidden="true" />
        {streaming ? "正在思考…" : "思考过程"}
        <ChevronRight size={13} className="pi-thinking-chevron" aria-hidden="true" />
      </summary>
      <p>{text}</p>
    </details>
  );
}

function IconAction({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="pi-icon pi-msg-action"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function CopyAction({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <IconAction
      label="复制回答"
      onClick={() =>
        void copyText(text).then((ok) => {
          if (!ok) return;
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        })
      }
    >
      {copied ? <Check size={15} /> : <Copy size={15} />}
    </IconAction>
  );
}

function metaLine(meta: MessageMeta | undefined) {
  return [
    meta?.model || "智能助理",
    meta?.totalTokens ? `${meta.totalTokens} tokens` : "",
    meta?.elapsedMs ? `${(meta.elapsedMs / 1000).toFixed(1)}s` : "",
  ]
    .filter(Boolean)
    .join(" | ");
}

type Segment = { key: string } & (
  | { kind: "text"; text: string }
  | { kind: "reasoning"; text: string; streaming: boolean }
  | { kind: "tools"; parts: ToolUIPart[] }
  | { kind: "approval"; part: ToolUIPart }
);

function segments(message: UIMessage): Segment[] {
  const result: Segment[] = [];
  message.parts.forEach((part, index) => {
    const key = String(index);
    if (part.type === "text") {
      if (part.text) result.push({ key, kind: "text", text: readableAssistantText(part.text) });
      return;
    }
    if (part.type === "reasoning") {
      if (part.text.trim()) {
        result.push({
          key,
          kind: "reasoning",
          text: readableAssistantText(part.text),
          streaming: part.state === "streaming",
        });
      }
      return;
    }
    if (!part.type.startsWith("tool-")) return;
    const tool = part as ToolUIPart;
    if (WRITE_TOOLS.has(toolName(tool))) {
      result.push({ key, kind: "approval", part: tool });
      return;
    }
    const last = result.at(-1);
    if (last?.kind === "tools") last.parts.push(tool);
    else result.push({ key, kind: "tools", parts: [tool] });
  });
  return result;
}

export function StreamMessage({
  message,
  inheritedCitations,
  live,
  busy,
  respond,
  onRegenerate,
  onFork,
  onQuote,
  onSources,
}: {
  message: UIMessage;
  inheritedCitations?: AgentCitation[];
  live: boolean;
  busy: boolean;
  respond: (id: string, approved: boolean) => void;
  onRegenerate?: () => void;
  onFork?: () => void;
  onQuote?: (text: string) => void;
  onSources?: (citations: AgentCitation[]) => void;
}) {
  if (message.role === "user") {
    const scope = (message.metadata as { scope?: string } | undefined)?.scope;
    return (
      <article className="pi-msg-user" aria-label="问题">
        {scope && (
          <span className="pi-msg-user-scope">
            <Files size={12} aria-hidden="true" />
            {scope}
          </span>
        )}
        <p className="pi-msg-user-pill">{messageText(message)}</p>
      </article>
    );
  }
  const citations = inheritedCitations ?? messageCitations(message);
  const meta = message.metadata as MessageMeta | undefined;
  const parts = segments(message);
  const text = messageText(message);
  const tail = parts.at(-1);
  const waiting =
    live &&
    (!tail ||
      (tail.kind === "tools" && tail.parts.every((part) => part.state === "output-available")));
  return (
    <article className="pi-msg-assistant" aria-label="回答" data-live={live || undefined}>
      {parts.map((segment) =>
        segment.kind === "text" ? (
          <Markdown key={segment.key} text={segment.text} citations={citations} />
        ) : segment.kind === "reasoning" ? (
          <Thinking key={segment.key} text={segment.text} streaming={live && segment.streaming} />
        ) : segment.kind === "tools" ? (
          <ToolGroup key={segment.key} parts={segment.parts} running={live} />
        ) : (
          <ApprovalCard key={segment.key} part={segment.part} busy={busy} respond={respond} />
        ),
      )}
      {waiting && <AgentLoadingState label={tail ? "正在整理结果…" : "正在查询数据…"} compact />}
      {live && tail?.kind === "text" && (
        <span className="pi-streaming-caret" role="status" aria-label="生成中" />
      )}
      {!live && (
        <footer className="pi-msg-footer">
          <span className="pi-msg-meta">{metaLine(meta)}</span>
          {citations.length > 0 && onSources && (
            <button type="button" className="pi-msg-sources" onClick={() => onSources(citations)}>
              <Files size={13} aria-hidden="true" />
              引用来源 {citations.length}
            </button>
          )}
          <span className="pi-msg-actions">
            {text && <CopyAction text={text} />}
            {onRegenerate && (
              <IconAction label="重新生成" onClick={onRegenerate}>
                <RefreshCw size={15} />
              </IconAction>
            )}
            {onFork && (
              <IconAction label="从此处新建分支" onClick={onFork}>
                <GitFork size={15} />
              </IconAction>
            )}
            {text && onQuote && (
              <IconAction label="引用追问" onClick={() => onQuote(text)}>
                <Quote size={15} />
              </IconAction>
            )}
          </span>
        </footer>
      )}
    </article>
  );
}
