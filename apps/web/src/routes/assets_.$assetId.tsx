import { createFileRoute } from "@tanstack/react-router";
import { AssetDetailPage } from "@/features/assets/AssetDetailPage";
import { parseAssetSearch } from "@/features/filters/search";

export const Route = createFileRoute("/assets_/$assetId")({
  validateSearch: parseAssetSearch,
  component: AssetDetailPage,
});
