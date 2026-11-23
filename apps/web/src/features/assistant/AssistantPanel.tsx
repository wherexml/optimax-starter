// Assistant workbench inside the right-hand drawer. Layout adapted from Beautiful Pi Web ChatWindow / AppShell (4a308ed, MIT, see beautiful-pi/LICENSE).
import { Link } from "@tanstack/react-router";
import {
  Download,
  Files,
  History as HistoryIcon,
  Maximize2,
  Minimize2,
  Plus,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { APP_CONFIG } from "@/config/app-config";
import type { Account } from "@/console-client";
import { hasPermission, useAccount } from "@/features/auth/session";
import { AssistantBrandMark } from "./AssistantBrandMark";
import { type AssistantRequest, useAssistantAvailability } from "./AssistantDrawer";
import type { AgentCitation, AgentScope, AgentStatusResponse } from "./api";
import { BranchNavigator } from "./beautiful-pi/BranchNavigator";
import { Conversation } from "./Conversation";
import { SessionRail } from "./SessionRail";
import { SourceRail } from "./SourceRail";
import {
  blankSession,
  capSessions,
  exportMarkdown,
  type History,
  historyKey,
  readHistory,
  type Session,
  turnCount,
  writeHistory,
} from "./session";

type PanelProps = {
  request: AssistantRequest;
  wide: boolean;
  onExpand: () => void;
  onClose: () => void;
};

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      className="pi-icon"
      aria-label="关闭智能助理"
      title="关闭（Esc）"
      onClick={onClose}
    >
      <X size={17} />
    </button>
  );
}

function Unavailable({
  status,
  account,
  onClose,
}: {
  status?: AgentStatusResponse;
  account?: Account;
  onClose: () => void;
}) {
  const canOpenSettings =
    hasPermission(account, "system:settings:read") ||
    hasPermission(account, "system:settings:manage");
  const circuit = status?.circuitOpen;
  return (
    <div className="pi-workspace" data-panel>
      <section className="pi-chat" aria-label="智能助理">
        <header className="pi-chat-header">
          <div className="pi-title">
            <AssistantBrandMark size={20} className="pi-panel-mark" />
            <h1>智能助理</h1>
          </div>
          <div className="pi-header-actions">
            <CloseButton onClose={onClose} />
          </div>
        </header>
        <div className="pi-unavailable" role="status">
          {!status ? (
            <p>正在读取助理状态…</p>
          ) : circuit ? (
            <>
              <strong>全局 AI 熔断开关已开启，暂不可对话</strong>
              <p>熔断解除后即可继续使用智能助理。</p>
            </>
          ) : (
            <>
              <strong>模型尚未配置</strong>
              {canOpenSettings ? (
                <Link
                  to="/system"
                  search={{ tab: "settings" }}
                  className="pi-button is-primary"
                  onClick={onClose}
                >
                  前往系统配置填写或启用模型
                </Link>
              ) : (
                <p>请联系管理员配置模型。</p>
              )}
            </>
          )}
          <button type="button" className="pi-button" onClick={onClose}>
            关闭
          </button>
        </div>
      </section>
    </div>
  );
}

export default function AssistantPanel(props: PanelProps) {
  const me = useAccount();
  const { status } = useAssistantAvailability();
  if (!me.data || !status?.enabled) {
    return <Unavailable status={status} account={me.data} onClose={props.onClose} />;
  }
  return <Workbench key={me.data.id} account={me.data} status={status} {...props} />;
}

function Workbench({
  account,
  status,
  request,
  wide,
  onExpand,
  onClose,
}: PanelProps & { account: Account; status: AgentStatusResponse }) {
  const key = historyKey(account.id);
  const [history, setHistory] = useState<History>(() => readHistory(key));
  const [rail, setRail] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [turnSources, setTurnSources] = useState<AgentCitation[]>([]);
  const [shownSources, setShownSources] = useState<AgentCitation[]>();
  const [storageError, setStorageError] = useState("");
  const [busy, setBusy] = useState(false);
  const current =
    history.sessions.find((session) => session.id === history.active) ?? history.sessions[0];

  useEffect(() => {
    setStorageError(writeHistory(key, history));
  }, [history, key]);
  useEffect(() => {
    setShownSources(undefined);
    setTurnSources([]);
  }, [current?.id]);

  // A new page scope attaches to an empty session or opens a fresh one; history is never rewritten.
  useEffect(() => {
    const scope = request.scope;
    if (!scope || busy) return;
    setHistory((previous) => {
      const active = previous.sessions.find((session) => session.id === previous.active);
      if (active && sameScope(active.scope, scope)) return previous;
      if (active && !turnCount(active) && !active.draft) {
        return {
          ...previous,
          sessions: previous.sessions.map((session) =>
            session.id === active.id ? { ...session, scope } : session,
          ),
        };
      }
      const next = blankSession({ scope });
      return { active: next.id, sessions: capSessions([next, ...previous.sessions]) };
    });
  }, [request.nonce]);

  const branchNodes = useMemo(
    () =>
      history.sessions.map(({ id, title, parentId, forkTurn }) => ({
        id,
        title,
        parentId,
        forkTurn,
      })),
    [history.sessions],
  );

  if (!current) return null;

  function update(id: string, change: (session: Session) => Session) {
    setHistory((previous) => ({
      ...previous,
      sessions: previous.sessions.map((session) => (session.id === id ? change(session) : session)),
    }));
  }
  function select(id: string) {
    setHistory((previous) => ({ ...previous, active: id }));
    setRail(false);
  }
  function create(seed?: Partial<Session>) {
    const session = blankSession(seed ?? (request.scope ? { scope: request.scope } : undefined));
    setHistory((previous) => ({
      active: session.id,
      sessions: capSessions([session, ...previous.sessions]),
    }));
    setRail(false);
  }
  function remove(id: string) {
    setHistory((previous) => {
      const sessions = previous.sessions
        .filter((session) => session.id !== id)
        .map((session) =>
          session.parentId === id ? { ...session, parentId: undefined } : session,
        );
      const first = sessions[0];
      if (!first) {
        const next = blankSession();
        return { active: next.id, sessions: [next] };
      }
      return { active: previous.active === id ? first.id : previous.active, sessions };
    });
  }
  function rename(id: string, title: string) {
    update(id, (session) => ({ ...session, title: title.slice(0, 60), renamed: true }));
  }

  const railSources = shownSources ?? turnSources;
  const exportCurrent = () => exportMarkdown(current, APP_CONFIG.title);

  return (
    <div
      className="pi-workspace"
      data-panel
      data-rail={rail || undefined}
      data-sources={sourcesOpen || undefined}
    >
      {rail && (
        <>
          <div className="pi-rail-backdrop" aria-hidden="true" onClick={() => setRail(false)} />
          <SessionRail
            sessions={history.sessions}
            activeId={current.id}
            busy={busy}
            onSelect={select}
            onCreate={() => create()}
            onRename={rename}
            onDelete={remove}
            onClose={() => setRail(false)}
            onPin={(id) => update(id, (session) => ({ ...session, pinned: !session.pinned }))}
          />
        </>
      )}
      <section className="pi-chat" aria-label="智能助理">
        <header className="pi-chat-header">
          <button
            className="pi-icon"
            type="button"
            aria-label="历史对话"
            aria-pressed={rail}
            title="历史对话"
            onClick={() => setRail(!rail)}
          >
            <HistoryIcon size={16} />
          </button>
          <div className="pi-title">
            <AssistantBrandMark size={20} className="pi-panel-mark" />
            <h1 title={status.model ?? undefined}>{current.title}</h1>
            <BranchNavigator sessions={branchNodes} activeId={current.id} onSelect={select} />
          </div>
          <div className="pi-header-actions">
            <button
              className="pi-icon"
              type="button"
              aria-label="新对话"
              title="新对话"
              disabled={busy}
              onClick={() => create()}
            >
              <Plus size={17} />
            </button>
            <button
              className="pi-icon pi-sources-toggle"
              type="button"
              aria-label="引用来源"
              aria-pressed={sourcesOpen}
              title="引用来源"
              onClick={() => setSourcesOpen(!sourcesOpen)}
            >
              <Files size={16} />
              {railSources.length > 0 && <span className="pi-count">{railSources.length}</span>}
            </button>
            <button
              className="pi-icon"
              type="button"
              aria-label="导出对话"
              title="导出 Markdown"
              disabled={!turnCount(current) || busy}
              onClick={exportCurrent}
            >
              <Download size={16} />
            </button>
            <button
              type="button"
              className="pi-icon pi-expand-panel"
              aria-label={wide ? "恢复侧栏宽度" : "加宽侧栏"}
              title={wide ? "恢复侧栏宽度" : "加宽侧栏"}
              onClick={onExpand}
            >
              {wide ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
            <CloseButton onClose={onClose} />
          </div>
        </header>
        <Conversation
          key={current.id}
          session={current}
          account={account}
          pageScope={request.scope}
          storageError={storageError}
          onBusy={setBusy}
          onCitations={setTurnSources}
          onNew={() => create()}
          onExport={exportCurrent}
          onShowSources={(list) => {
            setShownSources(list);
            setSourcesOpen(true);
          }}
          save={(change) => update(current.id, change)}
          fork={(seed) => create({ ...seed, parentId: current.parentId ?? current.id })}
        />
      </section>
      {sourcesOpen && (
        <>
          <div
            className="pi-source-backdrop"
            aria-hidden="true"
            onClick={() => setSourcesOpen(false)}
          />
          <SourceRail citations={railSources} onClose={() => setSourcesOpen(false)} />
        </>
      )}
    </div>
  );
}

function sameScope(left?: AgentScope, right?: AgentScope) {
  return (
    left?.kind === right?.kind &&
    left?.route === right?.route &&
    left?.entityId === right?.entityId &&
    JSON.stringify(left?.filters ?? null) === JSON.stringify(right?.filters ?? null)
  );
}
