// Feishu Enterprise OAuth 2.0 + PKCE S256 with zero third-party OAuth dependencies:
// Node 24 `fetch` + `node:crypto` only. Validates tenant_key and strips upstream secrets.
import { getCorsOrigin } from "./config";
import { OidcError, isSecureUrl, readSecretValue } from "./oidc";

const DEFAULT_FEISHU_AUTHORIZE_URL = "https://accounts.feishu.cn/open-apis/authen/v1/authorize";
const DEFAULT_FEISHU_API_BASE = "https://open.feishu.cn";
const FETCH_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 256 * 1024;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type FeishuConfig = {
  providerId: "feishu";
  label: string;
  appId: string;
  appSecret: string;
  tenantKey: string;
  redirectUri: string;
  allowEmailLink: boolean;
  autoProvision: boolean;
  authorizeUrl: string;
  apiBase: string;
};

export type FeishuIdentity = {
  openId: string;
  unionId?: string;
  name: string;
  email?: string;
};

function cleanDisplayText(raw: unknown, max: number): string {
  if (typeof raw !== "string") return "";
  const cleaned = [...raw]
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("")
    .trim();
  return cleaned ? cleaned.slice(0, max) : "";
}

function normalizeEmail(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 254 || !EMAIL_RE.test(trimmed)) return undefined;
  return trimmed;
}

/** Returns null when Feishu OAuth is disabled or required fields/URLs are invalid. */
export function getFeishuConfig(env: NodeJS.ProcessEnv = process.env): FeishuConfig | null {
  if (env.AUTH_FEISHU_ENABLED !== "true") return null;
  const appId = env.AUTH_FEISHU_APP_ID?.trim();
  const appSecret = readSecretValue(env, "AUTH_FEISHU_APP_SECRET_FILE", "AUTH_FEISHU_APP_SECRET");
  const tenantKey = env.AUTH_FEISHU_TENANT_KEY?.trim();
  if (!appId || !appSecret || !tenantKey) return null;

  const production = env.NODE_ENV === "production";
  const authorizeUrl = (env.AUTH_FEISHU_AUTHORIZE_URL?.trim() || DEFAULT_FEISHU_AUTHORIZE_URL).replace(
    /\/+$/,
    "",
  );
  const apiBase = (env.AUTH_FEISHU_API_BASE?.trim() || DEFAULT_FEISHU_API_BASE).replace(/\/+$/, "");
  const origin = (env.CORS_ORIGIN?.trim() || getCorsOrigin()).replace(/\/+$/, "");
  const redirectUri =
    env.AUTH_FEISHU_REDIRECT_URI?.trim() || `${origin}/console/auth/sso/feishu/callback`;

  if (
    !isSecureUrl(authorizeUrl, production) ||
    !isSecureUrl(apiBase, production) ||
    !isSecureUrl(redirectUri, production)
  ) {
    return null;
  }

  return {
    providerId: "feishu",
    label: cleanDisplayText(env.AUTH_FEISHU_LABEL, 60) || "使用飞书登录",
    appId,
    appSecret,
    tenantKey,
    redirectUri,
    allowEmailLink: env.AUTH_FEISHU_ALLOW_EMAIL_LINK !== "false",
    autoProvision: env.AUTH_FEISHU_AUTO_PROVISION === "true",
    authorizeUrl,
    apiBase,
  };
}

export function buildFeishuAuthorizeUrl(
  config: Pick<FeishuConfig, "authorizeUrl" | "appId" | "redirectUri">,
  params: { state: string; codeChallenge: string },
): string {
  const url = new URL(config.authorizeUrl);
  url.searchParams.set("client_id", config.appId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

async function fetchFeishuJson(url: string, init: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    throw new OidcError("token_failed", "feishu upstream request failed");
  }
  const contentType = res.headers.get("content-type") ?? "";
  const text = await res.text();
  if (text.length > MAX_BODY_BYTES) {
    throw new OidcError("token_failed", "feishu upstream body too large");
  }
  if (!res.ok || !contentType.includes("application/json")) {
    throw new OidcError("token_failed", `feishu upstream status ${res.status}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new OidcError("token_failed", "feishu upstream invalid JSON");
  }
}

type FeishuTokenPayload = {
  code?: number;
  error?: string;
  access_token?: string;
};

type FeishuUserInfoPayload = {
  code?: number;
  data?: {
    tenant_key?: string;
    open_id?: string;
    union_id?: string;
    name?: string;
    en_name?: string;
    email?: string;
    enterprise_email?: string;
  };
};

/**
 * Exchanges an authorization code + PKCE verifier with Feishu v2 OAuth, fetches v1 user_info,
 * enforces `tenant_key === config.tenantKey`, and returns a sanitized identity without secrets.
 */
export async function verifyFeishuCode(
  config: FeishuConfig,
  code: string,
  codeVerifier: string,
): Promise<FeishuIdentity> {
  const tokenBody = (await fetchFeishuJson(`${config.apiBase}/open-apis/authen/v2/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: config.appId,
      client_secret: config.appSecret,
      redirect_uri: config.redirectUri,
      code,
      code_verifier: codeVerifier,
    }),
  })) as FeishuTokenPayload | null;

  if (
    !tokenBody ||
    typeof tokenBody !== "object" ||
    tokenBody.error ||
    (tokenBody.code !== undefined && tokenBody.code !== 0) ||
    typeof tokenBody.access_token !== "string" ||
    !tokenBody.access_token
  ) {
    throw new OidcError("token_failed", "feishu token exchange rejected");
  }

  const profileBody = (await fetchFeishuJson(`${config.apiBase}/open-apis/authen/v1/user_info`, {
    headers: { Authorization: `Bearer ${tokenBody.access_token}`, Accept: "application/json" },
  })) as FeishuUserInfoPayload | null;

  if (
    !profileBody ||
    typeof profileBody !== "object" ||
    profileBody.code !== 0 ||
    !profileBody.data ||
    typeof profileBody.data !== "object"
  ) {
    throw new OidcError("token_failed", "feishu user_info rejected");
  }

  const data = profileBody.data;
  if (typeof data.tenant_key !== "string" || data.tenant_key !== config.tenantKey) {
    throw new OidcError("tenant_forbidden", "feishu tenant mismatch");
  }

  const openId = typeof data.open_id === "string" ? data.open_id.trim() : "";
  if (!openId || openId.length > 255) {
    throw new OidcError("token_failed", "feishu open_id missing");
  }

  const unionId = cleanDisplayText(data.union_id, 128) || undefined;
  const name =
    cleanDisplayText(data.name, 80) || cleanDisplayText(data.en_name, 80) || "飞书用户";
  const email = normalizeEmail(data.enterprise_email) ?? normalizeEmail(data.email);

  return {
    openId: openId.slice(0, 128),
    ...(unionId ? { unionId } : {}),
    name,
    ...(email ? { email } : {}),
  };
}
