// Session rail adapted from Beautiful Pi Web SessionSidebar (4a308ed, MIT, see beautiful-pi/LICENSE).
import {
  GitBranch,
  MoreHorizontal,
  PanelLeftClose,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { relativeTime, type Session, scopeLabel, sessionSearchText, turnCount } from "./session";

function SessionRow({
  session,
  active,
  onOpen,
  onRename,
  onPin,
  onDelete,
}: {
  session: Session;
  active: boolean;
  onOpen: () => void;
  onRename: (title: string) => void;
  onPin: () => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState(false);
  const [title, setTitle] = useState(session.title);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent | KeyboardEvent) => {
      if (
        event instanceof KeyboardEvent
          ? event.key === "Escape"
          : !box.current?.contains(event.target as Node)
      ) {
        setMenu(false);
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menu]);

  const turns = turnCount(session);
  const scope = scopeLabel(session.scope);
  const commit = () => {
    onRename(title.trim() || session.title);
    setEditing(false);
  };
  if (editing) {
    return (
      <form
        className="pi-session-row is-editing"
        onSubmit={(event) => {
          event.preventDefault();
          commit();
        }}
      >
        <input
          autoFocus
          aria-label="对话名称"
          value={title}
          maxLength={60}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              setTitle(session.title);
              setEditing(false);
            }
          }}
        />
      </form>
    );
  }
  return (
    <div
      className="pi-session-row"
      ref={box}
      aria-current={active ? "true" : undefined}
      data-pinned={session.pinned || undefined}
    >
      <button
        type="button"
        className="pi-session-open"
        onClick={onOpen}
        onDoubleClick={() => {
          setTitle(session.title);
          setEditing(true);
        }}
      >
        <span className="pi-session-title">
          {session.pinned && <Pin size={11} aria-label="已置顶" />}
          {session.parentId && <GitBranch size={11} aria-label="分支" />}
          {session.title}
        </span>
        <span className="pi-session-sub">
          {scope && <span className="pi-session-scope">{scope}</span>}
          <span className="pi-session-meta">
            {turns ? (
              <span className="pi-badge">{turns} 轮</span>
            ) : (
              <span className="pi-badge is-draft">草稿</span>
            )}
            {relativeTime(session.updatedAt)}
          </span>
        </span>
      </button>
      <button
        type="button"
        className="pi-icon pi-session-more"
        aria-label={`${session.title} 操作`}
        aria-haspopup="menu"
        aria-expanded={menu}
        onClick={() => setMenu(!menu)}
      >
        <MoreHorizontal size={15} />
      </button>
      {menu && (
        <div className="pi-session-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenu(false);
              onPin();
            }}
          >
            {session.pinned ? <PinOff size={14} /> : <Pin size={14} />}
            {session.pinned ? "取消置顶" : "置顶"}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setMenu(false);
              setTitle(session.title);
              setEditing(true);
            }}
          >
            <Pencil size={14} />
            重命名
          </button>
          <button
            type="button"
            role="menuitem"
            data-tone="danger"
            onClick={() => {
              setMenu(false);
              onDelete();
            }}
          >
            <Trash2 size={14} />
            删除
          </button>
        </div>
      )}
    </div>
  );
}

export function SessionRail({
  sessions,
  activeId,
  busy,
  onSelect,
  onCreate,
  onRename,
  onPin,
  onDelete,
  onClose,
}: {
  sessions: Session[];
  activeId?: string;
  busy: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, title: string) => void;
  onPin: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLocaleLowerCase();
  const visible = needle
    ? sessions.filter((session) => sessionSearchText(session).includes(needle))
    : sessions;
  const pinned = visible.filter((session) => session.pinned);
  const recent = visible.filter((session) => !session.pinned);
  const row = (session: Session) => (
    <SessionRow
      key={session.id}
      session={session}
      active={session.id === activeId}
      onOpen={() => onSelect(session.id)}
      onRename={(title) => onRename(session.id, title)}
      onPin={() => onPin(session.id)}
      onDelete={() => onDelete(session.id)}
    />
  );
  return (
    <aside className="pi-session-rail" aria-label="对话历史">
      <div className="pi-rail-heading">
        <button type="button" className="pi-new-session" onClick={onCreate} disabled={busy}>
          <Plus size={16} />
          新建对话
        </button>
        <button
          type="button"
          className="pi-icon"
          aria-label="收起对话列表"
          title="收起对话列表"
          onClick={onClose}
        >
          <PanelLeftClose size={16} />
        </button>
      </div>
      <label className="pi-session-search">
        <Search size={14} aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索对话…"
          aria-label="搜索对话"
        />
        {query && (
          <button
            type="button"
            className="pi-icon"
            aria-label="清除搜索"
            onClick={() => setQuery("")}
          >
            <X size={13} />
          </button>
        )}
      </label>
      <div className="pi-session-list">
        {pinned.length > 0 && (
          <section aria-label="置顶对话">
            <h2 className="pi-rail-section">置顶</h2>
            {pinned.map(row)}
          </section>
        )}
        <section aria-label="最近对话">
          <h2 className="pi-rail-section">最近</h2>
          {recent.map(row)}
          {!visible.length && <p className="pi-rail-empty">没有匹配的对话</p>}
        </section>
      </div>
    </aside>
  );
}
