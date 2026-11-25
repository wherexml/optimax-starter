import type { UIMessage } from "@optimax-starter/agent/react";
import type { AgentCitation } from "@optimax-starter/api";

export const ENTITY_HREF_PREFIX = "#agent-entity-";

export interface EntityLinkTarget {
  kind: string;
  code: string;
  to: string;
  label?: string;
  search?: Record<string, unknown>;
}

export interface EntityLinkRule {
  kind: string;
  pattern: RegExp;
  resolve: (match: RegExpExecArray) => EntityLinkTarget | null;
}

/**
 * 脚手架业务实体的快捷可点击编码注册表。
 * 业务项目可按需扩展规则；运行 `--no-example` 裁剪示例时会自动移除默认的 `AS-<编号>` 规则。
 */
export const DEFAULT_ENTITY_LINK_RULES: EntityLinkRule[] = [
  // @starter:example-assets-start
  {
    kind: "asset",
    pattern: /\bAS-([1-9]\d{0,8})\b/,
    resolve: (match) => ({
      kind: "asset",
      code: `AS-${match[1]}`,
      to: `/assets/${match[1]}`,
      label: `打开资产 AS-${match[1]}`,
    }),
  },
  // @starter:example-assets-end
];

function isCitation(value: unknown): value is AgentCitation {
  if (!value || typeof value !== "object") return false;
  const citation = value as AgentCitation;
  return (
    typeof citation.id === "string" &&
    typeof citation.title === "string" &&
    typeof citation.to === "string"
  );
}

function compareCitationIds(left: AgentCitation, right: AgentCitation): number {
  const leftNum = /^E(\d+)$/.exec(left.id);
  const rightNum = /^E(\d+)$/.exec(right.id);
  if (leftNum && rightNum) {
    return Number(leftNum[1]) - Number(rightNum[1]);
  }
  return left.id.localeCompare(right.id, "en", { numeric: true });
}

/** 提取单条助理消息自身的引用来源，元数据优先，并与完成态工具输出按 id 去重。 */
export function messageCitations(message: UIMessage): AgentCitation[] {
  const seen = new Set<string>();
  const out: AgentCitation[] = [];
  const meta = message.metadata as { citations?: unknown } | undefined;
  const push = (list: unknown) => {
    if (!Array.isArray(list)) return;
    for (const entry of list) {
      if (!isCitation(entry) || seen.has(entry.id)) continue;
      seen.add(entry.id);
      out.push(entry);
    }
  };
  push(meta?.citations);
  for (const part of message.parts) {
    if (!part.type.startsWith("tool-") || !("state" in part) || part.state !== "output-available") {
      continue;
    }
    const output = (part as { output?: { citations?: unknown } }).output;
    push(output?.citations);
  }
  return out.sort(compareCitationIds);
}

/**
 * 解析截至 `index` 轮的可见引用来源。
 * 先按会话顺序继承前序轮次来源，同编号由当前或更晚的轮次覆盖。
 */
export function resolveMessageCitations(messages: UIMessage[], index: number): AgentCitation[] {
  if (messages.length === 0 || index < 0) return [];
  const limit = Math.min(index, messages.length - 1);
  const byId = new Map<string, AgentCitation>();
  for (let i = 0; i <= limit; i += 1) {
    const entry = messages[i];
    if (entry?.role !== "assistant") continue;
    for (const citation of messageCitations(entry)) {
      byId.set(citation.id, citation);
    }
  }
  return Array.from(byId.values()).sort(compareCitationIds);
}

/** 汇总当前会话全部助理轮次产生过的引用来源（同编号以最新轮次为准）。 */
export function sessionCitations(messages: UIMessage[]): AgentCitation[] {
  return resolveMessageCitations(messages, messages.length - 1);
}

function isTokenBoundaryChar(ch: string | undefined): boolean {
  return Boolean(ch && /[A-Za-z0-9_-]/.test(ch));
}

function findNextEntityMatch(
  text: string,
  fromIndex: number,
  rules: EntityLinkRule[],
): { start: number; end: number; target: EntityLinkTarget } | null {
  let best: { start: number; end: number; target: EntityLinkTarget } | null = null;
  for (const rule of rules) {
    const flags = rule.pattern.flags.replace(/[gy]/g, "");
    const regex = new RegExp(rule.pattern.source, `${flags}g`);
    regex.lastIndex = fromIndex;
    for (;;) {
      const match = regex.exec(text);
      if (!match || match[0].length === 0) break;
      const start = match.index;
      const end = start + match[0].length;
      if (isTokenBoundaryChar(text[start - 1]) || isTokenBoundaryChar(text[end])) {
        continue;
      }
      const target = rule.resolve(match);
      if (!target) continue;
      if (!best || start < best.start || (start === best.start && end > best.end)) {
        best = { start, end, target };
      }
      break;
    }
  }
  return best;
}

/** 精确匹配单个完整业务编码 token（用于行内 code 标签等精确场景）。 */
export function resolveEntityToken(
  token: string,
  rules: EntityLinkRule[] = DEFAULT_ENTITY_LINK_RULES,
): EntityLinkTarget | null {
  const trimmed = token.trim();
  if (!trimmed || rules.length === 0) return null;
  for (const rule of rules) {
    const flags = rule.pattern.flags.replace(/[gy]/g, "");
    const regex = new RegExp(`^(?:${rule.pattern.source})$`, flags);
    const match = regex.exec(trimmed);
    if (!match) continue;
    const target = rule.resolve(match);
    if (target) return target;
  }
  return null;
}

/** 将纯文本拆分为普通字符串与识别出的实体目标，便于表格单元格等纯文本场景渲染芯片。 */
export function splitTextByEntityTokens(
  text: string,
  rules: EntityLinkRule[] = DEFAULT_ENTITY_LINK_RULES,
): Array<string | EntityLinkTarget> {
  if (!text || rules.length === 0) return [text];
  const segments: Array<string | EntityLinkTarget> = [];
  let cursor = 0;
  while (cursor < text.length) {
    const next = findNextEntityMatch(text, cursor, rules);
    if (!next) break;
    if (next.start > cursor) {
      segments.push(text.slice(cursor, next.start));
    }
    segments.push(next.target);
    cursor = next.end;
  }
  if (cursor < text.length) {
    segments.push(text.slice(cursor));
  }
  return segments.length > 0 ? segments : [text];
}

/**
 * 将 Markdown 正文中的业务实体编码重写为可点击实体链接，
 * 自动跳过围栏代码块、行内代码以及已存在的 Markdown 链接或引用标记。
 */
export function rewriteMarkdownEntityTokens(
  markdown: string,
  rules: EntityLinkRule[] = DEFAULT_ENTITY_LINK_RULES,
): string {
  if (!markdown || rules.length === 0) return markdown;
  return markdown
    .split(/(```[\s\S]*?```|`[^`\n]*`|\[[^\]\n]+\]\([^)\n]+\))/)
    .map((segment, index) => {
      if (index % 2 === 1) return segment;
      const pieces = splitTextByEntityTokens(segment, rules);
      return pieces
        .map((piece) =>
          typeof piece === "string"
            ? piece
            : `[${piece.code}](${ENTITY_HREF_PREFIX}${encodeURIComponent(piece.code)})`,
        )
        .join("");
    })
    .join("");
}
