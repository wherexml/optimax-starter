import { createFileRoute, redirect } from "@tanstack/react-router";
import { APP_CONFIG } from "@/config/app-config";
import { FormsDemoPage } from "@/features/forms-demo/FormsDemoPage";
import { parseFormsDemoSearch } from "@/features/forms-demo/search";

export const Route = createFileRoute("/demo/forms")({
  validateSearch: parseFormsDemoSearch,
  beforeLoad: () => {
    if (!APP_CONFIG.enableDemos) {
      throw redirect({ to: "/", replace: true });
    }
  },
  component: FormsDemoPage,
});
