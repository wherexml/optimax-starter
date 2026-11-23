// Capsule composer with slash commands, adapted from Beautiful Pi Web ChatInput (4a308ed, MIT, see beautiful-pi/LICENSE).
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@optimax-starter/ui/components/tooltip";
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

function fuzzy(text: string, query: string) {
  const haystack = text.toLocaleLowerCase();
  const needle = query.toLocaleLowerCase().trim();
  if (!needle || haystack.includes(needle)) return true;
  let at = 0;
  for (const char of needle) {
    at = haystack.indexOf(char, at);
    if (at < 0) return false;
    at += 1;
  }
  return true;
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
  const [query, setQuery] = useState<string>();
  const [index, setIndex] = useState(0);
  const menuId = useId();
  useImperativeHandle(ref, () => ({ focus: () => editor.current?.focus() }), []);

  useEffect(() => {
    const el = editor.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [draft]);

  const options = useMemo(
    () =>
      query === undefined
        ? []
        : COMMANDS.filter(({ id, description }) => fuzzy(id, query) || fuzzy(description, query)),
    [query],
  );
  useEffect(() => {
    setIndex(0);
  }, [query]);

  function detect(value: string) {
    const slash = /^\/(\S*)$/.exec(value);
    setQuery(slash ? (slash[1] ?? "") : undefined);
  }

  function choose(command: Command | undefined) {
    if (!command) return;
    setQuery(undefined);
    setDraft("");
    onCommand(command);
  }

  function openCommands() {
    setDraft("/");
    setQuery("");
    requestAnimationFrame(() => {
      editor.current?.focus();
      editor.current?.setSelectionRange(1, 1);
    });
  }

  const label = scopeLabel(scope);
  const tokens = draft.trim() ? estimateTokens(draft) : 0;
  const menuOpen = query !== undefined && options.length > 0;
  const optionId = (id: string) => `${menuId}-${id}`;

  return (
    <div className="pi-composer-wrap">
      <div className="pi-prompt-shell" data-busy={busy || undefined}>
        {menuOpen && (
          <div className="pi-command-menu" role="listbox" id={menuId} aria-label="快捷指令">
            <div className="pi-command-heading">快捷指令</div>
            {options.map((command, position) => (
              <button
                key={command.id}
                type="button"
                role="option"
                id={optionId(command.id)}
                aria-selected={position === index}
                onMouseEnter={() => setIndex(position)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(command)}
              >
                <span className="pi-command-icon">{command.icon}</span>
                <span className="pi-command-name">/{command.id}</span>
                <span className="pi-command-desc">{command.description}</span>
              </button>
            ))}
          </div>
        )}
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
        <textarea
          ref={editor}
          rows={1}
          role="combobox"
          maxLength={MAX_DRAFT}
          aria-label="输入问题"
          placeholder="输入问题，/ 打开快捷指令"
          value={draft}
          aria-controls={menuOpen ? menuId : undefined}
          aria-expanded={menuOpen}
          aria-activedescendant={
            menuOpen && options[index] ? optionId(options[index].id) : undefined
          }
          onChange={(event) => {
            setDraft(event.target.value);
            detect(event.target.value);
          }}
          onBlur={() => setQuery(undefined)}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
            lastComposition.current = Date.now();
          }}
          onKeyDown={(event) => {
            const ime = composing.current || event.nativeEvent.isComposing || event.keyCode === 229;
            if (menuOpen && !ime) {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setIndex((index + 1) % options.length);
                return;
              }
              if (event.key === "ArrowUp") {
                event.preventDefault();
                setIndex((index - 1 + options.length) % options.length);
                return;
              }
              if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault();
                choose(options[index]);
                return;
              }
            }
            if (query !== undefined && event.key === "Escape") {
              event.preventDefault();
              setQuery(undefined);
              return;
            }
            if (event.key === "ArrowUp" && !draft && lastQuestion && !ime) {
              event.preventDefault();
              setDraft(lastQuestion);
              return;
            }
            if (event.key !== "Enter" || event.shiftKey || ime) return;
            if (Date.now() - lastComposition.current < 100) {
              event.preventDefault();
              return;
            }
            if (matchMedia("(pointer: coarse)").matches && !event.ctrlKey && !event.metaKey) return;
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
              {pageScope && !label && (
                <ComposerAction
                  label="附带当前页面"
                  hint={`附带当前页面：${scopeLabel(pageScope)}`}
                  onClick={() => setScope(pageScope)}
                >
                  <AtSign size={16} />
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
      {notice && <div className="pi-composer-meta">{notice}</div>}
    </div>
  );
});
