import { createFileRoute, redirect } from "@tanstack/react-router";
import { SystemPage } from "@/features/system/SystemPage";
import { parseSystemSearch } from "@/features/system/search";

export const Route = createFileRoute("/system")({
  validateSearch: parseSystemSearch,
  beforeLoad: ({ search, location }) => {
    if (location.searchStr !== `?tab=${search.tab}`) {
      throw redirect({ to: "/system", search, replace: true });
    }
  },
  component: SystemPage,
});
