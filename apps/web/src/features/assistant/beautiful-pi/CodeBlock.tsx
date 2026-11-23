// Code block with language label and copy, adapted from Beautiful Pi Web MarkdownBody (4a308ed, MIT, see LICENSE).
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { copyText } from "./clipboard";
import { RichDataTable } from "./RichDataTable";
import { RichJsonBlock } from "./RichJsonBlock";
import { parseRichTableSpec } from "./rich-output";

export function CodeBlock({ language, text }: { language: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const body = text.replace(/\n$/, "");
  const table = ["datatable", "spreadsheet"].includes(language) ? parseRichTableSpec(body) : null;
  if (table) {
    return (
      <RichDataTable
        title={table.title}
        columns={table.columns.map((column) => column.label)}
        rows={table.rows.map((row) => row.map((cell) => (cell == null ? "" : String(cell))))}
      />
    );
  }
  if (language === "json" && body.length < 60000) {
    try {
      JSON.parse(body);
      return <RichJsonBlock source={body} />;
    } catch {
      /* Invalid JSON stays a code block. */
    }
  }
  return (
    <div className="pi-code">
      <div className="pi-code-header">
        <span>{language || "text"}</span>
        <button
          type="button"
          aria-label="复制代码"
          onClick={() => {
            void copyText(body).then((ok) => {
              if (!ok) return;
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1400);
            });
          }}
        >
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      <pre>
        <code className={language ? `language-${language}` : undefined}>{body}</code>
      </pre>
    </div>
  );
}
