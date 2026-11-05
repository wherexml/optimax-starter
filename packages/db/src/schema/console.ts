import {
  pgTable,
  serial,
  text,
  boolean,
  integer,
  timestamp,
  jsonb,
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
  key: text().primaryKey(),
  account: integer()
    .notNull()
    .references(() => accounts.id),
  expires: timestamp().notNull(),
});
export const assets = pgTable("console_asset", {
  id: serial().primaryKey(),
  name: text().notNull().unique(),
  domain: text().notNull(),
  owner: text().notNull(),
  stage: text().notNull(),
});

// Append-only operation log. The API only inserts rows, inside the same transaction as the account change.
// Actor and target names are copied at write time, so the log still shows them after later renames.
export const audits = pgTable("console_audit", {
  id: serial().primaryKey(),
  at: timestamp("at", { withTimezone: true }).defaultNow().notNull(),
  action: text().notNull(),
  actorId: integer("actor_id").references(() => accounts.id),
  actorUsername: text("actor_username").notNull(),
  actorName: text("actor_name").notNull(),
  targetId: integer("target_id").references(() => accounts.id),
  targetUsername: text("target_username"),
  targetName: text("target_name"),
  detail: jsonb().$type<Record<string, unknown>>().default({}).notNull(),
});
