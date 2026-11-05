export interface Account {
  id: number;
  username: string;
  name: string;
  role: string;
  active: boolean;
  sessions?: number;
  email?: string | null;
  company?: string | null;
}
export type AssetStage = "已登记" | "待复核";
// stage/domain accept a single value (existing deep links, saved filters) or an array (multi-select).
export type AssetSearch = {
  q?: string;
  qOp?: "contains" | "equals";
  stage?: AssetStage | AssetStage[];
  domain?: string | string[];
};
export type AccountSearch = {
  q?: string;
  status?: "active" | "disabled";
  role?: "admin" | "member";
};
export type AuditSearch = {
  action?: string;
  actor?: string;
  start?: string;
  end?: string;
  page?: number;
  size?: number;
};
export interface AuditEntry {
  id: number;
  at: string;
  action: string;
  actorId: number | null;
  actorUsername: string;
  actorName: string;
  targetId: number | null;
  targetUsername: string | null;
  targetName: string | null;
  detail: Record<string, unknown>;
}
export interface AuditPage {
  items: AuditEntry[];
  total: number;
  page: number;
  size: number;
}
export interface Asset {
  id: number;
  name: string;
  domain: string;
  owner: string;
  stage: string;
}
const MAX_MESSAGE = 120;
const bounded = (s: string) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > MAX_MESSAGE ? `${t.slice(0, MAX_MESSAGE)}…` : t;
};
/**
 * Reads the body once as text, then parses it as JSON safely.
 * Proxy HTML and empty 502/503 responses are never parsed or shown raw.
 * A 401 still redirects to /login, whatever the body contains.
 */
export async function request<T>(
  path: string,
  method = "GET",
  data?: unknown,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch("/console" + path, {
      method,
      headers: method === "GET" ? {} : { "Content-Type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
  } catch {
    throw new Error("无法连接服务，请检查网络后重试");
  }
  if (res.status === 401 && path !== "/login" && location.pathname !== "/login")
    location.replace("/login");
  let text = "";
  try {
    text = await res.text();
  } catch {
    // 响应体无法读取时按空响应处理。
  }
  let body: unknown;
  let parsed = false;
  if (text) {
    try {
      body = JSON.parse(text);
      parsed = true;
    } catch {
      parsed = false;
    }
  }
  if (!res.ok) {
    const error =
      parsed && body && typeof body === "object" && "error" in body
        ? (body as { error?: unknown }).error
        : undefined;
    if (typeof error === "string" && error.trim()) throw new Error(bounded(error));
    if (res.status >= 502 && res.status <= 504)
      throw new Error(`服务暂时不可用（${res.status}），请稍后重试`);
    throw new Error(`请求失败（${res.status}）`);
  }
  if (res.status === 204) return undefined as T;
  if (!text) throw new Error("服务返回了空响应");
  if (!parsed) throw new Error("服务返回的数据格式无效");
  return body as T;
}
