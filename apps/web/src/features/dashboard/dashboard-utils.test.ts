import { describe, expect, it } from "vitest";
import type { AuditEntry, Job } from "@optimax-starter/api";
import {
  buildAuditActionRanking,
  buildAuditActorRanking,
  buildAuditDailyTrend,
  buildJobTrackerSlots,
  summarizeGeneratedRows,
} from "./dashboard-utils";

function makeAudit(overrides: Partial<AuditEntry> & Pick<AuditEntry, "id" | "at">): AuditEntry {
  return {
    action: "asset.create",
    actorSource: "human",
    actorId: 1,
    actorUsername: "admin",
    actorName: "管理员",
    targetId: null,
    targetUsername: null,
    targetName: null,
    detail: {},
    ...overrides,
  };
}

function makeJob(overrides: Partial<Job> & Pick<Job, "id" | "status">): Job {
  return {
    type: "assets.export_csv",
    payload: {},
    result: null,
    error: null,
    progress: 100,
    attempts: 1,
    maxAttempts: 3,
    runAfter: "2026-11-22T00:00:00.000Z",
    lockedAt: null,
    startedAt: null,
    finishedAt: null,
    createdBy: 1,
    createdAt: `2026-11-22T00:00:${String(overrides.id).padStart(2, "0")}.000Z`,
    updatedAt: `2026-11-22T00:00:${String(overrides.id).padStart(2, "0")}.000Z`,
    ...overrides,
  };
}

describe("dashboard-utils", () => {
  it("按目标时区聚合连续天数的人工与 Agent 操作趋势", () => {
    // 2026-11-22T04:00:00Z = 北京时间 11-22 12:00；2026-11-21T16:30:00Z = 北京时间 11-22 00:30
    const now = new Date("2026-11-22T04:00:00.000Z");
    const items = [
      makeAudit({ id: 1, at: "2026-11-21T16:30:00.000Z", actorSource: "agent" }),
      makeAudit({ id: 2, at: "2026-11-21T15:30:00.000Z", actorSource: "human" }),
      makeAudit({ id: 3, at: "2026-11-22T01:00:00.000Z", actorSource: "human" }),
      makeAudit({ id: 4, at: "not-a-date", actorSource: "human" }),
    ];

    const shanghai = buildAuditDailyTrend(items, 7, "Asia/Shanghai", now);
    expect(shanghai).toHaveLength(7);
    expect(shanghai[5]).toMatchObject({ date: "2026-11-21", human: 1, agent: 0, total: 1 });
    expect(shanghai[6]).toMatchObject({
      date: "2026-11-22",
      label: "11-22",
      human: 1,
      agent: 1,
      total: 2,
    });

    const utc = buildAuditDailyTrend(items, 7, "UTC", now);
    expect(utc[5]).toMatchObject({ date: "2026-11-21", human: 1, agent: 1, total: 2 });
    expect(utc[6]).toMatchObject({ date: "2026-11-22", human: 1, agent: 0, total: 1 });
  });

  it("将后台任务映射为前置 idle 填充、最新靠右的健康格序列", () => {
    const jobs = [
      makeJob({ id: 1, status: "failed", createdAt: "2026-11-22T01:00:00.000Z" }),
      makeJob({ id: 2, status: "succeeded", createdAt: "2026-11-22T02:00:00.000Z" }),
      makeJob({ id: 3, status: "running", createdAt: "2026-11-22T03:00:00.000Z" }),
    ];

    const tracker = buildJobTrackerSlots(jobs, 6);
    expect(tracker.slots).toHaveLength(6);
    expect(tracker.slots.slice(0, 3).every((s) => s.status === "idle")).toBe(true);
    expect(tracker.slots[3]?.status).toBe("danger");
    expect(tracker.slots[4]?.status).toBe("ok");
    expect(tracker.slots[5]?.status).toBe("active");
    expect(tracker.slots.every((s) => !s.label?.includes("·"))).toBe(true);
    expect(tracker).toMatchObject({ total: 3, ok: 1, active: 1, warning: 0, danger: 1 });
  });

  it("为自动生成的模块聚合枚举分段与分类分布", () => {
    const rows = [
      { id: 1, name: "华东精密", level: "战略", category: "制造业" },
      { id: 2, name: "远航物流", level: "观察", category: "物流" },
      { id: 3, name: "恒信材料", level: "观察", category: "制造业" },
    ];
    const summary = summarizeGeneratedRows(rows, 12, {
      label: "供应商台账",
      primaryEnumField: { name: "level", label: "等级", options: ["战略", "普通", "观察"] },
      categoryField: { name: "category", label: "行业" },
    });

    expect(summary.total).toBe(12);
    expect(summary.sampled).toBe(3);
    expect(summary.segments.map((s) => [s.label, s.value, s.tone])).toEqual([
      ["战略", 1, "success"],
      ["普通", 0, "warning"],
      ["观察", 2, "warning"],
    ]);
    expect(summary.breakdown[0]).toMatchObject({ label: "制造业", value: 2 });
    expect(summary.secondaryValue).toBe(2);
    expect(summary.secondarySearch).toEqual({ level: "观察" });
    expect(summary.dimensions?.map((d) => d.key)).toContain("level");
    expect(summary.previewRows?.[0]).toMatchObject({
      title: "远航物流",
      statusLabel: "观察",
      statusTone: "warning",
    });
  });

  it("支持责任人维度聚合、动作频次排行与操作主体排行", () => {
    const rows = [
      { id: 1, name: "华东精密", level: "战略", owner: "供应链一组" },
      { id: 2, name: "恒信材料", level: "观察", owner: "供应链一组" },
    ];
    const summary = summarizeGeneratedRows(rows, 2, {
      label: "供应商台账",
      primaryEnumField: { name: "level", label: "等级", options: ["战略", "观察"] },
      ownerField: { name: "owner", label: "负责人" },
    });
    expect(summary.dimensions?.map((d) => d.label)).toEqual(["按负责人", "按等级"]);
    expect(summary.dimensions?.[0]?.items[0]).toMatchObject({ label: "供应链一组", value: 2 });

    const audits = [
      makeAudit({ id: 1, at: "2026-11-22T01:00:00.000Z", action: "asset.create", actorSource: "human", actorName: "张敏", actorUsername: "zhangmin" }),
      makeAudit({ id: 2, at: "2026-11-22T02:00:00.000Z", action: "asset.create", actorSource: "agent", actorName: "资产助手", actorUsername: "asset_bot" }),
      makeAudit({ id: 3, at: "2026-11-22T03:00:00.000Z", action: "asset.delete", actorSource: "agent", actorName: "资产助手", actorUsername: "asset_bot" }),
    ];
    const actionRank = buildAuditActionRanking(audits, 5);
    expect(actionRank[0]).toMatchObject({ key: "asset.create", value: 2 });
    expect(actionRank[1]).toMatchObject({ key: "asset.delete", value: 1, tone: "danger" });

    const actorRank = buildAuditActorRanking(audits, 5);
    expect(actorRank[0]).toMatchObject({ label: "资产助手（Agent）", value: 2, tone: "warning" });
  });
});
