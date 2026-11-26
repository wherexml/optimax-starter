// Capsule composer with slash commands and entity mentions, powered by @ui-sdk/react/trigger-menu.
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@optimax-starter/ui/components/tooltip";
import {
  type TriggerDefinition,
  TriggerMenu,
  TriggerMenuContent,
  type TriggerMenuDataItem,
  TriggerMenuEmpty,
  TriggerMenuInput,
  TriggerMenuItem,
  TriggerMenuList,
  createTriggerMenuController,
} from "@ui-sdk/react/trigger-menu";
import {
  ArrowUp,
  AtSign,
  Download,
  LayoutDashboard,
  MessageSquarePlus,
  Navigation,
  Square,
  X,
} from "lucide-react";

function SkillCommandIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 4h8.5A1.5 1.5 0 0 1 15 5.5V16H6.5A1.5 1.5 0 0 1 5 14.5z" />
      <path d="M5 13.5A1.5 1.5 0 0 1 6.5 12H15M8 7.5h4" />
    </svg>
  );
}

// @starter:example-assets-start
import { ChartPie, Search } from "lucide-react";
// @starter:example-assets-end
import {
  forwardRef,
  type ReactNode,
  useEffect,
  useId,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type EntitySearchResult,
  hasEntitySearchProviders,
  searchConsoleEntities,
} from "@/features/navigation/entity-search";
import type { AgentScope } from "./api";
import { scopeLabel } from "./session";

export type Command = {
  id: string;
  description: string;
  icon: ReactNode;
  /** Sent as the question. Commands without a prompt run a local action. */
  prompt?: string;
  action?: "new" | "export";
};

export const COMMANDS: Command[] = [
  {
    id: "overview",
    description: "查看我的角色、可访问模块与系统概况",
    icon: <LayoutDashboard size={15} />,
    prompt: "请查看控制台概览，说明我当前的角色、可访问的模块和需要关注的事项。",
  },
  {
    id: "navigate",
    description: "让助理打开某个控制台页面",
    icon: <Navigation size={15} />,
    prompt: "请帮我打开",
  },
  // @starter:example-assets-start
  {
    id: "assets",
    description: "检索资产台账（可补充关键字、业务域或阶段）",
    icon: <Search size={15} />,
    prompt: "检索资产台账中待复核的资产，用表格列出名称、业务域、责任团队，并标注引用。",
  },
  {
    id: "summary",
    description: "统计资产按阶段与业务域的分布",
    icon: <ChartPie size={15} />,
    prompt: "统计资产台账按阶段和业务域的分布，用表格展示并给出简短结论。",
  },
  // @starter:example-assets-end
  {
    id: "new",
    description: "新建空白对话",
    icon: <MessageSquarePlus size={15} />,
    action: "new",
  },
  {
    id: "export",
    description: "导出当前对话为 Markdown",
    icon: <Download size={15} />,
    action: "export",
  },
];

export const MAX_DRAFT = 3000;

function ComposerAction({
  label,
  hint,
  children,
  onClick,
}: {
  label: string;
  hint: string;
  children: ReactNode;
  onClick: () => void;
}) {
  const hintId = useId();
  return (
    <Tooltip>
      <TooltipTrigger
        type="button"
        className="pi-tool-button"
        aria-label={label}
        aria-describedby={hintId}
        onClick={onClick}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent id={hintId} className="whitespace-nowrap rounded-md" sideOffset={6}>
        {hint}
      </TooltipContent>
    </Tooltip>
  );
}

function estimateTokens(text: string) {
  const cjk = text.match(/[㐀-鿿豈-﫿]/g)?.length ?? 0;
  return Math.ceil(cjk + (text.length - cjk) / 4);
}

export type ComposerHandle = { focus: () => void };
export type ComposerProps = {
  draft: string;
  setDraft: (value: string) => void;
  scope?: AgentScope;
  /** Scope of the page behind the drawer; offered again after the chip is removed. */
  pageScope?: AgentScope;
  setScope: (scope?: AgentScope) => void;
  busy: boolean;
  onSend: () => void;
  onStop: () => void;
  onCommand: (command: Command) => void;
  lastQuestion?: string;
  notice?: ReactNode;
};

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  {
    draft,
    setDraft,
    scope,
    pageScope,
    setScope,
    busy,
    onSend,
    onStop,
    onCommand,
    lastQuestion,
    notice,
  },
  ref,
) {
  const editor = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const lastComposition = useRef(0);
  const entityMapRef = useRef<Map<string, EntitySearchResult>>(new Map());
  const [menuController] = useState(createTriggerMenuController);
  const [menuOpen, setMenuOpen] = useState(false);

  useImperativeHandle(ref, () => ({ focus: () => editor.current?.focus() }), []);

  useEffect(() => {
    const el = editor.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [draft]);

  const entitiesEnabled = hasEntitySearchProviders();
  const commandById = useMemo(() => new Map(COMMANDS.map((item) => [item.id, item])), []);

  const triggers = useMemo<TriggerDefinition[]>(() => {
    const list: TriggerDefinition[] = [
      {
        char: "/",
        boundary: "start",
        type: "command",
        items: COMMANDS.map((cmd) => ({
          value: cmd.id,
          label: cmd.id,
          keywords: [cmd.id, cmd.description],
        })),
      },
    ];
    if (entitiesEnabled) {
      list.push({
        char: "@",
        type: "mention",
        items: async (query, { signal }) => {
          const rows = await searchConsoleEntities(query, signal);
          for (const row of rows) {
            entityMapRef.current.set(row.code, row);
          }
          return rows.map((row) => ({
            value: row.code,
            label: row.code,
            keywords: [row.code, row.title, row.subtitle ?? ""],
          }));
        },
      });
    }
    return list;
  }, [entitiesEnabled]);

  function openCommands() {
    setDraft("");
    requestAnimationFrame(() => {
      editor.current?.focus();
      void menuController.open({ trigger: "/" });
    });
  }

  function openMentions() {
    editor.current?.focus();
    void menuController.open({ trigger: "@" });
  }

  const label = scopeLabel(scope);
  const tokens = draft.trim() ? estimateTokens(draft) : 0;

  return (
    <div className="pi-composer-wrap">
      <TriggerMenu
        controller={menuController}
        triggers={triggers}
        open={menuOpen}
        onOpenChange={(next) => setMenuOpen(next)}
        onSelect={(value, details) => {
          if (details.trigger === "/") {
            details.preventDefault();
            const cmd = commandById.get(String(value));
            if (cmd) {
              setDraft("");
              onCommand(cmd);
            }
          }
        }}
      >
        <div className="pi-prompt-shell" data-busy={busy || undefined}>
          <TriggerMenuContent side="top" align="start" sideOffset={8} className="pi-trigger-popup">
            {(state) => (
              <>
                <div className="pi-command-heading">
                  {state.trigger === "@" ? "引用业务实体" : "快捷指令"}
                </div>
                <TriggerMenuEmpty className="pi-command-empty">
                  {(emptyState) =>
                    emptyState.loading
                      ? "正在检索业务实体…"
                      : state.trigger === "@"
                        ? "未找到匹配实体"
                        : "未找到匹配指令"
                  }
                </TriggerMenuEmpty>
                <TriggerMenuList className="pi-trigger-list">
                  {(listState) =>
                    (listState.items as TriggerMenuDataItem[]).map((item) => {
                      if (listState.trigger === "/") {
                        const cmd = commandById.get(String(item.value));
                        if (!cmd) return null;
                        return (
                          <TriggerMenuItem
                            key={cmd.id}
                            value={cmd.id}
                            label={cmd.id}
                            className="pi-trigger-item"
                          >
                            <span className="pi-command-icon">{cmd.icon}</span>
                            <span className="pi-command-name">/{cmd.id}</span>
                            <span className="pi-command-desc">{cmd.description}</span>
                          </TriggerMenuItem>
                        );
                      }
                      const entity = entityMapRef.current.get(String(item.value));
                      return (
                        <TriggerMenuItem
                          key={String(item.value)}
                          value={String(item.value)}
                          label={String(item.label ?? item.value)}
                          className="pi-trigger-item"
                        >
                          <span className="pi-command-icon">
                            <AtSign size={14} />
                          </span>
                          <span className="pi-command-name">
                            {entity?.code ?? String(item.value)}
                          </span>
                          <span className="pi-command-desc">
                            {entity
                              ? entity.subtitle
                                ? `${entity.title}（${entity.subtitle}）`
                                : entity.title
                              : String(item.label ?? item.value)}
                          </span>
                        </TriggerMenuItem>
                      );
                    })
                  }
                </TriggerMenuList>
              </>
            )}
          </TriggerMenuContent>
          {label && (
            <div className="pi-attachments">
              <span className="pi-context-chip" title="本次提问附带的页面范围">
                <AtSign size={13} aria-hidden="true" />
                <span>{label}</span>
                <button
                  type="button"
                  className="pi-context-clear"
                  aria-label="移除页面范围"
                  title="移除页面范围"
                  onClick={() => setScope(undefined)}
                >
                  <X size={13} />
                </button>
              </span>
            </div>
          )}
          <TriggerMenuInput
            ref={editor}
            rows={1}
            maxLength={MAX_DRAFT}
            aria-label="输入问题"
            placeholder={
              entitiesEnabled ? "输入问题，/ 打开快捷指令，@ 引用实体" : "输入问题，/ 打开快捷指令"
            }
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
              lastComposition.current = Date.now();
            }}
            onKeyDown={(event) => {
              const ime =
                composing.current || event.nativeEvent.isComposing || event.keyCode === 229;
              if (ime) return;
              if (menuOpen) return;
              if (event.key === "ArrowUp" && !draft && lastQuestion) {
                event.preventDefault();
                setDraft(lastQuestion);
                return;
              }
              if (event.key !== "Enter" || event.shiftKey) return;
              if (Date.now() - lastComposition.current < 100) {
                event.preventDefault();
                return;
              }
              if (matchMedia("(pointer: coarse)").matches && !event.ctrlKey && !event.metaKey)
                return;
              event.preventDefault();
              if (!busy) onSend();
            }}
          />
          <div className="pi-composer-toolbar">
            <TooltipProvider delay={180}>
              <div className="pi-toolbar-left">
                <ComposerAction label="快捷指令" hint="查看快捷指令" onClick={openCommands}>
                  <SkillCommandIcon size={16} />
                </ComposerAction>
                {entitiesEnabled && (
                  <ComposerAction
                    label="引用实体"
                    hint="输入 @ 引用业务实体"
                    onClick={openMentions}
                  >
                    <AtSign size={16} />
                  </ComposerAction>
                )}
                {pageScope && !label && (
                  <ComposerAction
                    label="附带当前页面"
                    hint={`附带当前页面：${scopeLabel(pageScope)}`}
                    onClick={() => setScope(pageScope)}
                  >
                    <Navigation size={15} />
                  </ComposerAction>
                )}
              </div>
            </TooltipProvider>
            <div className="pi-toolbar-right">
              {tokens > 0 && (
                <span className="pi-token-hint" title="按字符估算">
                  {draft.length}/{MAX_DRAFT} 约 {tokens} tokens
                </span>
              )}
              {busy ? (
                <button
                  className="pi-send is-stop"
                  type="button"
                  aria-label="停止生成"
                  title="停止生成"
                  onClick={onStop}
                >
                  <Square size={14} />
                </button>
              ) : (
                <button
                  className="pi-send"
                  type="button"
                  disabled={!draft.trim()}
                  aria-label="发送"
                  title="发送（Enter）"
                  onClick={onSend}
                >
                  <ArrowUp size={17} />
                </button>
              )}
            </div>
          </div>
        </div>
      </TriggerMenu>
      {notice && <div className="pi-composer-meta">{notice}</div>}
    </div>
  );
});
