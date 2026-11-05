import { createFileRoute } from "@tanstack/react-router";
import { AuditPage } from "@/features/audit/AuditPage";
import { parseAuditSearch } from "@/features/filters/search";
export const Route = createFileRoute("/audit")({
  validateSearch: parseAuditSearch,
  component: AuditPage,
});
