import { createHmac, generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  OidcError,
  SSO_ERROR_CODES,
  buildAuthorizationUrl,
  codeChallengeS256,
  getOidcConfig,
  safeRedirectPath,
  ssoErrorRedirect,
  toSsoErrorCode,
  validateDiscovery,
  verifyIdToken,
  type OidcJwk,
} from "./oidc";

const ISSUER = "https://idp.example.com";
const CLIENT = "starter-client";
const NONCE = "nonce-abc-123";
const NOW = Date.UTC(2026, 10, 21, 8, 0, 0);
const nowSec = Math.floor(NOW / 1000);

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");

function claims(extra: Record<string, unknown> = {}) {
  return {
    iss: ISSUER,
    sub: "user-1",
    aud: CLIENT,
    exp: nowSec + 300,
    iat: nowSec,
    nonce: NONCE,
    email: "a@example.com",
    email_verified: true,
    ...extra,
  };
}

function signJwt(
  alg: string,
  key: KeyObject | string,
  payload: Record<string, unknown>,
  kid?: string,
): string {
  const header = b64({ alg, typ: "JWT", ...(kid ? { kid } : {}) });
  const body = b64(payload);
  const input = Buffer.from(`${header}.${body}`);
  let sig: Buffer;
  if (alg === "HS256") sig = createHmac("sha256", key as string).update(input).digest();
  else if (alg === "ES256") sig = sign("sha256", input, { key: key as KeyObject, dsaEncoding: "ieee-p1363" });
  else if (alg === "EdDSA") sig = sign(null, input, key as KeyObject);
  else sig = sign("sha256", input, key as KeyObject);
  return `${header}.${body}.${sig.toString("base64url")}`;
}

const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
const ec = generateKeyPairSync("ec", { namedCurve: "P-256" });
const ed = generateKeyPairSync("ed25519");
const otherRsa = generateKeyPairSync("rsa", { modulusLength: 2048 });

const jwk = (k: KeyObject, kid: string): OidcJwk => ({
  ...(k.export({ format: "jwk" }) as Record<string, unknown>),
  kid,
  use: "sig",
});
const KEYS = [jwk(rsa.publicKey, "rsa-1"), jwk(ec.publicKey, "ec-1"), jwk(ed.publicKey, "ed-1")];

const opts = (extra: Partial<Parameters<typeof verifyIdToken>[1]> = {}) => ({
  keys: KEYS,
  issuer: ISSUER,
  clientId: CLIENT,
  nonce: NONCE,
  now: NOW,
  ...extra,
});

const rejects = (fn: () => unknown, code = "token_failed") => {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(OidcError);
    expect((error as OidcError).code).toBe(code);
    return;
  }
  throw new Error("expected rejection");
};

describe("PKCE", () => {
  it("matches the RFC 7636 Appendix B S256 vector", () => {
    expect(codeChallengeS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("builds an authorization URL with S256 challenge, state and nonce", () => {
    const url = new URL(
      buildAuthorizationUrl(
        { authorization_endpoint: `${ISSUER}/authorize` },
        { clientId: CLIENT, redirectUri: "https://app.example.com/cb", scopes: "openid email" },
        { state: "s1", nonce: "n1", codeChallenge: "c1" },
      ),
    );
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("s1");
    expect(url.searchParams.get("nonce")).toBe("n1");
  });
});

describe("id_token verification", () => {
  it("accepts RS256, ES256 and EdDSA tokens signed by JWKS keys", () => {
    expect(verifyIdToken(signJwt("RS256", rsa.privateKey, claims(), "rsa-1"), opts()).sub).toBe("user-1");
    expect(verifyIdToken(signJwt("ES256", ec.privateKey, claims(), "ec-1"), opts()).sub).toBe("user-1");
    expect(verifyIdToken(signJwt("EdDSA", ed.privateKey, claims(), "ed-1"), opts()).sub).toBe("user-1");
  });

  it("accepts HS256 only with the client secret", () => {
    const token = signJwt("HS256", "client-secret-value", claims());
    expect(verifyIdToken(token, opts({ clientSecret: "client-secret-value" })).sub).toBe("user-1");
    rejects(() => verifyIdToken(token, opts({ clientSecret: "wrong" })));
    rejects(() => verifyIdToken(token, opts()));
  });

  it("rejects a bad signature", () => {
    rejects(() => verifyIdToken(signJwt("RS256", otherRsa.privateKey, claims(), "rsa-1"), opts()));
    const good = signJwt("RS256", rsa.privateKey, claims(), "rsa-1");
    const [h, , s] = good.split(".");
    rejects(() => verifyIdToken(`${h}.${b64(claims({ sub: "admin" }))}.${s}`, opts()));
  });

  it("rejects alg=none and unsupported algs", () => {
    const none = `${b64({ alg: "none" })}.${b64(claims())}.`;
    rejects(() => verifyIdToken(none, opts()));
    const noneUpper = `${b64({ alg: "NONE" })}.${b64(claims())}.`;
    rejects(() => verifyIdToken(noneUpper, opts()));
    rejects(() => verifyIdToken(signJwt("RS256", rsa.privateKey, claims(), "rsa-1"), opts({ allowedAlgs: ["ES256"] })));
  });

  it("rejects expired, not-yet-valid, wrong nonce, wrong aud and wrong iss", () => {
    const sign1 = (c: Record<string, unknown>) => signJwt("ES256", ec.privateKey, claims(c), "ec-1");
    rejects(() => verifyIdToken(sign1({ exp: nowSec - 61 }), opts()));
    expect(verifyIdToken(sign1({ exp: nowSec - 30 }), opts()).sub).toBe("user-1"); // 60s skew
    rejects(() => verifyIdToken(sign1({ nbf: nowSec + 120 }), opts()));
    rejects(() => verifyIdToken(sign1({ nonce: "other" }), opts()));
    rejects(() => verifyIdToken(sign1({ aud: "other-client" }), opts()));
    expect(verifyIdToken(sign1({ aud: ["x", CLIENT], azp: CLIENT }), opts()).sub).toBe("user-1");
    rejects(() => verifyIdToken(sign1({ aud: ["x", CLIENT], azp: "x" }), opts()));
    rejects(() => verifyIdToken(sign1({ iss: "https://evil.example.com" }), opts()));
  });

  it("rejects an unknown kid and malformed tokens", () => {
    rejects(() => verifyIdToken(signJwt("RS256", rsa.privateKey, claims(), "rotated"), opts()));
    rejects(() => verifyIdToken("not.a.jwt.token", opts()));
    rejects(() => verifyIdToken("abc", opts()));
  });
});

describe("sso_error mapping", () => {
  it("only emits the fixed enum", () => {
    for (const code of SSO_ERROR_CODES) expect(ssoErrorRedirect(code)).toBe(`/login?sso_error=${code}`);
    expect(toSsoErrorCode("<script>")).toBe("internal");
    expect(ssoErrorRedirect("server_error&x=1")).toBe("/login?sso_error=internal");
    expect(toSsoErrorCode(undefined)).toBe("internal");
  });

  it("only allows same-origin relative redirects", () => {
    expect(safeRedirectPath("/assets?x=1")).toBe("/assets?x=1");
    expect(safeRedirectPath("//evil.example.com")).toBe("/");
    expect(safeRedirectPath("https://evil.example.com")).toBe("/");
    expect(safeRedirectPath("/\\evil")).toBe("/");
    expect(safeRedirectPath(undefined)).toBe("/");
  });
});

describe("configuration and discovery", () => {
  const base = {
    AUTH_OIDC_ENABLED: "true",
    AUTH_OIDC_LABEL: "企业单点登录",
    AUTH_OIDC_ISSUER: ISSUER,
    AUTH_OIDC_CLIENT_ID: CLIENT,
    CORS_ORIGIN: "https://app.example.com",
    NODE_ENV: "production",
  } as NodeJS.ProcessEnv;

  it("is disabled by default and when required fields are missing", () => {
    expect(getOidcConfig({})).toBeNull();
    expect(getOidcConfig({ ...base, AUTH_OIDC_CLIENT_ID: "" })).toBeNull();
    expect(getOidcConfig({ ...base, AUTH_OIDC_PROVIDER_ID: "Bad Id!" })).toBeNull();
    expect(getOidcConfig({ ...base, AUTH_OIDC_ISSUER: "http://idp.example.com" })).toBeNull();
  });

  it("derives defaults", () => {
    const cfg = getOidcConfig(base)!;
    expect(cfg.providerId).toBe("oidc");
    expect(cfg.scopes).toBe("openid profile email");
    expect(cfg.redirectUri).toBe("https://app.example.com/console/auth/sso/oidc/callback");
    expect(cfg.allowEmailLink).toBe(true);
    expect(getOidcConfig({ ...base, AUTH_OIDC_ALLOW_EMAIL_LINK: "false" })!.allowEmailLink).toBe(false);
  });

  it("validates discovery issuer and HTTPS endpoints", () => {
    const doc = {
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
      jwks_uri: `${ISSUER}/jwks`,
    };
    expect(validateDiscovery(doc, ISSUER, true).token_endpoint).toBe(`${ISSUER}/token`);
    expect(() => validateDiscovery({ ...doc, issuer: "https://other" }, ISSUER, true)).toThrow(OidcError);
    expect(() => validateDiscovery({ ...doc, token_endpoint: "http://idp.example.com/token" }, ISSUER, true)).toThrow(
      OidcError,
    );
  });
});
