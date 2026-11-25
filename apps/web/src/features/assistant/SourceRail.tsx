import { LocateFixed, X } from "lucide-react";
import { useEffect, useRef } from "react";
import type { AgentCitation } from "./api";
import { useOpenCitation } from "./CitationLink";

export function SourceRail({
  citations,
  focus,
  onClose,
}: {
  citations: AgentCitation[];
  focus?: string;
  onClose: () => void;
}) {
  const open = useOpenCitation();
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => {
    if (!focus) return;
    list.current
      ?.querySelector<HTMLElement>(`[data-citation-id="${CSS.escape(focus)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [focus]);

  return (
    <aside className="pi-source-rail" aria-label="引用来源">
      <header className="pi-rail-heading">
        <strong>引用来源</strong>
        <span className="pi-count">{citations.length}</span>
        <button
          type="button"
          className="pi-icon"
          aria-label="收起引用来源"
          title="收起引用来源"
          onClick={onClose}
        >
          <X size={15} />
        </button>
      </header>
      {citations.length ? (
        <ol className="pi-source-list" ref={list}>
          {citations.map((source) => (
            <li
              key={source.id}
              data-citation-id={source.id}
              data-focus={source.id === focus || undefined}
            >
              <div className="pi-source-head">
                <button
                  type="button"
                  className="pi-citation"
                  disabled={!source.to.startsWith("/")}
                  aria-label={`定位 ${source.id}：${source.title}`}
                  onClick={() => {
                    if (open(source)) onClose();
                  }}
                >
                  {source.id}
                </button>
                {source.to.startsWith("/") ? (
                  <button
                    type="button"
                    className="pi-source-title-btn"
                    onClick={() => {
                      if (open(source)) onClose();
                    }}
                  >
                    <strong className="pi-source-title">{source.title}</strong>
                  </button>
                ) : (
                  <strong className="pi-source-title">{source.title}</strong>
                )}
              </div>
              {source.snippet && <p>{source.snippet}</p>}
              <button
                type="button"
                className="pi-source-open"
                onClick={() => {
                  if (open(source)) onClose();
                }}
                disabled={!source.to.startsWith("/")}
              >
                <LocateFixed size={13} aria-hidden="true" />
                定位查看
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <p className="pi-rail-empty">当前对话暂无引用来源</p>
      )}
    </aside>
  );
}
