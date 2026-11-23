// Collapsible key-value JSON viewer adapted from Beautiful Pi Web RichJsonBlock (4a308ed, MIT, see LICENSE).
import { Check, Copy } from "lucide-react";
import { useMemo, useState } from "react";
import { copyText } from "./clipboard";

function deepParse(value: unknown): unknown {
  if (typeof value === "string" && /^[[{]/.test(value.trim())) {
    try {
      return deepParse(JSON.parse(value));
    } catch {
      return value;
    }
  }
  if (Array.isArray(value)) return value.map(deepParse);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, deepParse(child)]));
  }
  return value;
}

function JsonValue({ value, name, depth }: { value: unknown; name?: string; depth: number }) {
  const key = name !== undefined ? <span className="rich-json-key">{name}</span> : null;
  if (value && typeof value === "object") {
    const entries = Array.isArray(value)
      ? value.map((child, index) => [String(index), child] as const)
      : Object.entries(value);
    const [open, close] = Array.isArray(value) ? ["[", "]"] : ["{", "}"];
    return (
      <details className="rich-json-node" open={depth < 2}>
        <summary>
          {key}
          {key && <span className="rich-json-colon">: </span>}
          <span className="rich-json-bracket">{open}</span>
          <span className="rich-json-count">{entries.length}</span>
        </summary>
        <div>
          {entries.map(([entryName, child]) => (
            <JsonValue key={entryName} name={entryName} value={child} depth={depth + 1} />
          ))}
        </div>
        <span className="rich-json-bracket">{close}</span>
      </details>
    );
  }
  const tone = value === null ? "null" : typeof value;
  const rendered = typeof value === "string" ? `"${value}"` : String(value);
  return (
    <div className="rich-json-leaf">
      {key}
      {key && <span className="rich-json-colon">: </span>}
      <span data-json-type={tone}>{rendered}</span>
    </div>
  );
}

export function RichJsonBlock({
  value,
  source,
  title = "JSON",
}: {
  value?: unknown;
  source?: string;
  title?: string;
}) {
  const parsed = useMemo(() => {
    if (value !== undefined) return deepParse(value);
    try {
      return deepParse(JSON.parse(source ?? ""));
    } catch {
      return undefined;
    }
  }, [source, value]);
  const [copied, setCopied] = useState(false);
  if (parsed === undefined) return null;
  return (
    <section className="rich-json" aria-label={title}>
      <header>
        <strong>{title}</strong>
        <button
          type="button"
          aria-label={`复制 ${title}`}
          onClick={() => {
            void copyText(source ?? JSON.stringify(parsed, null, 2)).then((ok) => {
              if (!ok) return;
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1200);
            });
          }}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? "已复制" : "复制"}
        </button>
      </header>
      <div className="rich-json-tree">
        <JsonValue value={parsed} depth={0} />
      </div>
    </section>
  );
}
