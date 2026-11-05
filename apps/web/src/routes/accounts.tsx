import { createFileRoute } from "@tanstack/react-router";
import { AccountsPage } from "@/features/accounts/AccountsPage";
import { parseAccountSearch } from "@/features/filters/search";
export const Route = createFileRoute("/accounts")({
  validateSearch: parseAccountSearch,
  component: AccountsPage,
});
