import { SYSTEM_TABS, type SystemTab } from "@optimax-starter/api";

export const SYSTEM_TAB_ITEMS: readonly { value: SystemTab; label: string }[] = [
  { value: "status", label: "运行状态" },
  { value: "settings", label: "基础配置" },
  { value: "jobs", label: "后台任务" },
];

export function parseSystemSearch(raw: Record<string, unknown>): {
  tab: SystemTab;
} {
  const candidate = typeof raw.tab === "string" ? raw.tab : "";
  const tab: SystemTab = (SYSTEM_TABS as readonly string[]).includes(candidate)
    ? (candidate as SystemTab)
    : "status";
  return { tab };
}
