// Shared asset filter/sort builder for GET /console/assets/page and the assets.export_csv job.
import { and, asc, desc, eq, ilike, inArray, type SQL } from "drizzle-orm";
import type { AssetSortField } from "@optimax-starter/api";
import { assets } from "@optimax-starter/db/schema/assets";
import { containsPattern } from "../core/audit";

export type AssetFilter = {
  q?: string;
  qOp?: "contains" | "equals";
  stages?: readonly string[];
  domains?: readonly string[];
  owners?: readonly string[];
};

export function buildAssetWhere(filter: AssetFilter): SQL | undefined {
  const { q, qOp, stages, domains, owners } = filter;
  return and(
    q ? (qOp === "equals" ? eq(assets.name, q) : ilike(assets.name, containsPattern(q))) : undefined,
    stages?.length ? inArray(assets.stage, [...stages]) : undefined,
    domains?.length ? inArray(assets.domain, [...domains]) : undefined,
    owners?.length ? inArray(assets.owner, [...owners]) : undefined,
  );
}

const SORT_COLUMNS = {
  id: assets.id,
  name: assets.name,
  domain: assets.domain,
  owner: assets.owner,
  stage: assets.stage,
} as const;

/** Primary sort plus a stable `id` tie-breaker so offset pagination never repeats/skips rows. */
export function buildAssetOrder(sortBy: AssetSortField = "id", sortDir: "asc" | "desc" = "desc"): SQL[] {
  const dir = sortDir === "asc" ? asc : desc;
  const primary = dir(SORT_COLUMNS[sortBy] ?? assets.id);
  return sortBy === "id" ? [primary] : [primary, dir(assets.id)];
}
