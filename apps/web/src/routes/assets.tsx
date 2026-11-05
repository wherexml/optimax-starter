import { createFileRoute } from "@tanstack/react-router";
import { AssetsPage } from "@/features/assets/AssetsPage";
import { parseAssetSearch } from "@/features/filters/search";
export const Route = createFileRoute("/assets")({
  validateSearch: parseAssetSearch,
  component: AssetsPage,
});
