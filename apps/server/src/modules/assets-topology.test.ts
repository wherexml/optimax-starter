import type { Asset } from "@optimax-starter/api";
import { describe, expect, it } from "vitest";
import {
  assetNodeId,
  buildAssetTopology,
  domainAnchorId,
  getCachedAssetTopology,
  ownerTeamId,
  resetAssetTopologyCache,
} from "./assets-topology";

const SAMPLE_ASSETS: Asset[] = [
  { id: 1, name: "采购门户", domain: "采购", owner: "业务运营组", stage: "已登记" },
  { id: 2, name: "采购合同中台", domain: "采购", owner: "业务运营组", stage: "已登记" },
  { id: 3, name: "订单中心", domain: "运营", owner: "平台组", stage: "已登记" },
  { id: 4, name: "应收结算中台", domain: "财务", owner: "财务共享组", stage: "已登记" },
  { id: 5, name: "税务发票监控台", domain: "财务", owner: "财务共享组", stage: "待复核" },
  { id: 6, name: "实时数仓中台", domain: "数据", owner: "数据平台组", stage: "已登记" },
  { id: 7, name: "统一身份网关", domain: "安全", owner: "安全合规组", stage: "已登记" },
  { id: 8, name: "自定义新业务域门户", domain: "法务", owner: "合规团队", stage: "待复核" },
  { id: 1000, name: "税务发票中台", domain: "财务", owner: "财务共享组", stage: "已登记" },
];

function buildLargeSample(count = 1000): Asset[] {
  const domains = ["采购", "履约", "运营", "财务", "研发", "安全", "数据", "人力"] as const;
  const owners = [
    "业务运营组",
    "交付组",
    "平台组",
    "财务共享组",
    "研发效能组",
    "安全合规组",
    "数据平台组",
    "人力数字化组",
  ] as const;
  const prefixes = [
    ["寻源比价", "采购合同", "供应商准入"],
    ["干线调度", "冷链温控", "签收回单"],
    ["客户工单", "会员权益", "渠道门户"],
    ["应收结算", "银企直连", "税务发票"],
    ["制品仓库", "持续集成", "配置中心"],
    ["统一身份", "零信任网关", "堡垒审计"],
    ["实时数仓", "指标血缘", "自助分析"],
    ["组织主数据", "薪酬核算", "绩效评估"],
  ] as const;
  const suffixes = ["门户", "服务", "中心", "平台", "工作台", "监控台", "对账台", "中台"] as const;

  const out: Asset[] = [];
  for (let i = 1; i <= count; i++) {
    const dIdx = i === count ? 3 : i % domains.length;
    const pList = prefixes[dIdx]!;
    const prefix = i === count ? "税务发票" : pList[Math.floor(i / domains.length) % pList.length]!;
    const suffix =
      i === count ? "中台" : suffixes[Math.floor(i / (domains.length * 3)) % suffixes.length]!;
    out.push({
      id: i,
      name: `${prefix}${suffix}-${i}`,
      domain: domains[dIdx]!,
      owner: owners[dIdx]!,
      stage: i % 11 === 0 ? "待复核" : "已登记",
    });
  }
  // Normalize AS-1000 exact name
  out[count - 1] = {
    id: 1000,
    name: "税务发票中台",
    domain: "财务",
    owner: "财务共享组",
    stage: "已登记",
  };
  return out;
}

describe("assets-topology builder", () => {
  it("builds finite coordinates, anchors, owner teams and semantic links without isolated assets", () => {
    const topo = buildAssetTopology(SAMPLE_ASSETS);
    expect(topo.stats.assetCount).toBe(SAMPLE_ASSETS.length);
    expect(topo.stats.domainCount).toBe(6);
    expect(topo.stats.teamCount).toBe(6);
    expect(topo.nodes.length).toBe(SAMPLE_ASSETS.length + 6 + 6);

    for (const node of topo.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
      expect(node.x).toBeGreaterThanOrEqual(40);
      expect(node.y).toBeGreaterThanOrEqual(40);
      expect(node.label.includes("\u00b7")).toBe(false);
    }

    const taxNode = topo.nodes.find((n) => n.id === assetNodeId(1000));
    expect(taxNode).toBeDefined();
    expect(taxNode!.upstreamCount).toBeGreaterThanOrEqual(3);
    expect(taxNode!.downstreamCount).toBeGreaterThanOrEqual(2);

    const taxInbound = topo.edges.filter((e) => e.targetId === assetNodeId(1000));
    const taxOutbound = topo.edges.filter((e) => e.sourceId === assetNodeId(1000));
    expect(taxInbound.some((e) => e.linkType === "DATA_FLOW")).toBe(true);
    expect(
      taxOutbound.some(
        (e) => e.linkType === "GOVERNED_BY" && e.targetId === ownerTeamId("财务共享组"),
      ),
    ).toBe(true);
    expect(topo.nodes.some((n) => n.id === domainAnchorId("法务"))).toBe(true);

    // Connected graph check (excluding ANCHORS_DOMAIN layout rays or including full edges)
    const adj = new Map<string, string[]>();
    for (const n of topo.nodes) adj.set(n.id, []);
    for (const e of topo.edges) {
      adj.get(e.sourceId)?.push(e.targetId);
      adj.get(e.targetId)?.push(e.sourceId);
    }
    const visited = new Set<string>();
    const queue = [topo.nodes[0]!.id];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      for (const nxt of adj.get(cur) ?? []) {
        if (!visited.has(nxt)) queue.push(nxt);
      }
    }
    expect(visited.size).toBe(topo.nodes.length);
  });

  it("handles 1,000 assets quickly and invalidates in-memory cache when rows change", () => {
    resetAssetTopologyCache();
    const rows = buildLargeSample(1000);
    const t0 = performance.now();
    const first = getCachedAssetTopology(rows);
    const elapsedMs = performance.now() - t0;

    expect(first.stats.assetCount).toBe(1000);
    expect(first.stats.nodeCount).toBe(1016);
    expect(first.edges.length).toBeGreaterThan(1500);
    expect(elapsedMs).toBeLessThan(150);

    // Same content in different order hits identical cached object reference
    const second = getCachedAssetTopology([...rows].reverse());
    expect(second).toBe(first);

    // Any change rebuilds cleanly
    const modified = rows.map((r) => (r.id === 1000 ? { ...r, stage: "待复核" as const } : r));
    const third = getCachedAssetTopology(modified);
    expect(third).not.toBe(first);
    expect(third.nodes.find((n) => n.id === assetNodeId(1000))?.stage).toBe("待复核");
  });
});
