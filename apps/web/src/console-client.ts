export type {
  Account,
  AccountRole,
  AccountSearch,
  ActorSource,
  Asset,
  AssetPage,
  AssetSearch,
  AssetStage,
  AuditDetail,
  AuditEntry,
  AuditPage,
  AuditSearch,
  AuthProviderInfo,
  ModulePermissionAction,
  PaginatedResult,
  SystemPermissionMatrixPayload,
  SystemPermissionRow,
  SystemSettingsResponse,
  SystemStatusResponse,
  SystemTab,
} from "@optimax-starter/api";

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
  options?: { signal?: AbortSignal },
): Promise<T> {
  let res: Response;
  try {
    res = await fetch("/console" + path, {
      method,
      headers: method === "GET" ? {} : { "Content-Type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data),
      signal: options?.signal,
    });
  } catch {
    options?.signal?.throwIfAborted();
    throw new Error("无法连接服务，请检查网络后重试");
  }
  if (res.status === 401 && path !== "/login" && location.pathname !== "/login") {
    location.replace("/login");
  }
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
    if (res.status >= 502 && res.status <= 504) {
      throw new Error(`服务暂时不可用（${res.status}），请稍后重试`);
    }
    throw new Error(`请求失败（${res.status}）`);
  }
  if (res.status === 204) return undefined as T;
  if (!text) throw new Error("服务返回了空响应");
  if (!parsed) throw new Error("服务返回的数据格式无效");
  return body as T;
}
