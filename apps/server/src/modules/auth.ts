import { randomBytes } from "node:crypto";
import {
  type AccountSession,
  type AuditDetail,
  type AuthProviderInfo,
  credentialsSchema,
  INVITE_TOKEN_RE,
  type InvitePreview,
  inviteAcceptSchema,
  passwordChangeSchema,
  profileInputSchema,
} from "@optimax-starter/api";
import {
  accountInvites,
  accounts,
  apiTokens,
  authIdentities,
  oidcStates,
  sessions,
} from "@optimax-starter/db/schema/console";
import { and, desc, eq, gt, isNull, lt, ne, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { audit } from "../core/audit";
import { getCookieName, getCorsOrigin, SESSION_LIFETIME_SECONDS } from "../core/config";
import {
  buildFeishuAuthorizeUrl,
  type FeishuConfig,
  type FeishuIdentity,
  getFeishuConfig,
  verifyFeishuCode,
} from "../core/feishu";
import {
  ADMIN_LOCK,
  digest,
  type Env,
  errorJson,
  getClientIp,
  guarded,
  jsonBody,
  type Party,
  parsePositiveId,
  profileFields,
  Refusal,
  requireCookieSession,
  type Tx,
} from "../core/guards";
import {
  clearUserGuard,
  findActiveLock,
  ipGuardKey,
  lockedMessage,
  pruneLoginGuards,
  recordIpFailure,
  recordLoginFailure,
  retryAfterSeconds,
  userGuardKey,
} from "../core/login-guard";
import {
  buildAuthorizationUrl,
  codeChallengeS256,
  createCodeVerifier,
  exchangeCode,
  fetchUserinfo,
  getDiscovery,
  getOidcConfig,
  type IdTokenClaims,
  isEmailVerified,
  OidcError,
  randomToken,
  type SsoErrorCode,
  safeEqual,
  safeRedirectPath,
  ssoErrorRedirect,
  toSsoErrorCode,
  verifyIdTokenWithJwks,
} from "../core/oidc";
import { getEffectivePermissions } from "../core/permissions";
import { getConfiguredSessionTtlSeconds } from "../core/system-settings";
import { hashPassword, verifyPassword } from "../password";
import { db } from "../services";

function sanitizeUserAgent(raw: string | undefined): string | null {
  if (!raw) return null;
  const cleaned = [...raw]
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("")
    .trim();
  if (!cleaned) return null;
  return cleaned.slice(0, 160);
}

function currentSessionKey(c: Context<Env>): string {
  return digest(getCookie(c, getCookieName()) ?? "");
}

const secureCookies = () => getCorsOrigin().startsWith("https://");

const OIDC_STATE_TTL_SECONDS = 10 * 60;
const oidcStateCookie = () => `${getCookieName()}_oidc`;
const OIDC_COOKIE_PATH = "/console/auth/sso/";

/** Creates a session row using the configured TTL. Runs inside the caller's transaction. */
async function createSession(c: Context<Env>, tx: Tx, accountId: number, ip: string) {
  await tx.delete(sessions).where(lt(sessions.expires, new Date()));
  const ttlSeconds = await getConfiguredSessionTtlSeconds(tx);
  const token = randomBytes(32).toString("hex");
  await tx.insert(sessions).values({
    key: digest(token),
    account: accountId,
    expires: new Date(Date.now() + ttlSeconds * 1000),
    userAgent: sanitizeUserAgent(c.req.header("user-agent")),
    ipAddress: ip,
    lastSeenAt: new Date(),
  });
  return { token, ttlSeconds };
}

export function setSessionCookie(
  c: Context<Env>,
  token: string,
  maxAgeSeconds = SESSION_LIFETIME_SECONDS,
) {
  setCookie(c, getCookieName(), token, {
    httpOnly: true,
    sameSite: "Strict",
    secure: secureCookies(),
    path: "/",
    maxAge: maxAgeSeconds,
  });
}

// Dummy Argon2id hash so unknown usernames cost the same verify time as real ones.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword(randomBytes(24).toString("hex")));

function lockedResponse(c: Context<Env>, lockedUntil: Date) {
  const seconds = retryAfterSeconds(lockedUntil, new Date());
  return errorJson(c, 429, lockedMessage(seconds), "AUTH_LOCKED", {
    "Retry-After": String(seconds),
  });
}

function failedLoginParty(
  account: Party | undefined,
  username: string,
): { actor: { id: null; username: string; name: string }; target: Party | null } {
  if (account) {
    return {
      actor: { id: null, username: account.username, name: account.name },
      target: { id: account.id, username: account.username, name: account.name },
    };
  }
  return {
    actor: { id: null, username: username.slice(0, 80), name: "未知账户" },
    target: null,
  };
}

async function auditLoginFailure(
  account: Party | undefined,
  username: string,
  ip: string,
  reason: string,
) {
  const { actor, target } = failedLoginParty(account, username);
  try {
    await audit(db, "auth.login_failed", actor, target, { ip, reason });
  } catch {
    // Audit insert failure must not turn a 401/429 into a 500 or leak details.
  }
}

type InviteRow = {
  id: number;
  accountId: number;
  expiresAt: Date;
  usedAt: Date | null;
  revokedAt: Date | null;
  username: string;
  name: string;
};

function inviteProblem(invite: InviteRow | undefined, now: Date): Refusal | null {
  if (!invite) return new Refusal(404, "邀请链接无效", "AUTH_INVITE_INVALID");
  if (invite.revokedAt) return new Refusal(410, "邀请链接已被撤销", "AUTH_INVITE_REVOKED");
  if (invite.usedAt) return new Refusal(410, "邀请链接已使用", "AUTH_INVITE_USED");
  if (invite.expiresAt.getTime() <= now.getTime()) {
    return new Refusal(410, "邀请链接已过期", "AUTH_INVITE_EXPIRED");
  }
  return null;
}

const inviteFields = {
  id: accountInvites.id,
  accountId: accountInvites.accountId,
  expiresAt: accountInvites.expiresAt,
  usedAt: accountInvites.usedAt,
  revokedAt: accountInvites.revokedAt,
  username: accounts.username,
  name: accounts.name,
};

function rawProviderList(): AuthProviderInfo[] {
  const providers: AuthProviderInfo[] = [];
  const oidc = getOidcConfig();
  if (oidc) {
    providers.push({
      id: oidc.providerId,
      label: oidc.label,
      loginPath: `/console/auth/sso/${oidc.providerId}/start`,
    });
  }
  const feishu = getFeishuConfig();
  if (feishu && !providers.some((p) => p.id === feishu.providerId)) {
    providers.push({
      id: feishu.providerId,
      label: feishu.label,
      loginPath: `/console/auth/sso/${feishu.providerId}/start`,
      icon: "feishu",
    });
  }
  if (
    process.env.AUTH_SSO_ENABLED === "true" &&
    process.env.AUTH_SSO_LABEL &&
    process.env.AUTH_SSO_LOGIN_PATH &&
    !providers.some((p) => p.id === "sso")
  ) {
    providers.push({
      id: "sso",
      label: process.env.AUTH_SSO_LABEL,
      loginPath: process.env.AUTH_SSO_LOGIN_PATH,
    });
  }
  return providers;
}

/** Anti-lockout guard: password login stays enabled unless at least one SSO provider is active. */
function isPasswordLoginEnabled(): boolean {
  return !(process.env.AUTH_PASSWORD_LOGIN_ENABLED === "false" && rawProviderList().length > 0);
}

function providerList(): AuthProviderInfo[] {
  const providers = rawProviderList();
  if (isPasswordLoginEnabled()) return providers;
  return providers.map((p) => ({ ...p, passwordLoginDisabled: true }));
}

const PRIVILEGED_ROLES = new Set(["admin", "super_admin"]);

type SsoOutcome =
  | { ok: true; token: string; ttlSeconds: number; account: Party }
  | { ok: false; code: SsoErrorCode; reason: string; account?: Party };

/** Picks a unique console username for JIT-provisioned Feishu member accounts. */
async function allocateFeishuUsername(tx: Tx, identity: FeishuIdentity): Promise<string> {
  const candidates: string[] = [];
  const emailLower = identity.email?.toLowerCase();
  if (emailLower && emailLower.length <= 64) {
    candidates.push(emailLower);
  }
  const slug = identity.openId.toLowerCase().replace(/[^a-z0-9_-]/g, "") || "user";
  const base = `feishu_${slug.slice(0, 24)}`;
  candidates.push(base);

  for (const candidate of candidates) {
    const [existing] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.username, candidate))
      .limit(1);
    if (!existing) return candidate;
  }

  for (let i = 2; i < 1000; i++) {
    const suffix = `_${i}`;
    const candidate = `${base.slice(0, 64 - suffix.length)}${suffix}`;
    const [existing] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.username, candidate))
      .limit(1);
    if (!existing) return candidate;
  }

  return `feishu_${randomBytes(8).toString("hex")}`;
}

/**
 * Resolves a verified Feishu identity inside ADMIN_LOCK:
 * 1) existing console_auth_identity link;
 * 2) existing active account matched by enterprise email (if allowEmailLink);
 * 3) optional JIT creation of a `member` account (only when autoProvision is enabled and not matched).
 */
async function resolveFeishuAccount(
  c: Context<Env>,
  config: FeishuConfig,
  identity: FeishuIdentity,
  ip: string,
): Promise<SsoOutcome> {
  const provisionHash = config.autoProvision
    ? await hashPassword(randomBytes(32).toString("hex"))
    : null;
  return db.transaction(async (tx) => {
    await tx.execute(ADMIN_LOCK);
    const selectAccount = () =>
      tx
        .select({
          id: accounts.id,
          username: accounts.username,
          name: accounts.name,
          role: accounts.role,
          active: accounts.active,
        })
        .from(accounts);

    const [linked] = await tx
      .select({ accountId: authIdentities.accountId })
      .from(authIdentities)
      .where(
        and(eq(authIdentities.provider, "feishu"), eq(authIdentities.subject, identity.openId)),
      );

    let account: Awaited<ReturnType<typeof selectAccount>>[number] | undefined;
    if (linked) {
      [account] = await selectAccount().where(eq(accounts.id, linked.accountId));
    } else if (config.allowEmailLink && identity.email) {
      const emailMatches = await selectAccount()
        .where(sql`lower(${accounts.email}) = lower(${identity.email})`)
        .limit(2);
      if (emailMatches.length > 1) return { ok: false, code: "unmatched", reason: "ambiguous" };
      account = emailMatches[0];

      if (!account) {
        const [byName] = await selectAccount().where(
          sql`lower(${accounts.username}) = lower(${identity.email})`,
        );
        if (byName && !PRIVILEGED_ROLES.has(byName.role)) account = byName;
      }

      if (account?.active) {
        await tx
          .insert(authIdentities)
          .values({
            accountId: account.id,
            provider: "feishu",
            subject: identity.openId,
            email: identity.email.slice(0, 254),
          })
          .onConflictDoNothing();
      }
    }

    if (!account && config.autoProvision && provisionHash) {
      const username = await allocateFeishuUsername(tx, identity);
      const [created] = await tx
        .insert(accounts)
        .values({
          username,
          name: identity.name,
          role: "member",
          active: true,
          hash: provisionHash,
          email: identity.email ?? null,
          company: null,
        })
        .returning({
          id: accounts.id,
          username: accounts.username,
          name: accounts.name,
          role: accounts.role,
          active: accounts.active,
        });
      if (created) {
        account = created;
        await tx
          .insert(authIdentities)
          .values({
            accountId: created.id,
            provider: "feishu",
            subject: identity.openId,
            email: identity.email ?? null,
          })
          .onConflictDoNothing();
        const createdParty = { id: created.id, username: created.username, name: created.name };
        await audit(tx, "account.create", createdParty, createdParty, {
          role: "member",
          provider: "feishu",
          ip,
          ...(identity.email ? { fields: ["email"] } : {}),
        });
      }
    }

    if (!account) return { ok: false, code: "unmatched", reason: "unmatched" };
    const party = { id: account.id, username: account.username, name: account.name };
    if (!account.active) return { ok: false, code: "inactive", reason: "inactive", account: party };

    const { token, ttlSeconds } = await createSession(c, tx, account.id, ip);
    await clearUserGuard(tx, account.username);
    await audit(tx, "auth.sso_login", party, party, { provider: "feishu", ip });
    return { ok: true, token, ttlSeconds, account: party };
  });
}

/** Resolves an OIDC identity to an existing active account. Never creates accounts. */
async function resolveSsoAccount(
  c: Context<Env>,
  provider: string,
  claims: Partial<IdTokenClaims> & { sub: string },
  allowEmailLink: boolean,
  ip: string,
): Promise<SsoOutcome> {
  return db.transaction(async (tx) => {
    // Linking identities and creating sessions is a security-state mutation: exclusive lock.
    await tx.execute(ADMIN_LOCK);
    const select = () =>
      tx
        .select({
          id: accounts.id,
          username: accounts.username,
          name: accounts.name,
          role: accounts.role,
          active: accounts.active,
        })
        .from(accounts);
    const [linked] = await tx
      .select({ accountId: authIdentities.accountId })
      .from(authIdentities)
      .where(and(eq(authIdentities.provider, provider), eq(authIdentities.subject, claims.sub)));
    let account: Awaited<ReturnType<typeof select>>[number] | undefined;
    if (linked) {
      [account] = await select().where(eq(accounts.id, linked.accountId));
    } else if (allowEmailLink) {
      const email = typeof claims.email === "string" ? claims.email.trim() : "";
      if (email && isEmailVerified(claims)) {
        const matches = await select()
          .where(sql`lower(${accounts.email}) = lower(${email})`)
          .limit(2);
        if (matches.length > 1) return { ok: false, code: "unmatched", reason: "ambiguous" };
        account = matches[0];
      }
      const preferred =
        typeof claims.preferred_username === "string" ? claims.preferred_username.trim() : "";
      if (!account && preferred) {
        const [byName] = await select().where(eq(accounts.username, preferred));
        // preferred_username is not a verified claim: never auto-link privileged accounts by it.
        if (byName && !PRIVILEGED_ROLES.has(byName.role)) account = byName;
      }
      if (account?.active) {
        await tx
          .insert(authIdentities)
          .values({
            accountId: account.id,
            provider,
            subject: claims.sub,
            email: email && isEmailVerified(claims) ? email.slice(0, 254) : null,
          })
          .onConflictDoNothing();
      }
    }
    if (!account) return { ok: false, code: "unmatched", reason: "unmatched" };
    const party = { id: account.id, username: account.username, name: account.name };
    if (!account.active) return { ok: false, code: "inactive", reason: "inactive", account: party };
    const { token, ttlSeconds } = await createSession(c, tx, account.id, ip);
    await clearUserGuard(tx, account.username);
    await audit(tx, "auth.sso_login", party, party, { provider, ip });
    return { ok: true, token, ttlSeconds, account: party };
  });
}

type SsoTarget =
  | { kind: "oidc"; providerId: string; config: NonNullable<ReturnType<typeof getOidcConfig>> }
  | { kind: "feishu"; providerId: "feishu"; config: FeishuConfig };

function resolveSsoProvider(providerParam: string): SsoTarget | null {
  const oidc = getOidcConfig();
  if (oidc && oidc.providerId === providerParam) {
    return { kind: "oidc", providerId: oidc.providerId, config: oidc };
  }
  const feishu = getFeishuConfig();
  if (feishu && feishu.providerId === providerParam) {
    return { kind: "feishu", providerId: "feishu", config: feishu };
  }
  return null;
}

export const authRoutes = new Hono<Env>()
  // Enterprise SSO provider discovery: OIDC (AUTH_OIDC_*), Feishu (AUTH_FEISHU_*), plus legacy AUTH_SSO_*.
  .get("/auth/providers", (c) => c.json(providerList()))
  .post(
    "/login",
    async (c, next) => {
      if (!isPasswordLoginEnabled()) {
        return errorJson(c, 403, "密码登录已关闭，请使用企业单点登录", "AUTH_PASSWORD_DISABLED");
      }
      await next();
    },
    jsonBody(credentialsSchema, "请输入账户和密码"),
    async (c) => {
      const input = c.req.valid("json");
      const ip = getClientIp(c);
      const [account] = await db
        .select()
        .from(accounts)
        .where(eq(accounts.username, input.username));
      const lock = await findActiveLock(db, [userGuardKey(input.username), ipGuardKey(ip)]);
      if (lock) {
        await auditLoginFailure(account, input.username, ip, "locked");
        return lockedResponse(c, lock.lockedUntil);
      }
      const valid = account
        ? account.active && (await verifyPassword(input.password, account.hash))
        : (await verifyPassword(input.password, await getDummyHash())) && false;
      if (!valid) {
        await recordLoginFailure(db, input.username, ip);
        await auditLoginFailure(
          account,
          input.username,
          ip,
          account && !account.active ? "inactive" : "invalid_credentials",
        );
        return errorJson(c, 401, "账户或密码错误", "AUTH_INVALID_CREDENTIALS");
      }
      const party = { id: account!.id, username: account!.username, name: account!.name };
      const { token, ttlSeconds } = await db.transaction(async (tx) => {
        const created = await createSession(c, tx, party.id, ip);
        await clearUserGuard(tx, party.username);
        await audit(tx, "auth.login", party, party, { ip });
        return created;
      });
      setSessionCookie(c, token, ttlSeconds);
      // Opportunistic housekeeping of expired guard rows; never fails the login.
      void pruneLoginGuards(db).catch(() => undefined);
      return c.json({ ok: true });
    },
  )
  // ---------------------------------------------------------------------------
  // One-time activation links (public, IP rate-limited)
  // ---------------------------------------------------------------------------
  .get("/auth/invites/:token", async (c) => {
    const ip = getClientIp(c);
    const lock = await findActiveLock(db, [ipGuardKey(ip)]);
    if (lock) return lockedResponse(c, lock.lockedUntil);
    const token = c.req.param("token");
    if (!INVITE_TOKEN_RE.test(token)) {
      await recordIpFailure(db, ip);
      return errorJson(c, 404, "邀请链接无效", "AUTH_INVITE_INVALID");
    }
    const [invite] = await db
      .select(inviteFields)
      .from(accountInvites)
      .innerJoin(accounts, eq(accounts.id, accountInvites.accountId))
      .where(eq(accountInvites.tokenHash, digest(token)));
    const problem = inviteProblem(invite, new Date());
    if (problem) {
      if (problem.status === 404) await recordIpFailure(db, ip);
      return errorJson(c, problem.status, problem.message, problem.code);
    }
    const preview: InvitePreview = {
      username: invite!.username,
      name: invite!.name,
      expiresAt: invite!.expiresAt.toISOString(),
    };
    return c.json(preview);
  })
  .post(
    "/auth/invites/:token/accept",
    jsonBody(inviteAcceptSchema, "密码需为 10–256 位"),
    async (c) => {
      const ip = getClientIp(c);
      const lock = await findActiveLock(db, [ipGuardKey(ip)]);
      if (lock) return lockedResponse(c, lock.lockedUntil);
      const token = c.req.param("token");
      if (!INVITE_TOKEN_RE.test(token)) {
        await recordIpFailure(db, ip);
        return errorJson(c, 404, "邀请链接无效", "AUTH_INVITE_INVALID");
      }
      const { password } = c.req.valid("json");
      const hash = await hashPassword(password);
      const tokenHash = digest(token);
      return guarded(c, async () => {
        const result = await db.transaction(async (tx) => {
          await tx.execute(ADMIN_LOCK);
          const [invite] = await tx
            .select(inviteFields)
            .from(accountInvites)
            .innerJoin(accounts, eq(accounts.id, accountInvites.accountId))
            .where(eq(accountInvites.tokenHash, tokenHash))
            .for("update", { of: accountInvites });
          const problem = inviteProblem(invite, new Date());
          if (problem) return { problem };
          const row = invite!;
          await tx
            .update(accounts)
            .set({ hash, active: true })
            .where(eq(accounts.id, row.accountId));
          await tx
            .update(accountInvites)
            .set({ usedAt: new Date() })
            .where(eq(accountInvites.id, row.id));
          // Any other pending link for the same account becomes unusable.
          await tx
            .update(accountInvites)
            .set({ revokedAt: new Date() })
            .where(
              and(
                eq(accountInvites.accountId, row.accountId),
                ne(accountInvites.id, row.id),
                isNull(accountInvites.usedAt),
                isNull(accountInvites.revokedAt),
              ),
            );
          const removed = await tx
            .delete(sessions)
            .where(eq(sessions.account, row.accountId))
            .returning({ key: sessions.key });
          await clearUserGuard(tx, row.username);
          const party = { id: row.accountId, username: row.username, name: row.name };
          await audit(tx, "account.invite_accept", party, party, {
            ip,
            sessions: removed.length,
          });
          return { username: row.username };
        });
        if ("problem" in result && result.problem) {
          if (result.problem.status === 404) await recordIpFailure(db, ip);
          throw result.problem;
        }
        return c.json({ ok: true as const, username: (result as { username: string }).username });
      });
    },
  )
  // ---------------------------------------------------------------------------
  // Enterprise SSO (OIDC & Feishu OAuth v2, Authorization Code + PKCE S256).
  // All failures redirect to a fixed sso_error enum.
  // ---------------------------------------------------------------------------
  .get("/auth/sso/:provider/start", async (c) => {
    const target = resolveSsoProvider(c.req.param("provider"));
    if (!target) {
      return c.redirect(ssoErrorRedirect("provider_disabled"), 302);
    }
    try {
      const state = randomToken(32);
      const nonce = randomToken(32);
      const codeVerifier = createCodeVerifier();
      const codeChallenge = codeChallengeS256(codeVerifier);
      const authUrl =
        target.kind === "oidc"
          ? buildAuthorizationUrl(await getDiscovery(target.config), target.config, {
              state,
              nonce,
              codeChallenge,
            })
          : buildFeishuAuthorizeUrl(target.config, { state, codeChallenge });

      await db.delete(oidcStates).where(lt(oidcStates.expiresAt, new Date()));
      const stateHash = digest(state);
      await db.insert(oidcStates).values({
        stateHash,
        provider: target.providerId,
        codeVerifier,
        nonce,
        redirectTo: safeRedirectPath(c.req.query("redirect")),
        expiresAt: new Date(Date.now() + OIDC_STATE_TTL_SECONDS * 1000),
      });
      // Browser-continuity binding: callback must present the same digest(state) cookie.
      setCookie(c, oidcStateCookie(), stateHash, {
        httpOnly: true,
        sameSite: "Lax",
        secure: secureCookies(),
        path: OIDC_COOKIE_PATH,
        maxAge: OIDC_STATE_TTL_SECONDS,
      });
      return c.redirect(authUrl, 302);
    } catch {
      return c.redirect(ssoErrorRedirect("internal"), 302);
    }
  })
  .get("/auth/sso/:provider/callback", async (c) => {
    const target = resolveSsoProvider(c.req.param("provider"));
    const fail = (code: SsoErrorCode) => {
      deleteCookie(c, oidcStateCookie(), { path: OIDC_COOKIE_PATH });
      return c.redirect(ssoErrorRedirect(code), 302);
    };
    if (!target) return fail("provider_disabled");
    const state = c.req.query("state") ?? "";
    const stateOk = /^[A-Za-z0-9_-]{16,128}$/.test(state);
    const stateHash = stateOk ? digest(state) : "";
    const upstreamError = c.req.query("error");
    if (upstreamError) {
      // Burn the state row so it can never be replayed; upstream error text is never reflected.
      if (stateOk) await db.delete(oidcStates).where(eq(oidcStates.stateHash, stateHash));
      return fail(
        ["access_denied", "login_required", "consent_required", "interaction_required"].includes(
          upstreamError,
        )
          ? "cancelled"
          : "token_failed",
      );
    }
    const code = c.req.query("code") ?? "";
    const bound = getCookie(c, oidcStateCookie()) ?? "";
    if (!stateOk || !code || code.length > 4096 || !bound || !safeEqual(bound, stateHash)) {
      return fail("state_invalid");
    }
    const ip = getClientIp(c);
    try {
      // Atomic single-use consumption: a replayed or expired state never matches.
      const [row] = await db
        .delete(oidcStates)
        .where(
          and(
            eq(oidcStates.stateHash, stateHash),
            eq(oidcStates.provider, target.providerId),
            gt(oidcStates.expiresAt, new Date()),
          ),
        )
        .returning();
      if (!row) return fail("state_invalid");

      let outcome: SsoOutcome;
      let fallbackActorUsername = "unknown";

      if (target.kind === "oidc") {
        const discovery = await getDiscovery(target.config);
        const tokens = await exchangeCode(target.config, discovery, code, row.codeVerifier);
        const claims = await verifyIdTokenWithJwks(
          target.config,
          discovery,
          tokens.id_token!,
          row.nonce,
        );
        let profile: Partial<IdTokenClaims> & { sub: string } = claims;
        if (
          target.config.allowEmailLink &&
          !claims.email &&
          !claims.preferred_username &&
          tokens.access_token
        ) {
          const info = await fetchUserinfo(discovery, tokens.access_token, claims.sub).catch(
            () => null,
          );
          if (info) {
            profile = {
              ...claims,
              email: info.email,
              email_verified: info.email_verified,
              preferred_username: info.preferred_username,
            };
          }
        }
        fallbackActorUsername = String(profile.preferred_username ?? "unknown").slice(0, 80);
        outcome = await resolveSsoAccount(
          c,
          target.providerId,
          profile,
          target.config.allowEmailLink,
          ip,
        );
      } else {
        const identity = await verifyFeishuCode(target.config, code, row.codeVerifier);
        fallbackActorUsername = (identity.email ?? identity.name).slice(0, 80) || "unknown";
        outcome = await resolveFeishuAccount(c, target.config, identity, ip);
      }

      if (!outcome.ok) {
        const actor = outcome.account
          ? { id: null, username: outcome.account.username, name: outcome.account.name }
          : { id: null, username: fallbackActorUsername, name: "未知账户" };
        await audit(db, "auth.sso_failed", actor, outcome.account ?? null, {
          provider: target.providerId,
          ip,
          reason: outcome.reason,
        }).catch(() => undefined);
        return fail(outcome.code);
      }
      deleteCookie(c, oidcStateCookie(), { path: OIDC_COOKIE_PATH });
      setSessionCookie(c, outcome.token, outcome.ttlSeconds);
      return c.redirect(safeRedirectPath(row.redirectTo), 302);
    } catch (error) {
      if (error instanceof OidcError) {
        if (error.code === "tenant_forbidden" || error.code === "token_failed") {
          await audit(
            db,
            "auth.sso_failed",
            { id: null, username: "unknown", name: "未知账户" },
            null,
            { provider: target.providerId, ip, reason: error.code },
          ).catch(() => undefined);
        }
        return fail(toSsoErrorCode(error.code));
      }
      return fail("internal");
    }
  })
  .get("/me", async (c) => {
    const [row] = await db
      .select(profileFields)
      .from(accounts)
      .where(eq(accounts.id, c.get("actor").id));
    if (!row) return errorJson(c, 401, "请登录");
    const actor = c.get("actor");
    // Bearer callers see their effective (role ∩ token scopes) permissions, not the full role.
    const permissions =
      actor.authType === "bearer" ? actor.permissions : await getEffectivePermissions(row.role);
    return c.json({
      ...row,
      permissions,
      authType: actor.authType,
      actorSource: actor.actorSource,
    });
  })
  .patch("/me", jsonBody(profileInputSchema, "请检查显示名称、邮箱和公司"), async (c) => {
    const id = c.get("actor").id;
    const { name, email, company } = c.req.valid("json");
    const row = await db.transaction(async (tx) => {
      const [before] = await tx
        .select(profileFields)
        .from(accounts)
        .where(eq(accounts.id, id))
        .for("update");
      if (!before?.active) return null;
      const set: { name?: string; email?: string | null; company?: string | null } = {};
      if (name !== undefined && name !== before.name) set.name = name;
      if (email !== undefined && (email || null) !== before.email) {
        set.email = email || null;
      }
      if (company !== undefined && (company || null) !== before.company) {
        set.company = company || null;
      }
      const changed = Object.keys(set);
      if (!changed.length) return before;
      const [after] = await tx
        .update(accounts)
        .set(set)
        .where(eq(accounts.id, id))
        .returning(profileFields);
      // A name change keeps its before/after values. Email and company are logged by field name only.
      const detail: AuditDetail =
        set.name !== undefined ? { from: before.name, to: after!.name } : {};
      if (set.email !== undefined || set.company !== undefined) detail.fields = changed;
      await audit(tx, "profile.update", before, after!, detail, c.get("actor").actorSource);
      return after!;
    });
    if (!row) return errorJson(c, 404, "账户不存在");
    const permissions = await getEffectivePermissions(row.role);
    return c.json({ ...row, permissions });
  })
  .get("/me/sessions", requireCookieSession, async (c) => {
    const id = c.get("actor").id;
    const key = currentSessionKey(c);
    const rows = await db
      .select({
        id: sessions.id,
        key: sessions.key,
        createdAt: sessions.createdAt,
        expires: sessions.expires,
        userAgent: sessions.userAgent,
        ipAddress: sessions.ipAddress,
        lastSeenAt: sessions.lastSeenAt,
      })
      .from(sessions)
      .where(and(eq(sessions.account, id), gt(sessions.expires, new Date())))
      .orderBy(desc(sessions.createdAt), desc(sessions.id));

    const list: AccountSession[] = rows
      .map((row) => ({
        id: row.id,
        current: row.key === key,
        createdAt: row.createdAt.toISOString(),
        expiresAt: row.expires.toISOString(),
        userAgent: row.userAgent ?? null,
        ipAddress: row.ipAddress ?? null,
        lastSeenAt: row.lastSeenAt.toISOString(),
      }))
      .sort((a, b) => Number(b.current) - Number(a.current));

    return c.json(list);
  })
  .post("/me/sessions/revoke-others", requireCookieSession, async (c) => {
    const actor = c.get("actor");
    const key = currentSessionKey(c);
    const revoked = await db.transaction(async (tx) => {
      await tx
        .delete(sessions)
        .where(and(eq(sessions.account, actor.id), lt(sessions.expires, new Date())));
      const removed = await tx
        .delete(sessions)
        .where(and(eq(sessions.account, actor.id), ne(sessions.key, key)))
        .returning({ key: sessions.key });
      if (removed.length > 0) {
        await audit(tx, "profile.session_revoke", actor, actor, {
          sessions: removed.length,
        });
      }
      return removed.length;
    });
    return c.json({ ok: true, revoked });
  })
  .delete("/me/sessions/:id", requireCookieSession, async (c) => {
    const id = parsePositiveId(c.req.param("id"));
    if (!id) return errorJson(c, 400, "无效的会话编号");
    const actor = c.get("actor");
    const key = currentSessionKey(c);
    return guarded(c, async () => {
      await db.transaction(async (tx) => {
        const [target] = await tx
          .select({ id: sessions.id, key: sessions.key })
          .from(sessions)
          .where(
            and(
              eq(sessions.id, id),
              eq(sessions.account, actor.id),
              gt(sessions.expires, new Date()),
            ),
          )
          .for("update");
        if (!target) throw new Refusal(404, "会话不存在或已过期");
        if (target.key === key) {
          throw new Refusal(400, "当前会话请使用退出登录");
        }
        await tx.delete(sessions).where(and(eq(sessions.id, id), eq(sessions.account, actor.id)));
        await audit(tx, "profile.session_revoke", actor, actor, {
          sessions: 1,
        });
      });
      return c.json({ ok: true });
    });
  })
  .post(
    "/me/password",
    requireCookieSession,
    jsonBody(passwordChangeSchema, "新密码需为 10–256 位"),
    async (c) => {
      const input = c.req.valid("json");
      if (input.current === input.password) {
        return errorJson(c, 400, "新密码不能与当前密码相同");
      }
      const id = c.get("actor").id;
      const cookie = getCookieName();
      const key = currentSessionKey(c);
      const hash = await hashPassword(input.password);
      return guarded(c, async () => {
        const revoked = await db.transaction(async (tx) => {
          await tx.execute(ADMIN_LOCK);
          const [self] = await tx
            .select({
              id: accounts.id,
              username: accounts.username,
              name: accounts.name,
              hash: accounts.hash,
            })
            .from(accounts)
            .innerJoin(sessions, eq(sessions.account, accounts.id))
            .where(
              and(
                eq(accounts.id, id),
                eq(accounts.active, true),
                eq(sessions.key, key),
                gt(sessions.expires, new Date()),
              ),
            );
          if (!self) throw new Refusal(401, "请登录");
          // Wrong current password is intentionally NOT audited (verify-easm-settings.py contract).
          if (!(await verifyPassword(input.current, self.hash))) {
            throw new Refusal(400, "当前密码错误", "AUTH_PASSWORD_MISMATCH");
          }
          await tx.update(accounts).set({ hash }).where(eq(accounts.id, id));
          const removed = await tx
            .delete(sessions)
            .where(eq(sessions.account, id))
            .returning({ key: sessions.key });
          // A password change also revokes every active API token of this account.
          await tx
            .update(apiTokens)
            .set({ revokedAt: new Date() })
            .where(and(eq(apiTokens.accountId, id), isNull(apiTokens.revokedAt)));
          const party = { id: self.id, username: self.username, name: self.name };
          await audit(tx, "profile.password_change", party, party, {
            sessions: removed.length,
          });
          return removed.length;
        });
        deleteCookie(c, cookie, { path: "/" });
        return c.json({ ok: true, revoked });
      });
    },
  )
  .post("/logout", requireCookieSession, async (c) => {
    const cookie = getCookieName();
    // The session middleware already resolved the active account for this cookie.
    const actor = c.get("actor");
    const ip = getClientIp(c);
    await db.transaction(async (tx) => {
      const removed = await tx
        .delete(sessions)
        .where(eq(sessions.key, currentSessionKey(c)))
        .returning({ key: sessions.key });
      if (removed.length && actor) {
        await audit(tx, "auth.logout", actor, actor, { ip });
      }
    });
    deleteCookie(c, cookie, { path: "/" });
    return c.json({ ok: true });
  });
