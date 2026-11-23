import { useNavigate } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import type { ReactNode } from "react";
import { type AgentCitation, isInternalPath } from "./api";

/** Opens the cited record in the main pane; the assistant drawer stays open. */
export function useOpenCitation() {
  const navigate = useNavigate();
  return (source: AgentCitation) => {
    if (!isInternalPath(source.to)) return false;
    void navigate({ to: source.to as never, search: (source.search ?? {}) as never });
    return true;
  };
}

export function CitationLink({
  source,
  compact = false,
  children,
  className,
}: {
  source: AgentCitation;
  compact?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  const open = useOpenCitation();
  const label = source.snippet ? `${source.title}（${source.snippet}）` : source.title;
  const valid = isInternalPath(source.to);
  return (
    <button
      type="button"
      className={className ?? (compact ? "pi-citation" : "pi-file-link")}
      aria-label={`引用 ${source.id}：${label}`}
      title={label}
      disabled={!valid}
      onClick={() => open(source)}
    >
      {children ??
        (compact ? (
          source.id
        ) : (
          <>
            <FileText size={15} aria-hidden="true" />
            <span>{source.title}</span>
            {source.snippet && <small>{source.snippet}</small>}
          </>
        ))}
    </button>
  );
}
