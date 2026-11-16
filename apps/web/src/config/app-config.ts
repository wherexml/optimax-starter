import {
  Activity,
  Boxes,
  FlaskConical,
  LayoutDashboard,
  ScrollText,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  type LucideIcon,
} from "lucide-react";
import { defaultPermissionCodes, type Account } from "@optimax-starter/api";

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
  | "/permissions"
  | "/system"
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
  permissionCode?: string;
  permissionCodes?: readonly string[];
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
    permissionCode: "workbench:read",
    exact: true,
  },
  {
    kind: "item",
    to: "/assets",
    label: "资产台账",
    icon: Boxes,
    aliases: ["assets", "ledger", "inventory", "资产"],
    permissionCode: "assets:read",
  },
  {
    kind: "group",
    label: "系统管理",
    children: [
      {
        kind: "item",
        to: "/accounts",
        label: "账户管理",
        icon: Users,
        collapsedLabel: "系统管理 账户管理",
        aliases: ["accounts", "users", "members", "账户", "用户", "人员"],
        permissionCode: "accounts:read",
        adminOnly: true,
      },
      {
        kind: "item",
        to: "/permissions",
        label: "系统权限",
        icon: ShieldCheck,
        collapsedLabel: "系统管理 系统权限",
        aliases: ["permissions", "rbac", "roles", "matrix", "权限", "角色矩阵"],
        permissionCode: "system:permission:read",
        adminOnly: true,
      },
      {
        kind: "item",
        to: "/system",
        label: "系统配置",
        icon: Activity,
        collapsedLabel: "系统管理 系统配置",
        aliases: [
          "system",
          "status",
          "health",
          "ai",
          "circuit",
          "timezone",
          "系统",
          "探针",
          "熔断",
          "时区",
          "开关",
        ],
        permissionCodes: ["system:settings:read", "system:ai:read"],
        adminOnly: true,
        defaultSearch: { tab: "status" },
      },
      {
        kind: "item",
        to: "/audit",
        label: "操作日志",
        icon: ScrollText,
        collapsedLabel: "系统管理 操作日志",
        aliases: ["audit", "logs", "activity", "日志", "审计"],
        permissionCode: "audit:read",
        adminOnly: true,
      },
    ],
  },
  {
    kind: "item",
    to: "/settings",
    label: "个人设置",
    icon: Settings,
    aliases: [
      "settings",
      "profile",
      "account",
      "password",
      "security",
      "设置",
      "资料",
      "密码",
    ],
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

type AccessSubject = Account | boolean | null | undefined;

function resolvePermissions(subject: AccessSubject): {
  isSuperAdmin: boolean;
  isAdminLike: boolean;
  codes: Set<string>;
} {
  if (typeof subject === "boolean") {
    const role = subject ? "super_admin" : "member";
    return {
      isSuperAdmin: subject,
      isAdminLike: subject,
      codes: new Set(defaultPermissionCodes(role)),
    };
  }
  if (!subject) {
    return { isSuperAdmin: false, isAdminLike: false, codes: new Set() };
  }
  const isSuperAdmin = subject.role === "super_admin";
  const isAdminLike = isSuperAdmin || subject.role === "admin";
  const list = isSuperAdmin
    ? defaultPermissionCodes("super_admin")
    : Array.isArray(subject.permissions)
      ? subject.permissions
      : defaultPermissionCodes(subject.role);
  return { isSuperAdmin, isAdminLike, codes: new Set(list) };
}

export function canAccessNavLeaf(
  leaf: NavLeafItem,
  subject: AccessSubject,
): boolean {
  if (leaf.demoOnly && !APP_CONFIG.enableDemos) return false;
  if (!leaf.permissionCode && !leaf.permissionCodes?.length && !leaf.adminOnly) {
    return true;
  }
  const { isSuperAdmin, isAdminLike, codes } = resolvePermissions(subject);
  if (isSuperAdmin) return true;
  if (leaf.permissionCode) return codes.has(leaf.permissionCode);
  if (leaf.permissionCodes?.length) {
    return leaf.permissionCodes.some((c) => codes.has(c));
  }
  return Boolean(leaf.adminOnly && isAdminLike);
}

export function getSidebarNodes(subject: AccessSubject): NavNode[] {
  const out: NavNode[] = [];
  for (const node of NAV_REGISTRY) {
    if (node.demoOnly && !APP_CONFIG.enableDemos) continue;
    if (node.kind === "item") {
      if (node.sidebar === false) continue;
      if (!canAccessNavLeaf(node, subject)) continue;
      out.push(node);
    } else {
      const children = node.children.filter(
        (child) => child.sidebar !== false && canAccessNavLeaf(child, subject),
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
  defaultSearch?: Record<string, string>;
}

export function getQuickNavEntries(subject: AccessSubject): QuickNavEntry[] {
  const entries: QuickNavEntry[] = [];
  for (const node of NAV_REGISTRY) {
    if (node.demoOnly && !APP_CONFIG.enableDemos) continue;
    if (node.kind === "item") {
      if (!canAccessNavLeaf(node, subject)) continue;
      entries.push({
        to: node.to,
        label: node.label,
        aliases: node.aliases,
        admin: Boolean(node.adminOnly),
        icon: node.collapsedIcon ?? node.icon,
        defaultSearch: node.defaultSearch,
      });
    } else {
      for (const child of node.children) {
        if (!canAccessNavLeaf(child, subject)) continue;
        entries.push({
          to: child.to,
          label: child.demoOnly ? `${child.label} Demo` : child.label,
          aliases: child.aliases,
          admin: Boolean(child.adminOnly || node.adminOnly),
          icon: child.collapsedIcon ?? child.icon,
          defaultSearch: child.defaultSearch,
        });
      }
    }
  }
  return entries;
}

function flattenLeaves(): NavLeafItem[] {
  const leaves: NavLeafItem[] = [];
  for (const node of NAV_REGISTRY) {
    if (node.kind === "item") leaves.push(node);
    else leaves.push(...node.children);
  }
  return leaves;
}

export function isPathAccessible(
  pathname: string,
  account: Account | null | undefined,
): boolean {
  if (!account) return true;
  if (pathname === "/login" || pathname === "/settings") return true;
  for (const leaf of flattenLeaves()) {
    const matched = leaf.exact
      ? pathname === leaf.to
      : pathname === leaf.to || pathname.startsWith(`${leaf.to}/`);
    if (matched) return canAccessNavLeaf(leaf, account);
  }
  return true;
}

export function getFirstAccessiblePath(
  account: Account | null | undefined,
): NavTarget {
  for (const leaf of flattenLeaves()) {
    if (leaf.sidebar === false || leaf.demoOnly) continue;
    if (canAccessNavLeaf(leaf, account)) return leaf.to;
  }
  return "/settings";
}
