import {
  pgTable,
  serial,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const accounts = pgTable("console_account", {
  id: serial().primaryKey(),
  username: text().notNull().unique(),
  name: text().notNull(),
  role: text().notNull(),
  active: boolean().default(true).notNull(),
  hash: text().notNull(),
  // Optional profile fields edited by the account itself; nullable, so existing rows need no backfill.
  email: text(),
  company: text(),
});
export const sessions = pgTable("console_session", {
  id: serial("id").notNull(),
  key: text().primaryKey(),
  account: integer()
    .notNull()
    .references(() => accounts.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expires: timestamp().notNull(),
  userAgent: text("user_agent"),
  // Client IP at login, refreshed (throttled to once per 60s) by the session middleware.
  ipAddress: text("ip_address"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
});

// Append-only operation log. The API only inserts rows, inside the same transaction as the state change.
// Actor and target names are copied at write time, so the log still shows them after later renames.
export const audits = pgTable("console_audit", {
  id: serial().primaryKey(),
  at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  action: text().notNull(),
  actorSource: text("actor_source").default("human").notNull(),
  actorId: integer("actor_id").references(() => accounts.id),
  actorUsername: text("actor_username").notNull(),
  actorName: text("actor_name").notNull(),
  targetId: integer("target_id").references(() => accounts.id),
  targetUsername: text("target_username"),
  targetName: text("target_name"),
  detail: jsonb().$type<Record<string, unknown>>().default({}).notNull(),
});

export const rolePermissions = pgTable("console_role_permission", {
  role: text().primaryKey(),
  permissions: jsonb().$type<string[]>().default([]).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  updatedBy: integer("updated_by").references(() => accounts.id, { onDelete: "set null" }),
});

export const systemSettings = pgTable("console_setting", {
  key: text().primaryKey(),
  value: text().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  updatedBy: integer("updated_by").references(() => accounts.id, { onDelete: "set null" }),
});

// PostgreSQL-backed login rate limiting buckets: `user:<lowerUsername>` and `ip:<clientIp>`.
// Only counters and timestamps are stored; never passwords, hashes or tokens.
export const loginGuards = pgTable("console_login_guard", {
  key: text().primaryKey(),
  failures: integer().default(0).notNull(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// One-time account activation links. Only the SHA-256 digest of the token is stored.
export const accountInvites = pgTable("console_account_invite", {
  id: serial().primaryKey(),
  tokenHash: text("token_hash").notNull().unique(),
  accountId: integer("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  createdBy: integer("created_by").references(() => accounts.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// External identity links (OIDC `sub` per provider) to existing console accounts.
export const authIdentities = pgTable(
  "console_auth_identity",
  {
    id: serial().primaryKey(),
    accountId: integer("account_id")
      .notNull()
      .references(() => accounts.id, { onDelete: "cascade" }),
    provider: text().notNull(),
    subject: text().notNull(),
    email: text(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("console_auth_identity_provider_subject_idx").on(t.provider, t.subject)],
);

// Short-lived OIDC authorization state (10 min). Rows are consumed exactly once by the callback.
export const oidcStates = pgTable("console_oidc_state", {
  stateHash: text("state_hash").primaryKey(),
  provider: text().notNull(),
  codeVerifier: text("code_verifier").notNull(),
  nonce: text().notNull(),
  redirectTo: text("redirect_to").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// File attachments. Bytes live in the storage driver (local dir or S3); only metadata is stored here.
// entity_type: "asset" (user uploads) | "job" (generated artifacts such as async CSV exports).
export const attachments = pgTable(
  "console_attachment",
  {
    id: serial().primaryKey(),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
    storageDriver: text("storage_driver").notNull(),
    storageKey: text("storage_key").notNull().unique(),
    originalName: text("original_name").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text().notNull(),
    uploadedBy: integer("uploaded_by").references(() => accounts.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("console_attachment_entity_idx").on(t.entityType, t.entityId)],
);

// Lightweight PostgreSQL job queue, claimed with FOR UPDATE SKIP LOCKED by the API worker loop.
export const jobs = pgTable("console_job", {
  id: serial().primaryKey(),
  type: text().notNull(),
  status: text().default("pending").notNull(),
  payload: jsonb().$type<Record<string, unknown>>().default({}).notNull(),
  result: jsonb().$type<Record<string, unknown>>(),
  error: text(),
  progress: integer().default(0).notNull(),
  attempts: integer().default(0).notNull(),
  maxAttempts: integer("max_attempts").default(3).notNull(),
  runAfter: timestamp("run_after", { withTimezone: true }).defaultNow().notNull(),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdBy: integer("created_by").references(() => accounts.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// Personal API tokens (Bearer). Only the SHA-256 digest is stored; effective permissions are the
// live role permissions intersected with `scopes` on every request.
export const apiTokens = pgTable("console_api_token", {
  id: serial().primaryKey(),
  accountId: integer("account_id")
    .notNull()
    .references(() => accounts.id, { onDelete: "cascade" }),
  name: text().notNull(),
  prefix: text().notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  scopes: jsonb().$type<string[]>().default([]).notNull(),
  actorSource: text("actor_source").default("agent").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  lastUsedIp: text("last_used_ip"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdBy: integer("created_by").references(() => accounts.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});
