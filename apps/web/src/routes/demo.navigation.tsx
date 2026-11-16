import { createFileRoute, redirect } from "@tanstack/react-router";
import { APP_CONFIG } from "@/config/app-config";
import { NavigationDemoPage } from "@/features/navigation-demo/NavigationDemoPage";
import { parseDemoSearch } from "@/features/navigation-demo/search";

export const Route = createFileRoute("/demo/navigation")({
  validateSearch: parseDemoSearch,
  beforeLoad: ({ search, location }) => {
    if (!APP_CONFIG.enableDemos) {
      throw redirect({ to: "/", replace: true });
    }
    if (location.searchStr !== `?tab=${search.tab}`) {
      throw redirect({ to: "/demo/navigation", search, replace: true });
    }
  },
  component: NavigationDemoPage,
});
