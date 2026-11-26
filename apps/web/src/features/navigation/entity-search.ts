// @starter:example-assets-start
import { request } from "@/console-client";
// @starter:example-assets-end

export interface EntitySearchResult {
  id: string;
  code: string;
  title: string;
  subtitle?: string;
  to: string;
  search?: Record<string, unknown>;
}

export type EntitySearchProvider = (
  query: string,
  signal?: AbortSignal,
) => Promise<EntitySearchResult[]>;

// @starter:example-assets-start
function formatAssetCode(id: number): string {
  return id < 1000 ? `AS-${String(id).padStart(3, "0")}` : `AS-${id}`;
}

const searchExampleAssets: EntitySearchProvider = async (query, signal) => {
  const trimmed = query.trim();
  const isCodeQuery = /^AS-?\d*$/i.test(trimmed) || /^\d+$/.test(trimmed);
  const qs = new URLSearchParams({ page: "1", size: "8", sortBy: "id", sortDir: "asc" });
  if (trimmed) {
    qs.set(isCodeQuery ? "code" : "q", trimmed);
  }
  const res = await request<{
    items: Array<{ id: number; name: string; domain: string; owner: string; stage: string }>;
  }>(`/assets/page?${qs.toString()}`, "GET", undefined, { signal });
  return res.items.map((row) => ({
    id: `asset-${row.id}`,
    code: formatAssetCode(row.id),
    title: row.name,
    subtitle: `${row.domain} / ${row.stage}`,
    to: `/assets/${row.id}`,
  }));
};
// @starter:example-assets-end

const ENTITY_SEARCH_PROVIDERS: EntitySearchProvider[] = [
  // @starter:example-assets-start
  searchExampleAssets,
  // @starter:example-assets-end
  // @starter:entity-search-providers
];

export function hasEntitySearchProviders(): boolean {
  return ENTITY_SEARCH_PROVIDERS.length > 0;
}

export async function searchConsoleEntities(
  query: string,
  signal?: AbortSignal,
): Promise<EntitySearchResult[]> {
  if (ENTITY_SEARCH_PROVIDERS.length === 0) return [];
  const lists = await Promise.all(
    ENTITY_SEARCH_PROVIDERS.map((provider) => provider(query, signal).catch(() => [])),
  );
  const seen = new Set<string>();
  const deduped: EntitySearchResult[] = [];
  for (const item of lists.flat()) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    deduped.push(item);
    if (deduped.length >= 12) break;
  }
  return deduped;
}
