import { z } from "zod";

export const ACTOR_SOURCES = ["human", "agent", "system"] as const;
export type ActorSource = (typeof ACTOR_SOURCES)[number];

export const ACTOR_SOURCE_LABELS: Record<ActorSource, string> = {
  human: "人工",
  agent: "Agent",
  system: "系统",
};

export const SYSTEM_TABS = ["status", "settings", "jobs"] as const;
export type SystemTab = (typeof SYSTEM_TABS)[number];

export const DEFAULT_SYSTEM_TIMEZONE = "Asia/Shanghai";

export const SYSTEM_TIMEZONE_OPTIONS = [
  { value: "Asia/Shanghai", label: "北京时间 UTC+08:00" },
  { value: "Asia/Hong_Kong", label: "香港时间 UTC+08:00" },
  { value: "Asia/Singapore", label: "新加坡时间 UTC+08:00" },
  { value: "Asia/Tokyo", label: "东京时间 UTC+09:00" },
  { value: "UTC", label: "协调世界时 UTC+00:00" },
  { value: "Europe/London", label: "伦敦时间" },
  { value: "America/New_York", label: "纽约时间" },
  { value: "America/Los_Angeles", label: "洛杉矶时间" },
] as const;

export interface SystemTimezoneOption {
  value: string;
  label: string;
  keywords: string[];
}

const TIMEZONE_ALIAS_MAP: Record<string, { zh: string; keywords: string[] }> = {
  "Asia/Shanghai": { zh: "北京时间", keywords: ["北京", "上海", "中国", "cst", "beijing", "shanghai", "china"] },
  "Asia/Hong_Kong": { zh: "香港时间", keywords: ["香港", "hongkong", "hk"] },
  "Asia/Taipei": { zh: "台北时间", keywords: ["台北", "台湾", "taipei", "taiwan"] },
  "Asia/Macau": { zh: "澳门时间", keywords: ["澳门", "macau"] },
  "Asia/Urumqi": { zh: "乌鲁木齐时间", keywords: ["乌鲁木齐", "新疆", "urumqi"] },
  "Asia/Tokyo": { zh: "东京时间", keywords: ["东京", "日本", "tokyo", "japan", "jst"] },
  "Asia/Seoul": { zh: "首尔时间", keywords: ["首尔", "韩国", "seoul", "korea", "kst"] },
  "Asia/Singapore": { zh: "新加坡时间", keywords: ["新加坡", "singapore", "sg"] },
  "Asia/Bangkok": { zh: "曼谷时间", keywords: ["曼谷", "泰国", "bangkok", "thailand"] },
  "Asia/Jakarta": { zh: "雅加达时间", keywords: ["雅加达", "印尼", "印度尼西亚", "jakarta", "indonesia"] },
  "Asia/Kuala_Lumpur": { zh: "吉隆坡时间", keywords: ["吉隆坡", "马来西亚", "kuala lumpur", "malaysia"] },
  "Asia/Manila": { zh: "马尼拉时间", keywords: ["马尼拉", "菲律宾", "manila", "philippines"] },
  "Asia/Ho_Chi_Minh": { zh: "胡志明市时间", keywords: ["胡志明", "越南", "vietnam"] },
  "Asia/Kolkata": { zh: "新德里时间", keywords: ["印度", "德里", "孟买", "india", "ist"] },
  "Asia/Dubai": { zh: "迪拜时间", keywords: ["迪拜", "阿联酋", "dubai", "uae"] },
  "Asia/Riyadh": { zh: "利雅得时间", keywords: ["沙特", "利雅得", "riyadh", "saudi"] },
  "Asia/Jerusalem": { zh: "耶路撒冷时间", keywords: ["以色列", "耶路撒冷", "israel"] },
  UTC: { zh: "协调世界时", keywords: ["utc", "gmt", "世界标准时间", "格林威治", "zero"] },
  "Europe/London": { zh: "伦敦时间", keywords: ["伦敦", "英国", "london", "uk", "gmt", "bst"] },
  "Europe/Paris": { zh: "巴黎时间", keywords: ["巴黎", "法国", "paris", "france", "cet"] },
  "Europe/Berlin": { zh: "柏林时间", keywords: ["柏林", "德国", "berlin", "germany", "cet"] },
  "Europe/Zurich": { zh: "苏黎世时间", keywords: ["瑞士", "苏黎世", "zurich", "switzerland"] },
  "Europe/Amsterdam": { zh: "阿姆斯特丹时间", keywords: ["荷兰", "阿姆斯特丹", "amsterdam", "netherlands"] },
  "Europe/Madrid": { zh: "马德里时间", keywords: ["西班牙", "马德里", "madrid", "spain"] },
  "Europe/Rome": { zh: "罗马时间", keywords: ["意大利", "罗马", "rome", "italy"] },
  "Europe/Moscow": { zh: "莫斯科时间", keywords: ["俄罗斯", "莫斯科", "moscow", "russia"] },
  "America/New_York": { zh: "纽约时间", keywords: ["纽约", "美东", "美国东部", "new york", "est", "edt", "us"] },
  "America/Chicago": { zh: "芝加哥时间", keywords: ["芝加哥", "美中", "美国中部", "chicago", "cst", "cdt"] },
  "America/Denver": { zh: "丹佛时间", keywords: ["丹佛", "美国山地", "denver", "mst", "mdt"] },
  "America/Los_Angeles": { zh: "洛杉矶时间", keywords: ["洛杉矶", "旧金山", "硅谷", "美西", "美国西部", "los angeles", "san francisco", "pst", "pdt"] },
  "America/Toronto": { zh: "多伦多时间", keywords: ["多伦多", "加拿大", "toronto", "canada"] },
  "America/Vancouver": { zh: "温哥华时间", keywords: ["温哥华", "加拿大", "vancouver", "canada"] },
  "America/Sao_Paulo": { zh: "圣保罗时间", keywords: ["圣保罗", "巴西", "brazil", "sao paulo"] },
  "America/Mexico_City": { zh: "墨西哥城时间", keywords: ["墨西哥", "mexico"] },
  "Australia/Sydney": { zh: "悉尼时间", keywords: ["悉尼", "澳大利亚", "澳洲", "sydney", "australia"] },
  "Australia/Melbourne": { zh: "墨尔本时间", keywords: ["墨尔本", "澳大利亚", "澳洲", "melbourne", "australia"] },
  "Pacific/Auckland": { zh: "奥克兰时间", keywords: ["奥克兰", "新西兰", "auckland", "new zealand"] },
  "Africa/Johannesburg": { zh: "约翰内斯堡时间", keywords: ["南非", "约翰内斯堡", "johannesburg", "south africa"] },
  "Africa/Cairo": { zh: "开罗时间", keywords: ["埃及", "开罗", "cairo", "egypt"] },
};

const CONTINENT_ZH: Record<string, string> = {
  Asia: "亚洲",
  America: "美洲",
  Europe: "欧洲",
  Pacific: "太平洋",
  Africa: "非洲",
  Australia: "澳洲",
  Indian: "印度洋",
  Atlantic: "大西洋",
  Arctic: "北极",
  Antarctica: "南极",
  Etc: "标准时区",
};

export function formatSystemTimezoneOffset(
  timeZone: string,
  now = new Date(),
): { offsetLabel: string; offsetMinutes: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "longOffset",
    }).formatToParts(now);
    const raw = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
    if (raw === "GMT" || raw === "UTC") {
      return { offsetLabel: "UTC+00:00", offsetMinutes: 0 };
    }
    const normalized = raw.replace(/^GMT/, "UTC");
    const match = /^UTC([+-])(\d{1,2}):(\d{2})$/.exec(normalized);
    if (!match) {
      return { offsetLabel: normalized, offsetMinutes: 0 };
    }
    const sign = match[1] === "-" ? -1 : 1;
    const hours = match[2]!.padStart(2, "0");
    const mins = match[3]!;
    return {
      offsetLabel: `UTC${match[1]}${hours}:${mins}`,
      offsetMinutes: sign * (Number(hours) * 60 + Number(mins)),
    };
  } catch {
    return { offsetLabel: "UTC+00:00", offsetMinutes: 0 };
  }
}

export function formatSystemTimezoneOptionLabel(timeZone: string, now = new Date()): string {
  const { offsetLabel } = formatSystemTimezoneOffset(timeZone, now);
  const alias = TIMEZONE_ALIAS_MAP[timeZone];
  return alias ? `(${offsetLabel}) ${timeZone} - ${alias.zh}` : `(${offsetLabel}) ${timeZone}`;
}

let cachedTimezoneOptions: readonly SystemTimezoneOption[] | null = null;

export function getSystemTimezoneOptions(): readonly SystemTimezoneOption[] {
  if (cachedTimezoneOptions) return cachedTimezoneOptions;
  const now = new Date();
  const presetOrder = new Map<string, number>(
    SYSTEM_TIMEZONE_OPTIONS.map((opt, idx) => [opt.value, idx]),
  );
  const supported =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  const uniqueZones = new Set<string>([
    ...SYSTEM_TIMEZONE_OPTIONS.map((opt) => opt.value),
    "UTC",
    ...supported,
  ]);
  const entries = [...uniqueZones].map((zone) => {
    const { offsetLabel, offsetMinutes } = formatSystemTimezoneOffset(zone, now);
    const alias = TIMEZONE_ALIAS_MAP[zone];
    const continent = zone.split("/")[0] ?? "";
    const continentZh = CONTINENT_ZH[continent];
    const label = alias ? `(${offsetLabel}) ${zone} - ${alias.zh}` : `(${offsetLabel}) ${zone}`;
    const keywords = [
      offsetLabel,
      offsetLabel.replace(":", ""),
      zone.replaceAll("/", " ").replaceAll("_", " "),
      ...(continentZh ? [continentZh] : []),
      ...(alias ? [alias.zh, ...alias.keywords] : []),
    ];
    return {
      value: zone,
      label,
      keywords,
      offsetMinutes,
      presetRank: presetOrder.get(zone) ?? Number.MAX_SAFE_INTEGER,
    };
  });
  entries.sort(
    (a, b) =>
      a.presetRank - b.presetRank ||
      a.offsetMinutes - b.offsetMinutes ||
      a.value.localeCompare(b.value),
  );
  cachedTimezoneOptions = entries.map(({ value, label, keywords }) => ({
    value,
    label,
    keywords,
  }));
  return cachedTimezoneOptions;
}

export interface SystemStatusResponse {
  checkedAt: string;
  overall: "ok" | "degraded";
  probe: {
    db: "ok" | "unreachable";
    dbLatencyMs: number | null;
    activeSessions: number;
    uptimeSec: number;
    nodeVersion: string;
  };
  ai: {
    configMode: "disabled" | "invalid" | "client" | "legacy";
    configReason?: string;
    circuitOpen: boolean;
    effectiveEnabled: boolean;
    model: string | null;
    timeoutMs: number | null;
    limits: {
      concurrency: number;
      queueLimit: number;
      queueWaitMs: number;
      actorLimit: number;
    } | null;
    queue: {
      active: number;
      waiting: number;
      activeActors: number;
    } | null;
    updatedAt: string | null;
  };
}

export interface SystemSettingsResponse {
  timezone: string;
  timezoneLabel: string;
  source: "database" | "env" | "default";
  updatedAt: string | null;
  timezoneOptions: readonly { value: string; label: string }[];
}

export const systemSettingsUpdateSchema = z
  .object({
    timezone: z.string().trim().min(1, "请选择系统时区").max(64),
  })
  .strict();

export type SystemSettingsUpdateInput = z.infer<typeof systemSettingsUpdateSchema>;

export const aiCircuitUpdateSchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict();

export type AiCircuitUpdateInput = z.infer<typeof aiCircuitUpdateSchema>;
