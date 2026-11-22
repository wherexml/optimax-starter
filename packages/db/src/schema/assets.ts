// Example business table for the "assets" module. `scripts/lib/strip-example.mjs` deletes this file.
import { pgTable, serial, text } from "drizzle-orm/pg-core";

export const assets = pgTable("console_asset", {
  id: serial().primaryKey(),
  name: text().notNull().unique(),
  domain: text().notNull(),
  owner: text().notNull(),
  stage: text().notNull(),
});
