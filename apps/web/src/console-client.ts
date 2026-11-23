import type {
  ApiToken,
  ApiTokenCreated,
  ApiTokenCreateInput,
  AssetFacetResponse,
  AssetImportCommitResult,
  AssetImportDuplicateMode,
  AssetImportPreview,
  AssetPage,
  AssetSearch,
  Attachment,
  Job,
  JobCreateInput,
  JobPage,
  JobStatus,
  JobType,
} from "@optimax-starter/api";
import { type ClientResponse, hc } from "hono/client";
import type { ConsoleApiType } from "server/rpc";

export type {
  Account,
  AccountInviteLink,
  AccountRole,
  AccountSearch,
  AccountSession,
  ActorSource,
  ApiToken,
  ApiTokenCreated,
  ApiTokenCreateInput,
  Asset,
  AssetExportFilter,
  AssetFacetResponse,
  AssetImportCommitResult,
  AssetImportDuplicateMode,
  AssetImportPreview,
  AssetImportRow,
  AssetPage,
  AssetSearch,
  AssetSortField,
  AssetStage,
  Attachment,
  AuditDetail,
  AuditEntry,
  AuditPage,
  AuditSearch,
  AuthProviderInfo,
  InvitePreview,
  Job,
  JobCreateInput,
  JobPage,
  JobStatus,
  JobType,
  ModulePermissionAction,
  PaginatedResult,
  SystemPermissionMatrixPayload,
  SystemPermissionRow,
  SystemSettingsResponse,
  SystemStatusResponse,
  SystemTab,
} from "@optimax-starter/api";

// Public pages never bounce to /login on 401/410 (e.g. an expired activation link shows its own error).
const isPublicPage = () =>
  location.pathname === "/login" || location.pathname.startsWith("/invite/");

const MAX_MESSAGE = 120;
const bounded = (s: string) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > MAX_MESSAGE ? `${t.slice(0, MAX_MESSAGE)}…` : t;
};

async function consoleFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const headers = new Headers(
    init?.headers ?? (input instanceof Request ? input.headers : undefined),
  );
  let body = init?.body;
  if (method !== "GET" && method !== "HEAD") {
    // FormData sets its own multipart boundary; forcing JSON here would break uploads.
    if (!headers.has("Content-Type") && !(body instanceof FormData)) {
      headers.set("Content-Type", "application/json");
    }
    if (body === undefined || body === null) {
      body = "{}";
    }
  }
  try {
    return await fetch(input, { ...init, headers, body });
  } catch {
    init?.signal?.throwIfAborted();
    throw new Error("无法连接服务，请检查网络后重试");
  }
}

export const api = hc<ConsoleApiType>("/console", { fetch: consoleFetch });

export type RpcSuccessData<R> =
  R extends ClientResponse<infer T, infer S, string>
    ? S extends 200 | 201 | 202 | 203 | 206
      ? T
      : never
    : never;

export async function unwrapRpc<R extends ClientResponse<unknown, number, string>>(
  call: Promise<R>,
  options?: { allow401?: boolean },
): Promise<RpcSuccessData<R>> {
  const res = await call;
  if (res.status === 401 && !options?.allow401 && !isPublicPage()) {
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
  if (res.status === 204) return undefined as RpcSuccessData<R>;
  if (!text) throw new Error("服务返回了空响应");
  if (!parsed) throw new Error("服务返回的数据格式无效");
  return body as RpcSuccessData<R>;
}

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
    res = await fetch(`/console${path}`, {
      method,
      headers: method === "GET" ? {} : { "Content-Type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data),
      signal: options?.signal,
    });
  } catch {
    options?.signal?.throwIfAborted();
    throw new Error("无法连接服务，请检查网络后重试");
  }
  if (res.status === 401 && path !== "/login" && !isPublicPage()) {
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

/**
 * Multipart POST. The browser sets Content-Type with the boundary; cookies and the same-origin
 * Origin header are sent automatically, so the server-side CSRF check still applies.
 */
export async function upload<T>(
  path: string,
  form: FormData,
  options?: { signal?: AbortSignal },
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/console${path}`, { method: "POST", body: form, signal: options?.signal });
  } catch {
    options?.signal?.throwIfAborted();
    throw new Error("无法连接服务，请检查网络后重试");
  }
  if (res.status === 401 && !isPublicPage()) location.replace("/login");
  let text = "";
  try {
    text = await res.text();
  } catch {
    // 响应体无法读取时按空响应处理。
  }
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (!res.ok) {
    const error =
      body && typeof body === "object" && "error" in body
        ? (body as { error?: unknown }).error
        : undefined;
    if (typeof error === "string" && error.trim()) throw new Error(bounded(error));
    if (res.status === 413) throw new Error("文件过大");
    throw new Error(`请求失败（${res.status}）`);
  }
  if (body === undefined) throw new Error("服务返回的数据格式无效");
  return body as T;
}

/** Same-origin download through a temporary anchor (attachment responses are `Content-Disposition: attachment`). */
export function downloadFrom(path: string): void {
  const a = document.createElement("a");
  a.href = `/console${path}`;
  a.rel = "noopener";
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export const attachmentDownloadPath = (id: number) => `/console/attachments/${id}/download`;

// ---------------------------------------------------------------------------
// Assets: server pagination, facets and CSV import
// ---------------------------------------------------------------------------
const listParams = (params: URLSearchParams, key: string, value: string | string[] | undefined) => {
  for (const v of value === undefined ? [] : Array.isArray(value) ? value : [value])
    params.append(key, v);
};

export function assetPageQuery(search: AssetSearch): string {
  const params = new URLSearchParams();
  if (search.code) params.set("code", search.code);
  if (search.code && search.codeOp === "equals") params.set("codeOp", "equals");
  if (search.q) params.set("q", search.q);
  if (search.q && search.qOp === "equals") params.set("qOp", "equals");
  listParams(params, "stage", search.stage);
  listParams(params, "domain", search.domain);
  listParams(params, "owner", search.owner);
  params.set("sortBy", search.sortBy ?? "id");
  params.set("sortDir", search.sortDir ?? "desc");
  params.set("page", String(search.page ?? 1));
  params.set("size", String(search.size ?? 20));
  return params.toString();
}

export const assetsApi = {
  page: (search: AssetSearch, signal?: AbortSignal) =>
    request<AssetPage>(`/assets/page?${assetPageQuery(search)}`, "GET", undefined, { signal }),
  facets: () => request<AssetFacetResponse>("/assets/facets"),
  importTemplatePath: "/console/assets/import/template",
  importForm: (file: File, onDuplicate: AssetImportDuplicateMode) => {
    const form = new FormData();
    form.append("file", file);
    form.append("onDuplicate", onDuplicate);
    return form;
  },
  importPreview: (file: File, onDuplicate: AssetImportDuplicateMode) =>
    upload<AssetImportPreview>("/assets/import/preview", assetsApi.importForm(file, onDuplicate)),
  importCommit: (file: File, onDuplicate: AssetImportDuplicateMode) =>
    upload<AssetImportCommitResult>(
      "/assets/import/commit",
      assetsApi.importForm(file, onDuplicate),
    ),
};

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------
export const attachmentsApi = {
  list: (entityType: "asset" | "job", entityId: number) =>
    request<Attachment[]>(`/attachments?entityType=${entityType}&entityId=${entityId}`),
  upload: (entityId: number, file: File) => {
    const form = new FormData();
    form.append("entityType", "asset");
    form.append("entityId", String(entityId));
    form.append("file", file);
    return upload<Attachment>("/attachments", form);
  },
  remove: (id: number) => request<{ ok: true }>(`/attachments/${id}`, "DELETE", {}),
};

// ---------------------------------------------------------------------------
// Background jobs
// ---------------------------------------------------------------------------
export type JobListQuery = {
  status?: JobStatus;
  type?: JobType;
  mine?: boolean;
  page?: number;
  size?: number;
};

export const ACTIVE_JOB_STATUSES: readonly JobStatus[] = ["pending", "running"];
export const isActiveJob = (job: Pick<Job, "status">) => ACTIVE_JOB_STATUSES.includes(job.status);

export const jobsApi = {
  list: (query: JobListQuery = {}) => {
    const params = new URLSearchParams();
    if (query.status) params.set("status", query.status);
    if (query.type) params.set("type", query.type);
    if (query.mine) params.set("mine", "true");
    params.set("page", String(query.page ?? 1));
    params.set("size", String(query.size ?? 20));
    return request<JobPage>(`/jobs?${params}`);
  },
  get: (id: number, signal?: AbortSignal) =>
    request<Job>(`/jobs/${id}`, "GET", undefined, { signal }),
  create: (input: JobCreateInput) => request<Job>("/jobs", "POST", input),
  retry: (id: number) => request<Job>(`/jobs/${id}/retry`, "POST", {}),
  cancel: (id: number) => request<Job>(`/jobs/${id}/cancel`, "POST", {}),
  /** Polls until the job leaves pending/running; rejects on failed/cancelled or abort. */
  async waitFor(
    id: number,
    options: { intervalMs?: number; signal?: AbortSignal; onProgress?: (job: Job) => void } = {},
  ) {
    const interval = options.intervalMs ?? 1500;
    for (;;) {
      const job = await jobsApi.get(id, options.signal);
      options.onProgress?.(job);
      if (job.status === "succeeded") return job;
      if (job.status === "failed") throw new Error(job.error?.trim() || "任务执行失败");
      if (job.status === "cancelled") throw new Error("任务已取消");
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, interval);
        options.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(options.signal?.reason ?? new DOMException("Aborted", "AbortError"));
          },
          { once: true },
        );
      });
    }
  },
};

/** Artifact attachment id written by the export job's finalize step, if any. */
export const jobArtifactId = (job: Pick<Job, "result">): number | null => {
  const id = job.result?.attachmentId;
  return typeof id === "number" && Number.isInteger(id) && id > 0 ? id : null;
};

// ---------------------------------------------------------------------------
// API tokens (interactive Cookie session only)
// ---------------------------------------------------------------------------
export const tokensApi = {
  list: () => request<ApiToken[]>("/me/tokens"),
  create: (input: ApiTokenCreateInput) => request<ApiTokenCreated>("/me/tokens", "POST", input),
  revoke: (id: number) => request<{ ok: true }>(`/me/tokens/${id}`, "DELETE", {}),
};
