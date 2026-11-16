import {
  Boxes,
  FlaskConical,
  LayoutDashboard,
  ScrollText,
  Settings,
  SlidersHorizontal,
  Users,
  type LucideIcon,
} from "lucide-react";

const metaEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

const slug = metaEnv.VITE_APP_SLUG?.trim() || "optimax-starter";
const title = metaEnv.VITE_APP_TITLE?.trim() || "OptiMax";
const enableDemos = metaEnv.VITE_ENABLE_DEMOS !== "false";

export const APP_CONFIG = {
  slug,
  title,
  logoSrc: "/brand/optimax-starter.svg",
  storagePrefix: slug,
  enableDemos,
} as const;

export function storageKey(suffix: string): string {
  return `${APP_CONFIG.storagePrefix}.${suffix}`;
}

export type NavTarget =
  | "/"
  | "/assets"
  | "/accounts"
  | "/audit"
  | "/settings"
  | "/demo/navigation"
  | "/demo/forms";

export interface NavLeafItem {
  kind: "item";
  to: NavTarget;
  label: string;
  icon: LucideIcon;
  collapsedIcon?: LucideIcon;
  collapsedLabel?: string;
  aliases: string[];
  adminOnly?: boolean;
  demoOnly?: boolean;
  exact?: boolean;
  sidebar?: boolean;
  defaultSearch?: Record<string, string>;
}

export interface NavGroupItem {
  kind: "group";
  label: string;
  adminOnly?: boolean;
  demoOnly?: boolean;
  // Enforces AGENTS.md max 2-level sidebar rule: groups can only contain leaf items, never nested groups.
  children: readonly NavLeafItem[];
}

export type NavNode = NavLeafItem | NavGroupItem;

// Single navigation registry shared by Sidebar, Mobile Drawer and Cmd/Ctrl+K QuickNav.
export const NAV_REGISTRY: readonly NavNode[] = [
  {
    kind: "item",
    to: "/",
    label: "工作台",
    icon: LayoutDashboard,
    aliases: ["dashboard", "home", "overview", "总览", "首页"],
    exact: true,
  },
  {
    kind: "item",
    to: "/assets",
    label: "资产台账",
    icon: Boxes,
    aliases: ["assets", "ledger", "inventory", "资产"],
  },
  {
    kind: "item",
    to: "/accounts",
    label: "账户管理",
    icon: Users,
    aliases: ["accounts", "users", "members", "账户", "用户"],
    adminOnly: true,
  },
  {
    kind: "item",
    to: "/audit",
    label: "操作日志",
    icon: ScrollText,
    aliases: ["audit", "logs", "activity", "日志", "审计"],
    adminOnly: true,
  },
  {
    kind: "item",
    to: "/settings",
    label: "个人设置",
    icon: Settings,
    aliases: ["settings", "profile", "account", "password", "security", "设置", "资料", "密码"],
    sidebar: false,
  },
  {
    kind: "group",
    label: "Demo",
    demoOnly: true,
    children: [
      {
        kind: "item",
        to: "/demo/navigation",
        label: "资产视图",
        icon: Boxes,
        collapsedIcon: FlaskConical,
        collapsedLabel: "Demo · 资产视图",
        aliases: ["demo", "navigation", "tabs", "导航", "演示", "资产视图 Demo"],
        demoOnly: true,
        defaultSearch: { tab: "all" },
      },
      {
        kind: "item",
        to: "/demo/forms",
        label: "表单弹窗",
        icon: SlidersHorizontal,
        collapsedIcon: SlidersHorizontal,
        collapsedLabel: "Demo 表单弹窗",
        aliases: ["forms", "modal", "dialog", "input", "表单", "弹窗", "输入框"],
        demoOnly: true,
      },
    ],
  },
];

export function getSidebarNodes(isAdmin: boolean): NavNode[] {
  const out: NavNode[] = [];
  for (const node of NAV_REGISTRY) {
    if (node.adminOnly && !isAdmin) continue;
    if (node.demoOnly && !APP_CONFIG.enableDemos) continue;
    if (node.kind === "item") {
      if (node.sidebar === false) continue;
      out.push(node);
    } else {
      const children = node.children.filter(
        (child) =>
          (!child.adminOnly || isAdmin) &&
          (!child.demoOnly || APP_CONFIG.enableDemos) &&
          child.sidebar !== false,
      );
      if (children.length) out.push({ ...node, children });
    }
  }
  return out;
}

export interface QuickNavEntry {
  to: NavTarget;
  label: string;
  aliases: string[];
  admin: boolean;
  icon: LucideIcon;
}

export function getQuickNavEntries(isAdmin: boolean): QuickNavEntry[] {
  const entries: QuickNavEntry[] = [];
  for (const node of NAV_REGISTRY) {
    if (node.demoOnly && !APP_CONFIG.enableDemos) continue;
    if (node.kind === "item") {
      if (node.adminOnly && !isAdmin) continue;
      entries.push({
        to: node.to,
        label: node.label,
        aliases: node.aliases,
        admin: Boolean(node.adminOnly),
        icon: node.collapsedIcon ?? node.icon,
      });
    } else {
      for (const child of node.children) {
        if (child.adminOnly && !isAdmin) continue;
        if (child.demoOnly && !APP_CONFIG.enableDemos) continue;
        entries.push({
          to: child.to,
          label: child.demoOnly ? `${child.label} Demo` : child.label,
          aliases: child.aliases,
          admin: Boolean(child.adminOnly || node.adminOnly),
          icon: child.collapsedIcon ?? child.icon,
        });
      }
    }
  }
  return entries;
}
