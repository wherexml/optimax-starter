// Standard OIDC (Authorization Code + PKCE S256) with zero third-party OAuth dependencies:
// Node 24 `fetch` + `node:crypto` only. Pure helpers are exported for unit tests.
// Never log or return client secrets, codes, tokens, nonces or verifiers.
import {
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify as cryptoVerify,
  constants as cryptoConstants,
  type KeyObject,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { getCorsOrigin } from "./config";

/** Structural JWK (avoids relying on a `JsonWebKey` export from node:crypto typings). */
export type OidcJwk = Record<string, unknown> & {
  kty?: string;
  use?: string;
  alg?: string;
  kid?: string;
  crv?: string;
};

// ---------------------------------------------------------------------------
// Fixed, safe error codes reflected to /login?sso_error=<code>
// ---------------------------------------------------------------------------
export const SSO_ERROR_CODES = [
  "provider_disabled",
  "cancelled",
  "state_invalid",
  "token_failed",
  "unmatched",
  "inactive",
  "internal",
] as const;
export type SsoErrorCode = (typeof SSO_ERROR_CODES)[number];

export function toSsoErrorCode(value: unknown): SsoErrorCode {
  return typeof value === "string" && (SSO_ERROR_CODES as readonly string[]).includes(value)
    ? (value as SsoErrorCode)
    : "internal";
}

export function ssoErrorRedirect(code: SsoErrorCode | string): string {
  return `/login?sso_error=${toSsoErrorCode(code)}`;
}

export class OidcError extends Error {
  code: SsoErrorCode;
  constructor(code: SsoErrorCode, message: string) {
    super(message);
    this.name = "OidcError";
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const PROVIDER_ID_RE = /^[a-z0-9_-]{1,32}$/;

export type OidcConfig = {
  providerId: string;
  label: string;
  issuer: string;
  clientId: string;
  clientSecret: string | null;
  scopes: string;
  redirectUri: string;
  allowEmailLink: boolean;
};

function readSecret(env: NodeJS.ProcessEnv): string | null {
  const file = env.AUTH_OIDC_CLIENT_SECRET_FILE?.trim();
  if (file) {
    try {
      const value = readFileSync(file, "utf8").trim();
      if (value) return value;
    } catch {
      // Fall back to the env var; the file path and content are never logged.
    }
  }
  return env.AUTH_OIDC_CLIENT_SECRET?.trim() || null;
}

export function isSecureUrl(raw: string, production: boolean): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.username || url.password || url.hash) return false;
  if (url.protocol === "https:") return true;
  if (production || url.protocol !== "http:") return false;
  // Development only: allow plain HTTP for a local IdP (e.g. Keycloak / Dex in Compose).
  return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !url.hostname.includes(".");
}

/** Returns null when OIDC is disabled or required fields are missing/invalid. */
export function getOidcConfig(env: NodeJS.ProcessEnv = process.env): OidcConfig | null {
  if (env.AUTH_OIDC_ENABLED !== "true") return null;
  const providerId = env.AUTH_OIDC_PROVIDER_ID?.trim() || "oidc";
  const label = env.AUTH_OIDC_LABEL?.trim();
  const issuer = env.AUTH_OIDC_ISSUER?.trim().replace(/\/+$/, "");
  const clientId = env.AUTH_OIDC_CLIENT_ID?.trim();
  if (!PROVIDER_ID_RE.test(providerId) || !label || !issuer || !clientId) return null;
  const production = env.NODE_ENV === "production";
  if (!isSecureUrl(issuer, production)) return null;
  const redirectUri =
    env.AUTH_OIDC_REDIRECT_URI?.trim() ||
    `${(env.CORS_ORIGIN?.trim() || getCorsOrigin()).replace(/\/+$/, "")}/console/auth/sso/${providerId}/callback`;
  if (!isSecureUrl(redirectUri, production)) return null;
  return {
    providerId,
    label,
    issuer,
    clientId,
    clientSecret: readSecret(env),
    scopes: env.AUTH_OIDC_SCOPES?.trim() || "openid profile email",
    redirectUri,
    allowEmailLink: env.AUTH_OIDC_ALLOW_EMAIL_LINK !== "false",
  };
}

// ---------------------------------------------------------------------------
// PKCE / random values
// ---------------------------------------------------------------------------
export const base64url = (buf: Buffer) => buf.toString("base64url");
export const randomToken = (bytes = 32) => base64url(randomBytes(bytes));
export const createCodeVerifier = () => randomToken(32);
export const codeChallengeS256 = (verifier: string) =>
  base64url(createHash("sha256").update(verifier, "ascii").digest());

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// ---------------------------------------------------------------------------
// Discovery + JWKS (in-memory TTL cache)
// ---------------------------------------------------------------------------
export type OidcDiscovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  userinfo_endpoint?: string;
  id_token_signing_alg_values_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
};

const DISCOVERY_TTL_MS = 60 * 60_000;
const JWKS_TTL_MS = 60 * 60_000;
const JWKS_MIN_REFRESH_MS = 30_000;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 256 * 1024;

const discoveryCache = new Map<string, { at: number; value: OidcDiscovery }>();
const jwksCache = new Map<string, { at: number; keys: OidcJwk[] }>();

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    redirect: "error",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  const text = await res.text();
  if (text.length > MAX_BODY_BYTES) throw new OidcError("token_failed", "upstream body too large");
  if (!res.ok) throw new OidcError("token_failed", `upstream status ${res.status}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new OidcError("token_failed", "upstream returned invalid JSON");
  }
}

export function validateDiscovery(
  raw: unknown,
  expectedIssuer: string,
  production: boolean,
): OidcDiscovery {
  const d = raw as Partial<OidcDiscovery> | null;
  if (!d || typeof d !== "object") throw new OidcError("internal", "invalid discovery document");
  const issuer = typeof d.issuer === "string" ? d.issuer.replace(/\/+$/, "") : "";
  if (issuer !== expectedIssuer.replace(/\/+$/, "")) {
    throw new OidcError("internal", "discovery issuer mismatch");
  }
  for (const key of ["authorization_endpoint", "token_endpoint", "jwks_uri"] as const) {
    const value = d[key];
    if (typeof value !== "string" || !isSecureUrl(value, production)) {
      throw new OidcError("internal", `discovery ${key} invalid`);
    }
  }
  if (d.userinfo_endpoint !== undefined && (typeof d.userinfo_endpoint !== "string" || !isSecureUrl(d.userinfo_endpoint, production))) {
    throw new OidcError("internal", "discovery userinfo_endpoint invalid");
  }
  return { ...(d as OidcDiscovery), issuer: d.issuer as string };
}

export async function getDiscovery(config: OidcConfig): Promise<OidcDiscovery> {
  const cached = discoveryCache.get(config.issuer);
  if (cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.value;
  const raw = await fetchJson(`${config.issuer}/.well-known/openid-configuration`, {
    headers: { Accept: "application/json" },
  });
  const value = validateDiscovery(raw, config.issuer, process.env.NODE_ENV === "production");
  discoveryCache.set(config.issuer, { at: Date.now(), value });
  return value;
}

async function loadJwks(uri: string, force: boolean): Promise<OidcJwk[]> {
  const cached = jwksCache.get(uri);
  const age = cached ? Date.now() - cached.at : Number.POSITIVE_INFINITY;
  if (cached && (!force ? age < JWKS_TTL_MS : age < JWKS_MIN_REFRESH_MS)) return cached.keys;
  const raw = (await fetchJson(uri, { headers: { Accept: "application/json" } })) as {
    keys?: unknown;
  };
  const keys = Array.isArray(raw?.keys) ? (raw.keys as OidcJwk[]) : [];
  jwksCache.set(uri, { at: Date.now(), keys });
  return keys;
}

/** Test hook: clears discovery/JWKS caches. */
export function resetOidcCaches() {
  discoveryCache.clear();
  jwksCache.clear();
}

// ---------------------------------------------------------------------------
// JWT verification
// ---------------------------------------------------------------------------
export const SUPPORTED_ALGS = [
  "RS256",
  "RS384",
  "RS512",
  "PS256",
  "PS384",
  "PS512",
  "ES256",
  "ES384",
  "ES512",
  "EdDSA",
  "HS256",
] as const;

export type IdTokenClaims = {
  iss: string;
  sub: string;
  aud: string | string[];
  exp: number;
  iat?: number;
  nbf?: number;
  nonce?: string;
  azp?: string;
  email?: string;
  email_verified?: boolean | string;
  preferred_username?: string;
  name?: string;
  [key: string]: unknown;
};

export type VerifyOptions = {
  keys: OidcJwk[];
  issuer: string;
  clientId: string;
  nonce: string;
  clientSecret?: string | null;
  allowedAlgs?: readonly string[];
  now?: number;
  skewSeconds?: number;
};

type JwtParts = {
  header: { alg?: string; kid?: string; typ?: string };
  payload: IdTokenClaims;
  signingInput: Buffer;
  signature: Buffer;
};

export function decodeJwt(token: string): JwtParts {
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]*$/.test(p))) {
    throw new OidcError("token_failed", "malformed JWT");
  }
  try {
    return {
      header: JSON.parse(Buffer.from(parts[0]!, "base64url").toString("utf8")),
      payload: JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8")),
      signingInput: Buffer.from(`${parts[0]}.${parts[1]}`, "ascii"),
      signature: Buffer.from(parts[2]!, "base64url"),
    };
  } catch {
    throw new OidcError("token_failed", "malformed JWT");
  }
}

const HASH_BY_SIZE: Record<string, string> = { "256": "sha256", "384": "sha384", "512": "sha512" };
const CURVE_BY_ALG: Record<string, string> = { ES256: "P-256", ES384: "P-384", ES512: "P-521" };

function keyMatchesAlg(jwk: OidcJwk, alg: string): boolean {
  if (jwk.use && jwk.use !== "sig") return false;
  if (jwk.alg && jwk.alg !== alg) return false;
  if (alg.startsWith("RS") || alg.startsWith("PS")) return jwk.kty === "RSA";
  if (alg.startsWith("ES")) return jwk.kty === "EC" && jwk.crv === CURVE_BY_ALG[alg];
  if (alg === "EdDSA") return jwk.kty === "OKP" && (jwk.crv === "Ed25519" || jwk.crv === "Ed448");
  return false;
}

function verifyWithKey(alg: string, key: KeyObject, data: Buffer, sig: Buffer): boolean {
  if (alg === "EdDSA") return cryptoVerify(null, data, key, sig);
  const hash = HASH_BY_SIZE[alg.slice(2)];
  if (!hash) return false;
  if (alg.startsWith("RS")) return cryptoVerify(hash, data, key, sig);
  if (alg.startsWith("PS")) {
    return cryptoVerify(
      hash,
      data,
      {
        key,
        padding: cryptoConstants.RSA_PKCS1_PSS_PADDING,
        saltLength: cryptoConstants.RSA_PSS_SALTLEN_DIGEST,
      },
      sig,
    );
  }
  if (alg.startsWith("ES")) return cryptoVerify(hash, data, { key, dsaEncoding: "ieee-p1363" }, sig);
  return false;
}

export class UnknownKidError extends OidcError {
  constructor() {
    super("token_failed", "no JWKS key matches token kid");
  }
}

/** Verifies signature + standard claims. Throws OidcError on any failure. */
export function verifyIdToken(token: string, options: VerifyOptions): IdTokenClaims {
  const { header, payload, signingInput, signature } = decodeJwt(token);
  const alg = header.alg;
  const allowed = options.allowedAlgs ?? SUPPORTED_ALGS;
  if (!alg || alg.toLowerCase() === "none" || !allowed.includes(alg) || !(SUPPORTED_ALGS as readonly string[]).includes(alg)) {
    throw new OidcError("token_failed", "unsupported JWT alg");
  }
  let valid = false;
  if (alg === "HS256") {
    if (!options.clientSecret) throw new OidcError("token_failed", "HS256 requires client secret");
    const expected = createHmac("sha256", options.clientSecret).update(signingInput).digest();
    valid = expected.length === signature.length && timingSafeEqual(expected, signature);
  } else {
    const candidates = options.keys.filter(
      (k) => keyMatchesAlg(k, alg) && (!header.kid || k.kid === header.kid),
    );
    if (!candidates.length) {
      if (header.kid) throw new UnknownKidError();
      throw new OidcError("token_failed", "no JWKS key for alg");
    }
    for (const jwk of candidates) {
      try {
        const key = createPublicKey({ key: jwk as never, format: "jwk" });
        if (verifyWithKey(alg, key, signingInput, signature)) {
          valid = true;
          break;
        }
      } catch {
        // Malformed key: try the next candidate.
      }
    }
  }
  if (!valid) throw new OidcError("token_failed", "invalid JWT signature");

  const now = Math.floor((options.now ?? Date.now()) / 1000);
  const skew = options.skewSeconds ?? 60;
  if (typeof payload !== "object" || payload === null) throw new OidcError("token_failed", "invalid claims");
  if (payload.iss !== options.issuer) throw new OidcError("token_failed", "issuer mismatch");
  if (typeof payload.sub !== "string" || !payload.sub || payload.sub.length > 255) {
    throw new OidcError("token_failed", "invalid subject");
  }
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(options.clientId)) throw new OidcError("token_failed", "audience mismatch");
  if (aud.length > 1 && payload.azp !== undefined && payload.azp !== options.clientId) {
    throw new OidcError("token_failed", "azp mismatch");
  }
  if (typeof payload.exp !== "number" || payload.exp + skew <= now) {
    throw new OidcError("token_failed", "token expired");
  }
  if (typeof payload.nbf === "number" && payload.nbf - skew > now) {
    throw new OidcError("token_failed", "token not yet valid");
  }
  if (typeof payload.iat === "number" && payload.iat - skew > now) {
    throw new OidcError("token_failed", "token issued in the future");
  }
  if (typeof payload.nonce !== "string" || !safeEqual(payload.nonce, options.nonce)) {
    throw new OidcError("token_failed", "nonce mismatch");
  }
  return payload;
}

/** Verifies against the provider JWKS, refreshing once when the token's kid is unknown. */
export async function verifyIdTokenWithJwks(
  config: OidcConfig,
  discovery: OidcDiscovery,
  token: string,
  nonce: string,
): Promise<IdTokenClaims> {
  const base = {
    issuer: discovery.issuer,
    clientId: config.clientId,
    nonce,
    clientSecret: config.clientSecret,
    allowedAlgs: discovery.id_token_signing_alg_values_supported?.length
      ? discovery.id_token_signing_alg_values_supported.filter((a) => a !== "none")
      : undefined,
  };
  try {
    return verifyIdToken(token, { ...base, keys: await loadJwks(discovery.jwks_uri, false) });
  } catch (error) {
    if (!(error instanceof UnknownKidError)) throw error;
    return verifyIdToken(token, { ...base, keys: await loadJwks(discovery.jwks_uri, true) });
  }
}

// ---------------------------------------------------------------------------
// Authorization request / token exchange / userinfo
// ---------------------------------------------------------------------------
export function buildAuthorizationUrl(
  discovery: Pick<OidcDiscovery, "authorization_endpoint">,
  config: Pick<OidcConfig, "clientId" | "redirectUri" | "scopes">,
  params: { state: string; nonce: string; codeChallenge: string },
): string {
  const url = new URL(discovery.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", config.scopes);
  url.searchParams.set("state", params.state);
  url.searchParams.set("nonce", params.nonce);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export type TokenResponse = { id_token?: string; access_token?: string; token_type?: string };

export async function exchangeCode(
  config: OidcConfig,
  discovery: OidcDiscovery,
  code: string,
  codeVerifier: string,
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
    code_verifier: codeVerifier,
  });
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  const methods = discovery.token_endpoint_auth_methods_supported ?? ["client_secret_basic"];
  if (config.clientSecret && !methods.includes("client_secret_basic") && methods.includes("client_secret_post")) {
    body.set("client_id", config.clientId);
    body.set("client_secret", config.clientSecret);
  } else if (config.clientSecret) {
    const enc = (v: string) => encodeURIComponent(v);
    headers.Authorization = `Basic ${Buffer.from(`${enc(config.clientId)}:${enc(config.clientSecret)}`).toString("base64")}`;
  } else {
    body.set("client_id", config.clientId);
  }
  const raw = (await fetchJson(discovery.token_endpoint, {
    method: "POST",
    headers,
    body: body.toString(),
  })) as TokenResponse;
  if (!raw || typeof raw.id_token !== "string") {
    throw new OidcError("token_failed", "token response missing id_token");
  }
  return raw;
}

export async function fetchUserinfo(
  discovery: OidcDiscovery,
  accessToken: string,
  expectedSub: string,
): Promise<Partial<IdTokenClaims> | null> {
  if (!discovery.userinfo_endpoint) return null;
  const raw = (await fetchJson(discovery.userinfo_endpoint, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  })) as Partial<IdTokenClaims>;
  // OIDC Core §5.3.2: userinfo sub MUST match the verified id_token sub.
  if (!raw || raw.sub !== expectedSub) return null;
  return raw;
}

export function isEmailVerified(claims: Partial<IdTokenClaims>): boolean {
  return claims.email_verified === true || claims.email_verified === "true";
}

/** Only same-origin relative paths are accepted as post-login redirects. */
export function safeRedirectPath(raw: string | undefined | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/";
  if (raw.length > 512 || /[\u0000-\u001f]/.test(raw)) return "/";
  return raw;
}
