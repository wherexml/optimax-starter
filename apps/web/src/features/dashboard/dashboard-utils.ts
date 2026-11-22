import {
  ACTOR_SOURCE_LABELS,
  AUDIT_ACTION_LABELS,
  DEFAULT_SYSTEM_TIMEZONE,
  JOB_STATUS_LABELS,
  JOB_TYPE_LABELS,
  type AuditEntry,
  type Job,
} from "@optimax-starter/api";
import type { BarListItem } from "@optimax-starter/ui/components/bar-list";
import type { CategoryBarSegment } from "@optimax-starter/ui/components/category-bar";
import type { TrackerSlot, TrackerStatus } from "@optimax-starter/ui/components/tracker";
import type { DataTone } from "@optimax-starter/ui/lib/data-tone";

export interface DailyAuditPoint {
  date: string;
  label: string;
  human: number;
  agent: number;
  total: number;
  [key: string]: string | number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getDayFormatter(timeZone: string): Intl.DateTimeFormat {
  const key = timeZone || DEFAULT_SYSTEM_TIMEZONE;
  const cached = formatterCache.get(key);
  if (cached) return cached;
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: key,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: DEFAULT_SYSTEM_TIMEZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }
  formatterCache.set(key, fmt);
  return fmt;
}

function formatDayInZone(date: Date, timeZone: string): string {
  return getDayFormatter(timeZone).format(date);
}

/**
 * 按系统 IANA 时区将审计日志按天聚合为连续 `days` 天的趋势序列。
 * 区分人工/系统事件与 Agent 代理事件，供趋势图与 KPI 迷你曲线共用。
 */
export function buildAuditDailyTrend(
  items: readonly AuditEntry[],
  days: number,
  timeZone = DEFAULT_SYSTEM_TIMEZONE,
  now = new Date(),
): DailyAuditPoint[] {
  const safeDays = Math.max(1, Math.min(Math.floor(days), 90));
  const todayKey = formatDayInZone(now, timeZone);
  const [y, m, d] = todayKey.split("-").map(Number) as [number, number, number];

  const series: DailyAuditPoint[] = [];
  const indexByDate = new Map<string, DailyAuditPoint>();

  for (let offset = safeDays - 1; offset >= 0; offset -= 1) {
    const dt = new Date(Date.UTC(y, m - 1, d - offset));
    const iso = dt.toISOString().slice(0, 10);
    const point: DailyAuditPoint = {
      date: iso,
      label: iso.slice(5),
      human: 0,
      agent: 0,
      total: 0,
    };
    series.push(point);
    indexByDate.set(iso, point);
  }

  for (const item of items) {
    const at = new Date(item.at);
    if (Number.isNaN(at.getTime())) continue;
    const key = formatDayInZone(at, timeZone);
    const bucket = indexByDate.get(key);
    if (!bucket) continue;
    if (item.actorSource === "agent") {
      bucket.agent += 1;
    } else {
      bucket.human += 1;
    }
    bucket.total += 1;
  }

  return series;
}

export interface JobTrackerSummary {
  slots: TrackerSlot[];
  total: number;
  ok: number;
  active: number;
  warning: number;
  danger: number;
}

function mapJobStatus(status: Job["status"]): TrackerStatus {
  if (status === "succeeded") return "ok";
  if (status === "running" || status === "pending") return "active";
  if (status === "failed") return "danger";
  return "warning";
}

/**
 * 将后台任务队列映射为固定格数的健康序列（旧 -> 新从左到右排列）。
 */
export function buildJobTrackerSlots(
  items: readonly Job[],
  slotCount = 24,
): JobTrackerSummary {
  const safeSlots = Math.max(1, Math.floor(slotCount));
  const sorted = [...items].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() || a.id - b.id,
  );

  let ok = 0;
  let active = 0;
  let warning = 0;
  let danger = 0;
  for (const job of sorted) {
    const st = mapJobStatus(job.status);
    if (st === "ok") ok += 1;
    else if (st === "active") active += 1;
    else if (st === "danger") danger += 1;
    else warning += 1;
  }

  const tail = sorted.slice(-safeSlots);
  const padCount = Math.max(0, safeSlots - tail.length);
  const slots: TrackerSlot[] = [];

  for (let i = 0; i < padCount; i += 1) {
    slots.push({ key: `idle-${i}`, status: "idle", label: "暂无历史任务" });
  }
  for (const job of tail) {
    const typeLabel = JOB_TYPE_LABELS[job.type] ?? job.type;
    const statusLabel = JOB_STATUS_LABELS[job.status] ?? job.status;
    slots.push({
      key: `job-${job.id}`,
      status: mapJobStatus(job.status),
      label: `#${job.id} ${typeLabel} ${statusLabel}`,
    });
  }

  return { slots, total: sorted.length, ok, active, warning, danger };
}

const FALLBACK_TONES: readonly DataTone[] = ["brand", "warning", "success", "neutral"];

export function inferSemanticTone(label: string, index: number): DataTone {
  if (/失败|异常|高|拒绝|错误/.test(label)) return "danger";
  if (/待复核|待处理|观察|中|暂停/.test(label)) return "warning";
  if (/已完成|已登记|启用|正常|通过|有效|战略|是/.test(label)) return "success";
  if (/停用|已取消|归档|否/.test(label)) return "neutral";
  return FALLBACK_TONES[index % FALLBACK_TONES.length]!;
}

export interface GeneratedModuleFieldConfig {
  name: string;
  label: string;
  options?: readonly string[];
}

export interface GeneratedModuleBreakdownDimension {
  key: string;
  label: string;
  items: (BarListItem & { filterParam?: Record<string, string> })[];
}

export interface GeneratedModulePreviewRow {
  id: string | number;
  title: string;
  group: string;
  owner: string;
  statusLabel: string;
  statusTone: DataTone;
  search?: Record<string, string>;
}

export interface GeneratedModuleSummary {
  total: number;
  sampled: number;
  segmentsTitle?: string;
  segments: CategoryBarSegment[];
  breakdownTitle: string;
  breakdown: (BarListItem & { filterParam?: Record<string, string> })[];
  dimensions?: GeneratedModuleBreakdownDimension[];
  previewRows?: GeneratedModulePreviewRow[];
  secondaryLabel?: string;
  secondaryValue?: number;
  secondarySearch?: Record<string, string>;
}

/**
 * 将审计日志按动作类型统计频次排行，供工作台治理与审计视图展示。
 */
export function buildAuditActionRanking(
  items: readonly AuditEntry[],
  limit = 6,
): BarListItem[] {
  const counts = new Map<string, number>();
  for (const item of items) {
    counts.set(item.action, (counts.get(item.action) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([action, value]) => {
      const label = AUDIT_ACTION_LABELS[action] ?? action;
      const tone: DataTone = /delete|revoke|reject|fail|circuit/.test(action)
        ? "danger"
        : /update|invite|restore/.test(action)
          ? "warning"
          : "brand";
      return { key: action, label, value, tone };
    })
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "zh-CN"))
    .slice(0, Math.max(1, limit));
}

/**
 * 将审计日志按操作主体（人工/Agent/系统）聚合活跃度排行。
 */
export function buildAuditActorRanking(
  items: readonly AuditEntry[],
  limit = 6,
): (BarListItem & { actorSource: AuditEntry["actorSource"] })[] {
  const grouped = new Map<
    string,
    { label: string; value: number; actorSource: AuditEntry["actorSource"] }
  >();
  for (const item of items) {
    const actorIdentity =
      item.actorUsername ?? item.actorName ?? (item.actorId !== null ? String(item.actorId) : "system");
    const key = `${item.actorSource}:${actorIdentity}`;
    const sourceLabel = ACTOR_SOURCE_LABELS[item.actorSource] ?? item.actorSource;
    const baseName = item.actorName || item.actorUsername || "系统";
    const label = `${baseName}（${sourceLabel}）`;
    const prev = grouped.get(key);
    if (prev) {
      prev.value += 1;
    } else {
      grouped.set(key, { label, value: 1, actorSource: item.actorSource });
    }
  }
  return [...grouped.entries()]
    .map(([key, entry]) => ({
      key,
      label: entry.label,
      value: entry.value,
      actorSource: entry.actorSource,
      tone: (entry.actorSource === "agent" ? "warning" : "brand") as DataTone,
    }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "zh-CN"))
    .slice(0, Math.max(1, limit));
}

/**
 * 为 `bun run gen:module` 生成的任意业务模块自动汇总枚举分段、多维分布与精简明细。
 */
export function summarizeGeneratedRows(
  items: readonly Record<string, unknown>[],
  total: number,
  options: {
    label: string;
    primaryEnumField?: GeneratedModuleFieldConfig | null;
    categoryField?: GeneratedModuleFieldConfig | null;
    ownerField?: GeneratedModuleFieldConfig | null;
    booleanField?: GeneratedModuleFieldConfig | null;
  },
): GeneratedModuleSummary {
  const safeTotal = Math.max(total, items.length);
  const enumField = options.primaryEnumField;
  const segments: CategoryBarSegment[] = [];
  let secondaryLabel: string | undefined;
  let secondaryValue: number | undefined;
  let secondarySearch: Record<string, string> | undefined;

  if (enumField?.options?.length) {
    const counts = new Map<string, number>(enumField.options.map((opt) => [opt, 0]));
    for (const row of items) {
      const val = String(row[enumField.name] ?? "").trim();
      if (val) counts.set(val, (counts.get(val) ?? 0) + 1);
    }
    let idx = 0;
    for (const [opt, count] of counts) {
      segments.push({
        key: opt,
        label: opt,
        value: count,
        tone: inferSemanticTone(opt, idx),
      });
      idx += 1;
    }
    const highlight =
      segments.find((s) => /待|观察|异常|高/.test(s.label)) ??
      segments.find((s) => s.tone === "success") ??
      segments[0];
    if (highlight) {
      secondaryLabel = `${options.label} ${highlight.label}`;
      secondaryValue = highlight.value;
      secondarySearch = { [enumField.name]: highlight.label };
    }
  } else if (options.booleanField) {
    const bf = options.booleanField;
    let yes = 0;
    let no = 0;
    for (const row of items) {
      if (row[bf.name] === true) yes += 1;
      else no += 1;
    }
    segments.push(
      { key: "yes", label: `${bf.label}: 是`, value: yes, tone: "success" },
      { key: "no", label: `${bf.label}: 否`, value: no, tone: "neutral" },
    );
    secondaryLabel = `${bf.label}`;
    secondaryValue = yes;
  }

  const breakdown: (BarListItem & { filterParam?: Record<string, string> })[] = [];
  let breakdownTitle = `${options.label}分布`;

  if (options.categoryField) {
    const cf = options.categoryField;
    breakdownTitle = cf.label;
    const grouped = new Map<string, number>();
    for (const row of items) {
      const key = String(row[cf.name] ?? "").trim() || "未分类";
      grouped.set(key, (grouped.get(key) ?? 0) + 1);
    }
    const sorted = [...grouped.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"))
      .slice(0, 6);
    for (const [key, value] of sorted) {
      breakdown.push({ key, label: key, value, tone: "brand" });
    }
  } else if (enumField?.options?.length) {
    breakdownTitle = enumField.label;
    for (const seg of segments) {
      breakdown.push({
        key: seg.key,
        label: seg.label,
        value: seg.value,
        tone: seg.tone,
        filterParam: { [enumField.name]: seg.label },
      });
    }
  } else if (options.booleanField) {
    breakdownTitle = options.booleanField.label;
    for (const seg of segments) {
      breakdown.push({
        key: seg.key,
        label: seg.label,
        value: seg.value,
        tone: seg.tone,
      });
    }
  }

  const dimensions: GeneratedModuleBreakdownDimension[] = [];

  if (options.categoryField) {
    dimensions.push({
      key: options.categoryField.name,
      label: `按${options.categoryField.label}`,
      items: breakdown,
    });
  }

  if (options.ownerField) {
    const of = options.ownerField;
    const grouped = new Map<string, number>();
    for (const row of items) {
      const key = String(row[of.name] ?? "").trim() || "未指派";
      grouped.set(key, (grouped.get(key) ?? 0) + 1);
    }
    const ownerItems = [...grouped.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh-CN"))
      .slice(0, 6)
      .map(([key, value]) => ({ key, label: key, value, tone: "brand" as DataTone }));
    dimensions.push({
      key: of.name,
      label: `按${of.label}`,
      items: ownerItems,
    });
  }

  if (enumField?.options?.length && !dimensions.some((d) => d.key === enumField.name)) {
    dimensions.push({
      key: enumField.name,
      label: `按${enumField.label}`,
      items: segments.map((seg) => ({
        key: seg.key,
        label: seg.label,
        value: seg.value,
        tone: seg.tone,
        filterParam: { [enumField.name]: seg.label },
      })),
    });
  }

  const prioritizedRows = [...items].sort((a, b) => {
    const av = enumField ? String(a[enumField.name] ?? "") : "";
    const bv = enumField ? String(b[enumField.name] ?? "") : "";
    const aFocus = /待|观察|异常|高/.test(av) ? 0 : 1;
    const bFocus = /待|观察|异常|高/.test(bv) ? 0 : 1;
    return aFocus - bFocus;
  });

  const previewRows: GeneratedModulePreviewRow[] = prioritizedRows.slice(0, 5).map((row, idx) => {
    const rawId = row.id;
    const id =
      typeof rawId === "number" || typeof rawId === "string" ? rawId : `row-${idx}`;
    const rawTitle = String(row.name ?? row.title ?? row.label ?? `#${id}`).trim();
    const group = options.categoryField
      ? String(row[options.categoryField.name] ?? "").trim() || "未分类"
      : options.label;
    const owner = options.ownerField
      ? String(row[options.ownerField.name] ?? "").trim() || "未指派"
      : "—";
    let statusLabel = "正常";
    let statusTone: DataTone = "brand";
    if (enumField) {
      const ev = String(row[enumField.name] ?? "").trim();
      if (ev) {
        statusLabel = ev;
        statusTone = inferSemanticTone(ev, 0);
      }
    } else if (options.booleanField) {
      const enabled = row[options.booleanField.name] === true;
      statusLabel = enabled ? "是" : "否";
      statusTone = enabled ? "success" : "neutral";
    }
    return {
      id,
      title: rawTitle,
      group,
      owner,
      statusLabel,
      statusTone,
      search: rawTitle ? { q: rawTitle } : undefined,
    };
  });

  return {
    total: safeTotal,
    sampled: items.length,
    segmentsTitle: enumField?.label ?? options.booleanField?.label,
    segments,
    breakdownTitle,
    breakdown,
    dimensions: dimensions.length ? dimensions : [{ key: "default", label: breakdownTitle, items: breakdown }],
    previewRows,
    secondaryLabel,
    secondaryValue,
    secondarySearch,
  };
}
