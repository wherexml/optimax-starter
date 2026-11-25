import type { UIMessage } from "@optimax-starter/agent/react";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_ENTITY_LINK_RULES,
  ENTITY_HREF_PREFIX,
  type EntityLinkRule,
  messageCitations,
  resolveEntityToken,
  resolveMessageCitations,
  rewriteMarkdownEntityTokens,
  sessionCitations,
  splitTextByEntityTokens,
} from "./assistant-links-utils";

const ASSET_RULE: EntityLinkRule = {
  kind: "asset",
  pattern: /\bAS-([1-9]\d{0,8})\b/,
  resolve: (match) => ({
    kind: "asset",
    code: `AS-${match[1]}`,
    to: `/assets/${match[1]}`,
    label: `查看资产 AS-${match[1]}`,
  }),
};

const TICKET_RULE: EntityLinkRule = {
  kind: "ticket",
  pattern: /\bTK-(\d{3,6})\b/,
  resolve: (match) => ({
    kind: "ticket",
    code: `TK-${match[1]}`,
    to: `/tickets/${match[1]}`,
  }),
};

function makeAssistantMessage(
  id: string,
  citations: Array<{ id: string; title: string; to: string; snippet?: string }>,
  metaCitations?: Array<{ id: string; title: string; to: string; snippet?: string }>,
): UIMessage {
  return {
    id,
    role: "assistant",
    parts: citations.length
      ? [
          {
            type: "tool-lookup" as `tool-${string}`,
            toolCallId: `call-${id}`,
            state: "output-available",
            input: {},
            output: { citations },
          } as UIMessage["parts"][number],
        ]
      : [{ type: "text", text: "ok" }],
    metadata: metaCitations ? { citations: metaCitations } : undefined,
  };
}

function makeUserMessage(id: string, text = "hello"): UIMessage {
  return {
    id,
    role: "user",
    parts: [{ type: "text", text }],
  };
}

describe("cross-turn citations resolution", () => {
  it("extracts citations from both metadata and tool outputs without duplicates", () => {
    const msg = makeAssistantMessage(
      "a1",
      [
        { id: "E1", title: "tool E1", to: "/assets/1000" },
        { id: "E2", title: "tool E2", to: "/assets/992" },
      ],
      [{ id: "E1", title: "meta E1", to: "/assets/1000" }],
    );

    expect(messageCitations(msg)).toEqual([
      { id: "E1", title: "meta E1", to: "/assets/1000" },
      { id: "E2", title: "tool E2", to: "/assets/992" },
    ]);
  });

  it("inherits citations from earlier assistant turns while letting newer turns override colliding ids", () => {
    const messages: UIMessage[] = [
      makeUserMessage("u1", "查一下 AS-1000"),
      makeAssistantMessage("a1", [
        { id: "E1", title: "旧版 E1", to: "/assets/992" },
        { id: "E2", title: "财务共享域", to: "/assets/984" },
      ]),
      makeUserMessage("u2", "结合上面继续总结"),
      makeAssistantMessage("a2", [{ id: "E1", title: "新版 E1", to: "/assets/1000" }]),
      makeUserMessage("u3", "再确认一下 E2"),
      makeAssistantMessage("a3", []),
    ];

    expect(resolveMessageCitations(messages, 1).map((c) => [c.id, c.title])).toEqual([
      ["E1", "旧版 E1"],
      ["E2", "财务共享域"],
    ]);

    expect(resolveMessageCitations(messages, 3).map((c) => [c.id, c.title])).toEqual([
      ["E1", "新版 E1"],
      ["E2", "财务共享域"],
    ]);

    expect(resolveMessageCitations(messages, 5).map((c) => [c.id, c.title])).toEqual([
      ["E1", "新版 E1"],
      ["E2", "财务共享域"],
    ]);

    expect(sessionCitations(messages).map((c) => [c.id, c.title])).toEqual([
      ["E1", "新版 E1"],
      ["E2", "财务共享域"],
    ]);
  });

  it("returns empty citations for empty or user-only sessions", () => {
    expect(sessionCitations([])).toEqual([]);
    expect(sessionCitations([makeUserMessage("u1")])).toEqual([]);
  });
});

describe("entity link chip registry utilities", () => {
  const rules = [ASSET_RULE, TICKET_RULE];

  it("resolves exact inline entity tokens without partial suffix/prefix leakage", () => {
    expect(resolveEntityToken("AS-1000", rules)).toEqual({
      kind: "asset",
      code: "AS-1000",
      to: "/assets/1000",
      label: "查看资产 AS-1000",
    });
    expect(resolveEntityToken(" TK-2048 ", rules)).toEqual({
      kind: "ticket",
      code: "TK-2048",
      to: "/tickets/2048",
    });
    expect(resolveEntityToken("AS-1000-extra", rules)).toBeNull();
    expect(resolveEntityToken("AS-0", rules)).toBeNull();
    expect(resolveEntityToken("prefix AS-1000", rules)).toBeNull();
  });

  it("rewrites prose entity tokens into entity links while leaving fenced code, inline code, and links untouched", () => {
    const input = [
      "请先看 AS-1000，再对比 [AS-992](#citation-E1) 与 TK-1024。",
      "",
      "内联代码 `AS-888` 不在正文改写。",
      "",
      "```json",
      '{"code": "AS-777", "ticket": "TK-999"}',
      "```",
    ].join("\n");

    const output = rewriteMarkdownEntityTokens(input, rules);
    expect(output).toContain(`[AS-1000](${ENTITY_HREF_PREFIX}AS-1000)`);
    expect(output).toContain("[AS-992](#citation-E1)");
    expect(output).toContain(`[TK-1024](${ENTITY_HREF_PREFIX}TK-1024)`);
    expect(output).toContain("`AS-888`");
    expect(output).toContain('{"code": "AS-777", "ticket": "TK-999"}');
  });

  it("does not match partial alphanumeric sequences when rewriting prose", () => {
    const output = rewriteMarkdownEntityTokens(
      "前缀FOO-AS-1000后缀BAR 和 AS-1000A 与 AS-1000",
      rules,
    );
    expect(output).toBe(
      `前缀FOO-AS-1000后缀BAR 和 AS-1000A 与 [AS-1000](${ENTITY_HREF_PREFIX}AS-1000)`,
    );
  });

  it("splits table cell strings into ordered plain text and entity targets", () => {
    expect(splitTextByEntityTokens("影响 AS-1000 与 TK-305 共两项", rules)).toEqual([
      "影响 ",
      {
        kind: "asset",
        code: "AS-1000",
        to: "/assets/1000",
        label: "查看资产 AS-1000",
      },
      " 与 ",
      {
        kind: "ticket",
        code: "TK-305",
        to: "/tickets/305",
      },
      " 共两项",
    ]);
  });

  it("exposes starter default entity rules cleanly whether example assets are kept or stripped", () => {
    if (DEFAULT_ENTITY_LINK_RULES.length > 0) {
      expect(resolveEntityToken("AS-1000")?.to).toBe("/assets/1000");
    } else {
      expect(resolveEntityToken("AS-1000")).toBeNull();
    }
  });
});
