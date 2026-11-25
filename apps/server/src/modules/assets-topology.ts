import {
  ASSET_STAGES,
  type Asset,
  type AssetGraphDomainDto,
  type AssetGraphEdge,
  type AssetGraphLinkType,
  type AssetGraphNode,
  type AssetStage,
  type AssetTopologyResponse,
} from "@optimax-starter/api";

const WORLD_WIDTH = 2400;
const WORLD_HEIGHT = 1600;
const GOLDEN_ANGLE = 2.399963229728653;

interface SectorSpec {
  domain: string;
  description: string;
  color: string;
  x: number;
  y: number;
  rx: number;
  ry: number;
}

/** Allowed chart/graph palette (Radix blue/cyan/amber/slate/red; strictly no green or purple). */
const FALLBACK_COLORS = ["#0284c7", "#3e63dd", "#d97706", "#0ea5e9", "#5b7cfa", "#f59e0b"] as const;

const KNOWN_SECTORS: readonly SectorSpec[] = [
  {
    domain: "采购",
    description: "寻源比价、供应商准入与采购合同协同域",
    color: "#0284c7",
    x: 410,
    y: 410,
    rx: 255,
    ry: 185,
  },
  {
    domain: "运营",
    description: "客户工单、渠道门户与会员权益运营域",
    color: "#5b7cfa",
    x: 930,
    y: 355,
    rx: 255,
    ry: 180,
  },
  {
    domain: "履约",
    description: "干线调度、关务冷链与交付签收协同域",
    color: "#f59e0b",
    x: 1470,
    y: 355,
    rx: 255,
    ry: 180,
  },
  {
    domain: "财务",
    description: "业财结算、银企直连与税务发票中台域",
    color: "#3e63dd",
    x: 1990,
    y: 500,
    rx: 265,
    ry: 195,
  },
  {
    domain: "研发",
    description: "持续集成、配置中心与服务网格研发底座域",
    color: "#0891b2",
    x: 410,
    y: 1185,
    rx: 255,
    ry: 185,
  },
  {
    domain: "安全",
    description: "统一身份、零信任网关与全链路审计安全域",
    color: "#e5484d",
    x: 930,
    y: 1245,
    rx: 255,
    ry: 180,
  },
  {
    domain: "人力",
    description: "组织主数据、薪酬核算与绩效评估支撑域",
    color: "#475569",
    x: 1470,
    y: 1245,
    rx: 255,
    ry: 180,
  },
  {
    domain: "数据",
    description: "实时数仓、指标血缘与全库数据分析中台域",
    color: "#0ea5e9",
    x: 1990,
    y: 1100,
    rx: 265,
    ry: 195,
  },
];

const CORE_SUFFIXES = ["中台", "中心", "平台", "网关", "服务", "总线", "引擎"] as const;
const KNOWN_PREFIXES = [
  "寻源比价",
  "招投标协同",
  "供应商准入",
  "采购合同",
  "目录商城",
  "干线调度",
  "冷链温控",
  "备件调拨",
  "关务申报",
  "签收回单",
  "客户工单",
  "会员权益",
  "内容投放",
  "渠道门户",
  "活动编排",
  "应收结算",
  "应付核销",
  "银企直连",
  "税务发票",
  "预算费控",
  "制品仓库",
  "持续集成",
  "容器编排",
  "配置中心",
  "服务网格",
  "统一身份",
  "零信任网关",
  "堡垒审计",
  "密钥托管",
  "漏洞巡检",
  "实时数仓",
  "离线调度",
  "指标血缘",
  "特征存储",
  "自助分析",
  "组织主数据",
  "招聘协同",
  "薪酬核算",
  "绩效评估",
  "考勤排班",
] as const;

const KNOWN_SECTOR_MAP = new Map(KNOWN_SECTORS.map((s) => [s.domain, s]));

/** Cross-domain directed value-chain and data flows: `[sourceDomain, targetDomain, label]`. */
const DOMAIN_DATA_FLOWS: ReadonlyArray<readonly [string, string, string]> = [
  ["采购", "履约", "采购寻源驱动履约供给"],
  ["运营", "履约", "前端订单触发履约交付"],
  ["采购", "财务", "采购合同触发应付开票"],
  ["运营", "财务", "订单收入驱动税务开票"],
  ["履约", "财务", "签收结算驱动开票核销"],
  ["人力", "财务", "薪酬核算入账预算费控"],
  ["采购", "数据", "采购明细汇入实时数仓"],
  ["运营", "数据", "运营指标接入分析中台"],
  ["履约", "数据", "履约轨迹同步指标血缘"],
  ["财务", "数据", "业财票据同步指标数仓"],
  ["研发", "数据", "研发效能度量同步数仓"],
  ["安全", "数据", "安全日志接入分析归档"],
  ["人力", "数据", "组织人力同步数仓分析"],
];

const formatCode = (id: number) => `AS-${String(id).padStart(3, "0")}`;

export function domainAnchorId(domain: string): string {
  return `DOM:${domain}`;
}

export function ownerTeamId(owner: string): string {
  return `TEAM:${owner}`;
}

export function assetNodeId(assetId: number): string {
  return `AS-${assetId}`;
}

function isCoreSystem(name: string): boolean {
  return CORE_SUFFIXES.some((s) => name.endsWith(s));
}

function extractPrefix(name: string): string {
  for (const p of KNOWN_PREFIXES) {
    if (name.startsWith(p)) return p;
  }
  return name.slice(0, Math.min(4, name.length));
}

function suffixPriority(name: string): number {
  const idx = CORE_SUFFIXES.findIndex((s) => name.endsWith(s));
  return idx === -1 ? CORE_SUFFIXES.length + 1 : idx;
}

function resolveSector(domain: string, fallbackIdx: number): SectorSpec {
  const known = KNOWN_SECTOR_MAP.get(domain);
  if (known) return known;
  const col = fallbackIdx % 3;
  const row = Math.floor(fallbackIdx / 3) % 2;
  return {
    domain,
    description: `${domain} 业务域系统与协同资产集群`,
    color: FALLBACK_COLORS[fallbackIdx % FALLBACK_COLORS.length]!,
    x: 680 + col * 520,
    y: 785 + row * 240,
    rx: 220,
    ry: 150,
  };
}

function seededOffset(seed: number): number {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** Deterministic, single-connected super-graph layout over the live `console_asset` table. */
export function buildAssetTopology(rawRows: readonly Asset[]): AssetTopologyResponse {
  const rows = [...rawRows].sort((a, b) => a.id - b.id);
  const domainNames: string[] = [];
  const seenDomains = new Set<string>();
  for (const s of KNOWN_SECTORS) {
    if (rows.some((r) => r.domain === s.domain)) {
      domainNames.push(s.domain);
      seenDomains.add(s.domain);
    }
  }
  const extraDomains: string[] = [];
  for (const r of rows) {
    if (!seenDomains.has(r.domain)) {
      seenDomains.add(r.domain);
      extraDomains.push(r.domain);
    }
  }
  extraDomains.sort((a, b) => a.localeCompare(b, "zh-CN"));
  domainNames.push(...extraDomains);

  const sectorMap = new Map<string, SectorSpec>();
  let fallbackIdx = 0;
  for (const dom of domainNames) {
    const spec = resolveSector(dom, KNOWN_SECTOR_MAP.has(dom) ? 0 : fallbackIdx++);
    sectorMap.set(dom, spec);
  }

  const assetsByDomain = new Map<string, Asset[]>();
  const assetsByOwner = new Map<string, Asset[]>();
  for (const dom of domainNames) assetsByDomain.set(dom, []);
  for (const row of rows) {
    assetsByDomain.get(row.domain)?.push(row);
    const list = assetsByOwner.get(row.owner);
    if (list) list.push(row);
    else assetsByOwner.set(row.owner, [row]);
  }

  const nodes: AssetGraphNode[] = [];
  const nodeMap = new Map<string, AssetGraphNode>();
  const addNode = (node: AssetGraphNode) => {
    nodes.push(node);
    nodeMap.set(node.id, node);
  };

  // 1. Domain Anchor hubs
  for (const dom of domainNames) {
    const sec = sectorMap.get(dom)!;
    const domRows = assetsByDomain.get(dom) ?? [];
    addNode({
      id: domainAnchorId(dom),
      code: dom,
      label: `${dom} 业务域`,
      objectType: "DomainAnchor",
      domain: dom,
      x: sec.x,
      y: Math.max(64, sec.y - sec.ry - 24),
      upstreamCount: 0,
      downstreamCount: 0,
      assetCount: domRows.length,
    });
  }

  // 2. Owner Team hubs positioned in their primary governed domain
  const ownerNames = [...assetsByOwner.keys()].sort((a, b) => a.localeCompare(b, "zh-CN"));
  ownerNames.forEach((owner, oIdx) => {
    const owned = assetsByOwner.get(owner) ?? [];
    const domainCounts = new Map<string, number>();
    for (const a of owned) domainCounts.set(a.domain, (domainCounts.get(a.domain) ?? 0) + 1);
    const primaryDomain =
      [...domainCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ??
      domainNames[0] ??
      "平台";
    const sec = sectorMap.get(primaryDomain) ?? KNOWN_SECTORS[0]!;
    addNode({
      id: ownerTeamId(owner),
      code: owner,
      label: `${owner}（团队枢纽）`,
      objectType: "OwnerTeam",
      domain: primaryDomain,
      owner,
      x: Number((sec.x + Math.cos(oIdx * 1.3) * 18).toFixed(2)),
      y: Number((sec.y + Math.sin(oIdx * 1.3) * 14).toFixed(2)),
      upstreamCount: 0,
      downstreamCount: 0,
      assetCount: owned.length,
    });
  });

  // 3. Asset nodes with layered golden-angle spiral placement inside each domain sector
  for (const dom of domainNames) {
    const sec = sectorMap.get(dom)!;
    const domRows = [...(assetsByDomain.get(dom) ?? [])].sort((a, b) => {
      const pa = suffixPriority(a.name);
      const pb = suffixPriority(b.name);
      if (pa !== pb) return pa - pb;
      return b.id - a.id;
    });
    const total = Math.max(1, domRows.length);
    domRows.forEach((row, idx) => {
      const frac = (idx + 0.5) / total;
      const core = isCoreSystem(row.name);
      const radialScale = core ? 0.22 + Math.sqrt(frac) * 0.42 : 0.48 + Math.sqrt(frac) * 0.52;
      const theta = idx * GOLDEN_ANGLE + (seededOffset(row.id) - 0.5) * 0.25;
      const x = sec.x + Math.cos(theta) * sec.rx * radialScale;
      const y = sec.y + Math.sin(theta) * sec.ry * radialScale;
      addNode({
        id: assetNodeId(row.id),
        assetId: row.id,
        code: formatCode(row.id),
        label: row.name,
        objectType: "Asset",
        domain: row.domain,
        owner: row.owner,
        stage: (ASSET_STAGES as readonly string[]).includes(row.stage)
          ? (row.stage as AssetStage)
          : undefined,
        x: Number(x.toFixed(2)),
        y: Number(y.toFixed(2)),
        upstreamCount: 0,
        downstreamCount: 0,
      });
    });
  }

  // 4. Directed edges (deduplicated per directed pair for semantic links)
  const edges: AssetGraphEdge[] = [];
  const seenDirectedPairs = new Set<string>();
  let edgeSeq = 1;
  const addEdge = (
    sourceId: string,
    targetId: string,
    linkType: AssetGraphLinkType,
    label: string,
  ) => {
    if (sourceId === targetId) return;
    if (!nodeMap.has(sourceId) || !nodeMap.has(targetId)) return;
    if (linkType !== "ANCHORS_DOMAIN") {
      const key = `${sourceId}->${targetId}`;
      if (seenDirectedPairs.has(key)) return;
      seenDirectedPairs.add(key);
    }
    edges.push({
      id: `E-${edgeSeq++}`,
      sourceId,
      targetId,
      linkType,
      label,
    });
  };

  // Core hubs per domain & per business prefix for structured topology wiring
  const domainCoreHubs = new Map<string, Asset[]>();
  const prefixCoreHubs = new Map<string, Asset[]>();

  for (const dom of domainNames) {
    const domRows = assetsByDomain.get(dom) ?? [];
    const anchor = domainAnchorId(dom);
    const ranked = [...domRows].sort(
      (a, b) => suffixPriority(a.name) - suffixPriority(b.name) || b.id - a.id,
    );
    const hubs = ranked.filter((r) => isCoreSystem(r.name)).slice(0, 8);
    const effectiveHubs = hubs.length ? hubs : ranked.slice(0, Math.min(4, ranked.length));
    domainCoreHubs.set(dom, effectiveHubs);

    // ANCHORS_DOMAIN layout rays from domain capsule to landmark hubs & teams
    for (const hub of effectiveHubs.slice(0, 4)) {
      addEdge(anchor, assetNodeId(hub.id), "ANCHORS_DOMAIN", "域内核心锚点");
    }
    const domOwners = new Set(domRows.map((r) => r.owner));
    for (const owner of domOwners) {
      addEdge(anchor, ownerTeamId(owner), "ANCHORS_DOMAIN", "域内协同团队");
    }

    // Group by prefix within domain to link peripheral portals/monitors to their prefix core hubs
    const byPrefix = new Map<string, Asset[]>();
    for (const r of domRows) {
      const key = `${dom}:${extractPrefix(r.name)}`;
      const list = byPrefix.get(key);
      if (list) list.push(r);
      else byPrefix.set(key, [r]);
    }

    for (const [prefKey, group] of byPrefix) {
      const sortedGroup = [...group].sort(
        (a, b) => suffixPriority(a.name) - suffixPriority(b.name) || b.id - a.id,
      );
      const prefHubs = sortedGroup.slice(0, Math.min(2, sortedGroup.length));
      prefixCoreHubs.set(prefKey, prefHubs);
      const primary = sortedGroup[0];
      if (!primary) continue;
      for (let i = 1; i < sortedGroup.length; i++) {
        const member = sortedGroup[i]!;
        const target = sortedGroup[i % Math.min(2, sortedGroup.length)] ?? primary;
        if (member.id !== target.id) {
          addEdge(
            assetNodeId(member.id),
            assetNodeId(target.id),
            "COLLABORATES_WITH",
            "同域模块协同",
          );
        }
      }
    }

    // Connect prefix primary hubs sequentially along the domain backbone
    const primaries = [...byPrefix.values()]
      .map(
        (grp) =>
          [...grp].sort(
            (a, b) => suffixPriority(a.name) - suffixPriority(b.name) || b.id - a.id,
          )[0],
      )
      .filter((r): r is Asset => Boolean(r));
    for (let i = 0; i < primaries.length - 1; i++) {
      addEdge(
        assetNodeId(primaries[i]!.id),
        assetNodeId(primaries[i + 1]!.id),
        "COLLABORATES_WITH",
        `${dom} 域主链路协同`,
      );
    }
    if (primaries.length > 2) {
      addEdge(
        assetNodeId(primaries[0]!.id),
        assetNodeId(primaries[primaries.length - 1]!.id),
        "COLLABORATES_WITH",
        `${dom} 域端到端联动`,
      );
    }
  }

  // GOVERNANCE edges: each asset connected to its owner team hub
  for (const row of rows) {
    addEdge(assetNodeId(row.id), ownerTeamId(row.owner), "GOVERNED_BY", "责任团队纳管");
  }

  // Cross-domain business DATA_FLOW edges along the value chain
  for (const [srcDom, dstDom, flowLabel] of DOMAIN_DATA_FLOWS) {
    const srcHubs = domainCoreHubs.get(srcDom);
    const dstHubs = domainCoreHubs.get(dstDom);
    if (!srcHubs?.length || !dstHubs?.length) continue;
    const fanCount = Math.min(5, Math.max(srcHubs.length, dstHubs.length));
    for (let i = 0; i < fanCount; i++) {
      const s = srcHubs[i % srcHubs.length]!;
      const t = dstHubs[i % dstHubs.length]!;
      addEdge(assetNodeId(s.id), assetNodeId(t.id), "DATA_FLOW", flowLabel);
    }
  }

  // Targeted realistic enterprise flows for newest financial/tax/data systems & dynamic domains
  const secHubs = domainCoreHubs.get("安全") ?? [];
  const devHubs = domainCoreHubs.get("研发") ?? [];
  for (const dom of domainNames) {
    const hubs = domainCoreHubs.get(dom);
    if (!hubs?.length) continue;
    if (dom !== "安全" && secHubs.length) {
      for (let i = 0; i < Math.min(3, hubs.length); i++) {
        const s = secHubs[i % secHubs.length]!;
        const t = hubs[i]!;
        addEdge(
          assetNodeId(s.id),
          assetNodeId(t.id),
          "INFRA_DEPENDENCY",
          "零信任身份与合规网关支撑",
        );
      }
    }
    if (dom !== "研发" && devHubs.length) {
      for (let i = 0; i < Math.min(2, hubs.length); i++) {
        const s = devHubs[i % devHubs.length]!;
        const t = hubs[i]!;
        addEdge(assetNodeId(s.id), assetNodeId(t.id), "INFRA_DEPENDENCY", "配置中心与服务网格支撑");
      }
    }
    if (!KNOWN_SECTOR_MAP.has(dom) && domainNames.includes("数据")) {
      const dataHubs = domainCoreHubs.get("数据") ?? [];
      if (dataHubs.length) {
        addEdge(
          assetNodeId(hubs[0]!.id),
          assetNodeId(dataHubs[0]!.id),
          "DATA_FLOW",
          `${dom} 业务指标同步数仓`,
        );
      }
    }
  }

  // Guarantee prefix-level highest core systems (e.g. AS-1000 税务发票中台) have rich upstream/downstream cross-domain peers
  const finTaxHubs = prefixCoreHubs.get("财务:税务发票");
  const finSettlementHubs = prefixCoreHubs.get("财务:应收结算");
  const finBankHubs = prefixCoreHubs.get("财务:银企直连");
  const finBudgetHubs = prefixCoreHubs.get("财务:预算费控");
  const dataWarehouseHubs = prefixCoreHubs.get("数据:实时数仓");
  const dataLineageHubs = prefixCoreHubs.get("数据:指标血缘");
  const opsOrderHubs = domainCoreHubs.get("运营");
  const procContractHubs = prefixCoreHubs.get("采购:采购合同");
  const fulSignHubs = prefixCoreHubs.get("履约:签收回单");

  if (finTaxHubs?.length) {
    const primaryTax = finTaxHubs[0]!;
    if (finSettlementHubs?.[0]) {
      addEdge(
        assetNodeId(finSettlementHubs[0].id),
        assetNodeId(primaryTax.id),
        "COLLABORATES_WITH",
        "应收结算单触发税控开票",
      );
    }
    if (opsOrderHubs?.[0]) {
      addEdge(
        assetNodeId(opsOrderHubs[0].id),
        assetNodeId(primaryTax.id),
        "DATA_FLOW",
        "订单交易流水推送信控开票",
      );
    }
    if (procContractHubs?.[0]) {
      addEdge(
        assetNodeId(procContractHubs[0].id),
        assetNodeId(primaryTax.id),
        "DATA_FLOW",
        "进项采购合同核验发票合规",
      );
    }
    if (fulSignHubs?.[0]) {
      addEdge(
        assetNodeId(fulSignHubs[0].id),
        assetNodeId(primaryTax.id),
        "DATA_FLOW",
        "履约签收节点确认开票时点",
      );
    }
    if (finBankHubs?.[0]) {
      addEdge(
        assetNodeId(primaryTax.id),
        assetNodeId(finBankHubs[0].id),
        "COLLABORATES_WITH",
        "发票凭证联动银企付款对账",
      );
    }
    if (finBudgetHubs?.[0]) {
      addEdge(
        assetNodeId(primaryTax.id),
        assetNodeId(finBudgetHubs[0].id),
        "COLLABORATES_WITH",
        "税额抵扣回写预算费控台账",
      );
    }
    if (dataWarehouseHubs?.[0]) {
      addEdge(
        assetNodeId(primaryTax.id),
        assetNodeId(dataWarehouseHubs[0].id),
        "DATA_FLOW",
        "税务票据明细实时入仓",
      );
    }
    if (dataLineageHubs?.[0]) {
      addEdge(
        assetNodeId(primaryTax.id),
        assetNodeId(dataLineageHubs[0].id),
        "DATA_FLOW",
        "税务口径同步经营指标血缘",
      );
    }
  }

  // 5. Sector-constrained spring relaxation (ported from optimax-graph-console)
  const degMap = new Map<string, number>();
  for (const n of nodes) degMap.set(n.id, 0);
  for (const e of edges) {
    if (e.linkType === "ANCHORS_DOMAIN") continue;
    degMap.set(e.sourceId, (degMap.get(e.sourceId) ?? 0) + 1);
    degMap.set(e.targetId, (degMap.get(e.targetId) ?? 0) + 1);
  }

  const disp = new Map<string, { dx: number; dy: number }>();
  for (const n of nodes) disp.set(n.id, { dx: 0, dy: 0 });

  const HUB_DEGREE = 18;
  const springAttenuation = (node: AssetGraphNode, sameDomain: boolean) => {
    const deg = Math.max(1, degMap.get(node.id) ?? 1);
    let k = 1 / Math.sqrt(deg);
    if (!sameDomain) {
      if (node.objectType === "OwnerTeam") k /= Math.sqrt(deg);
      else if (deg > HUB_DEGREE) k /= Math.sqrt(deg / HUB_DEGREE);
    }
    return k;
  };

  const TETHER = 0.28;
  const REPULSE_R2 = 1600; // 40px
  const REPULSE_PUSH = 7;
  const RELAX_ITERATIONS = 14;
  const CELL_SIZE = 44;

  for (let iter = 0; iter < RELAX_ITERATIONS; iter++) {
    for (const d of disp.values()) {
      d.dx = 0;
      d.dy = 0;
    }
    for (const e of edges) {
      if (e.linkType === "ANCHORS_DOMAIN") continue;
      const u = nodeMap.get(e.sourceId);
      const v = nodeMap.get(e.targetId);
      if (!u || !v) continue;
      const dx = v.x - u.x;
      const dy = v.y - u.y;
      const sameDomain = u.domain === v.domain;
      const factor = sameDomain ? 0.032 : 0.008;
      if (u.objectType !== "DomainAnchor") {
        const k = factor * springAttenuation(u, sameDomain);
        const du = disp.get(u.id)!;
        du.dx += dx * k;
        du.dy += dy * k;
      }
      if (v.objectType !== "DomainAnchor") {
        const k = factor * springAttenuation(v, sameDomain);
        const dv = disp.get(v.id)!;
        dv.dx -= dx * k;
        dv.dy -= dy * k;
      }
    }

    const grid = new Map<string, AssetGraphNode[]>();
    for (const n of nodes) {
      if (n.objectType === "DomainAnchor") continue;
      const key = `${Math.floor(n.x / CELL_SIZE)},${Math.floor(n.y / CELL_SIZE)}`;
      const bucket = grid.get(key);
      if (bucket) bucket.push(n);
      else grid.set(key, [n]);
    }

    for (const n of nodes) {
      if (n.objectType === "DomainAnchor") continue;
      const nd = disp.get(n.id)!;
      const gx = Math.floor(n.x / CELL_SIZE);
      const gy = Math.floor(n.y / CELL_SIZE);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          const bucket = grid.get(`${gx + ox},${gy + oy}`);
          if (!bucket) continue;
          for (const other of bucket) {
            if (other.id === n.id) continue;
            const dx = n.x - other.x;
            const dy = n.y - other.y;
            const d2 = dx * dx + dy * dy;
            if (d2 > 0.1 && d2 < REPULSE_R2) {
              const dist = Math.sqrt(d2);
              const push = ((REPULSE_R2 - d2) / REPULSE_R2) * REPULSE_PUSH;
              nd.dx += (dx / dist) * push;
              nd.dy += (dy / dist) * push;
            }
          }
        }
      }
      const sec = sectorMap.get(n.domain);
      if (sec) {
        nd.dx += (sec.x - n.x) * TETHER;
        nd.dy += (sec.y - n.y) * TETHER;
      }
    }

    const cooling = iter < 8 ? 1 : 1 - (iter - 7) * 0.11;
    for (const n of nodes) {
      if (n.objectType === "DomainAnchor") continue;
      const d = disp.get(n.id)!;
      const stepX = Math.max(-20, Math.min(20, d.dx * 0.45 * cooling));
      const stepY = Math.max(-20, Math.min(20, d.dy * 0.45 * cooling));
      n.x = Number(Math.max(80, Math.min(WORLD_WIDTH - 80, n.x + stepX)).toFixed(2));
      n.y = Number(Math.max(90, Math.min(WORLD_HEIGHT - 80, n.y + stepY)).toFixed(2));
    }
  }

  // Recompute directed semantic upstream/downstream counts per node
  for (const e of edges) {
    if (e.linkType === "ANCHORS_DOMAIN") continue;
    const s = nodeMap.get(e.sourceId);
    const t = nodeMap.get(e.targetId);
    if (s) s.downstreamCount += 1;
    if (t) t.upstreamCount += 1;
  }

  // Re-anchor each domain capsule directly above its member bounding box
  const domains: AssetGraphDomainDto[] = domainNames.map((dom) => {
    const sec = sectorMap.get(dom)!;
    const domRows = assetsByDomain.get(dom) ?? [];
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    for (const n of nodes) {
      if (n.domain !== dom || n.objectType === "DomainAnchor") continue;
      if (n.x < minX) minX = n.x;
      if (n.x > maxX) maxX = n.x;
      if (n.y < minY) minY = n.y;
    }
    const anchorX = Number((Number.isFinite(minX) ? (minX + maxX) / 2 : sec.x).toFixed(2));
    const anchorY = Number(
      (Number.isFinite(minY) ? Math.max(46, minY - 48) : sec.y - 48).toFixed(2),
    );
    const anchorNode = nodeMap.get(domainAnchorId(dom));
    if (anchorNode) {
      anchorNode.x = anchorX;
      anchorNode.y = anchorY;
    }
    const registeredCount = domRows.filter((r) => r.stage === "已登记").length;
    return {
      key: dom,
      label: dom,
      description: sec.description,
      color: sec.color,
      nodeCount: domRows.length,
      registeredCount,
      pendingCount: domRows.length - registeredCount,
      anchorX,
      anchorY,
    };
  });

  return {
    world: { width: WORLD_WIDTH, height: WORLD_HEIGHT },
    domains,
    nodes,
    edges,
    stats: {
      nodeCount: nodes.length,
      edgeCount: edges.length,
      assetCount: rows.length,
      domainCount: domains.length,
      teamCount: ownerNames.length,
    },
  };
}

let cachedFingerprint = "";
let cachedTopology: AssetTopologyResponse | null = null;

function computeRowsFingerprint(rows: readonly Asset[]): string {
  let h1 = 2166136261;
  let h2 = 2166136261;
  for (const r of rows) {
    const line = `${r.id}|${r.name}|${r.domain}|${r.owner}|${r.stage}`;
    for (let i = 0; i < line.length; i++) {
      const ch = line.charCodeAt(i);
      h1 ^= ch;
      h1 = Math.imul(h1, 16777619) >>> 0;
      h2 = (Math.imul(h2, 31) + ch) >>> 0;
    }
  }
  return `${rows.length}:${h1.toString(36)}:${h2.toString(36)}`;
}

/** Returns cached super-graph topology and rebuilds automatically when the asset rows change. */
export function getCachedAssetTopology(rows: readonly Asset[]): AssetTopologyResponse {
  const ordered = [...rows].sort((a, b) => a.id - b.id);
  const fp = computeRowsFingerprint(ordered);
  if (cachedTopology && cachedFingerprint === fp) return cachedTopology;
  const built = buildAssetTopology(ordered);
  cachedFingerprint = fp;
  cachedTopology = built;
  return built;
}

export function resetAssetTopologyCache() {
  cachedFingerprint = "";
  cachedTopology = null;
}
