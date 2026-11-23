// Agent process timeline and approval cards adapted from Beautiful Pi Web MessageView ToolCallBlock (4a308ed, MIT, see beautiful-pi/LICENSE).
import type { ToolUIPart } from "@optimax-starter/agent/react";
import {
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleSlash,
  LayoutDashboard,
  Navigation,
  ShieldCheck,
  Wrench,
} from "lucide-react";
// @starter:example-assets-start
import { ChartPie, PencilLine, Search } from "lucide-react";
// @starter:example-assets-end
import { type ReactNode, useState } from "react";
import { RichDataTable } from "./beautiful-pi/RichDataTable";
import { RichJsonBlock } from "./beautiful-pi/RichJsonBlock";

/** Write tools render as approval cards; the server re-checks permission and the signed approval. */
export const WRITE_TOOLS = new Set<string>([
  // @starter:example-assets-start
  "update_asset_stage",
  // @starter:example-assets-end
]);

export const TOOLS: Record<string, { label: string; icon: ReactNode }> = {
  get_console_overview: { label: "查看控制台概览", icon: <LayoutDashboard size={14} /> },
  navigate_console: { label: "打开控制台页面", icon: <Navigation size={14} /> },
  // @starter:example-assets-start
  search_assets: { label: "检索资产台账", icon: <Search size={14} /> },
  summarize_assets: { label: "统计资产分布", icon: <ChartPie size={14} /> },
  update_asset_stage: { label: "更新资产阶段", icon: <PencilLine size={14} /> },
  // @starter:example-assets-end
};

/** Human-readable names for common tool input fields. Unknown keys are shown as-is. */
const FIELD_LABELS: Record<string, string> = {
  to: "页面",
  label: "名称",
  q: "关键字",
  id: "编号",
  // @starter:example-assets-start
  domain: "业务域",
  owner: "责任团队",
  stage: "阶段",
  // @starter:example-assets-end
};

export const toolName = (part: ToolUIPart) => part.type.slice(5);
export const toolLabel = (name: string) => TOOLS[name]?.label ?? "执行操作";

/** "编号：3，阶段：待复核" style summary of a flat tool input. */
export function describeInput(input: unknown): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "";
  return Object.entries(input as Record<string, unknown>)
    .filter(([key, value]) => key !== "search" && value !== undefined && value !== "")
    .map(([key, value]) => {
      const text = typeof value === "object" ? JSON.stringify(value) : String(value);
      return `${FIELD_LABELS[key] ?? key}：${text.slice(0, 60)}`;
    })
    .join("，");
}

type Phase = "running" | "done" | "error" | "denied";
function phase(part: ToolUIPart): Phase {
  if (part.state === "output-available") return "done";
  if (part.state === "output-error") return "error";
  if (
    part.state === "output-denied" ||
    (part.state === "approval-responded" && !part.approval.approved)
  ) {
    return "denied";
  }
  return "running";
}
const PHASE_TEXT: Record<Phase, string> = {
  running: "执行中",
  done: "已完成",
  error: "未完成",
  denied: "已取消",
};

function PhaseIcon({ value }: { value: Phase }) {
  if (value === "running") return <span className="pi-step-pulse" aria-hidden="true" />;
  if (value === "done") return <CircleCheck size={14} aria-hidden="true" />;
  if (value === "denied") return <CircleSlash size={14} aria-hidden="true" />;
  return <CircleAlert size={14} aria-hidden="true" />;
}

const cellText = (value: unknown) =>
  value === null || value === undefined
    ? ""
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);

/** Flat object arrays render as a sortable table; everything else as a JSON tree. */
function ToolOutput({ part }: { part: ToolUIPart }) {
  if (part.state === "output-error") {
    return <p className="pi-step-error">{part.errorText || "操作未完成"}</p>;
  }
  if (part.state !== "output-available") return <p className="pi-step-muted">等待结果…</p>;
  const output = part.output as unknown;
  const record =
    output && typeof output === "object" && !Array.isArray(output)
      ? (output as Record<string, unknown>)
      : undefined;
  const items = record?.items;
  const list: unknown[] | null = Array.isArray(output)
    ? output
    : Array.isArray(items)
      ? items
      : null;
  if (list?.length && list.every((row) => row && typeof row === "object" && !Array.isArray(row))) {
    const columns = [...new Set(list.flatMap((row) => Object.keys(row as object)))];
    return (
      <RichDataTable
        title="返回结果"
        columns={columns}
        rows={list.map((row) =>
          columns.map((column) => cellText((row as Record<string, unknown>)[column])),
        )}
      />
    );
  }
  return <RichJsonBlock value={output ?? null} title="返回结果" />;
}

export function ToolStep({ part }: { part: ToolUIPart }) {
  const name = toolName(part);
  const value = phase(part);
  const [open, setOpen] = useState(false);
  const summary = describeInput(part.input);
  return (
    <div className="pi-step" data-phase={value}>
      <button
        type="button"
        className="pi-step-head"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span className="pi-step-icon">{TOOLS[name]?.icon ?? <Wrench size={14} />}</span>
        <span className="pi-step-label">{toolLabel(name)}</span>
        {summary && <span className="pi-step-summary">{summary}</span>}
        <span className="pi-step-state">
          <PhaseIcon value={value} />
          {PHASE_TEXT[value]}
        </span>
        <ChevronDown size={13} className="pi-step-chevron" aria-hidden="true" />
      </button>
      {open && (
        <div className="pi-step-body">
          <ToolOutput part={part} />
        </div>
      )}
    </div>
  );
}

export function ToolGroup({ parts, running }: { parts: ToolUIPart[]; running: boolean }) {
  const [open, setOpen] = useState(false);
  const first = parts[0];
  if (parts.length === 1 && first) {
    return (
      <div className="pi-steps">
        <ToolStep part={first} />
      </div>
    );
  }
  const pending = parts.some((part) => phase(part) === "running");
  const failed = parts.filter((part) => phase(part) === "error").length;
  const expanded = open || (running && pending);
  const status = [pending ? "执行中" : "", failed ? `${failed} 次未完成` : ""]
    .filter(Boolean)
    .join("，");
  return (
    <div className="pi-steps is-group" data-open={expanded}>
      <button
        type="button"
        className="pi-steps-head"
        aria-expanded={expanded}
        onClick={() => setOpen(!expanded)}
      >
        {pending ? (
          <span className="pi-step-pulse" aria-hidden="true" />
        ) : (
          <CircleCheck size={14} aria-hidden="true" />
        )}
        <span>
          调用工具 {parts.length} 次{status ? `（${status}）` : ""}
        </span>
        <small>{expanded ? "收起" : "展开详情"}</small>
        <ChevronDown size={13} className="pi-step-chevron" aria-hidden="true" />
      </button>
      {expanded && (
        <ol className="pi-steps-list">
          {parts.map((part) => (
            <li key={part.toolCallId}>
              <ToolStep part={part} />
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function ApprovalCard({
  part,
  busy,
  respond,
}: {
  part: ToolUIPart;
  busy: boolean;
  respond: (id: string, approved: boolean) => void;
}) {
  const name = toolName(part);
  const summary = describeInput(part.input);
  const state = part.state === "approval-requested" ? "pending" : phase(part);
  return (
    <section className="pi-approval" aria-label="确认操作" data-state={state}>
      <header>
        <span className="pi-approval-icon">
          <ShieldCheck size={16} aria-hidden="true" />
        </span>
        <div>
          <strong>{toolLabel(name)}</strong>
          {summary && <p>{summary}</p>}
        </div>
        {state !== "pending" && (
          <span className="pi-approval-status">
            {state === "running"
              ? "处理中"
              : state === "done"
                ? "已执行"
                : state === "denied"
                  ? "已取消"
                  : "未完成"}
          </span>
        )}
      </header>
      <p className="pi-approval-note">
        写操作将立即更新业务数据并写入操作审计，请核对参数后确认执行。执行前服务端会再次校验你的模块权限。
      </p>
      {part.state === "output-error" && (
        <p className="pi-step-error">{part.errorText || "操作未完成"}</p>
      )}
      {part.state === "output-available" && <ToolOutput part={part} />}
      {part.state === "approval-requested" && (
        <div className="pi-approval-actions">
          <button
            type="button"
            className="pi-button is-primary"
            disabled={busy}
            onClick={() => respond(part.approval.id, true)}
          >
            确认执行
          </button>
          <button
            type="button"
            className="pi-button"
            disabled={busy}
            onClick={() => respond(part.approval.id, false)}
          >
            取消
          </button>
        </div>
      )}
    </section>
  );
}
