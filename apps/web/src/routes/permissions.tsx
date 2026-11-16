import { createFileRoute } from "@tanstack/react-router";
import { PermissionsPage } from "@/features/permissions/PermissionsPage";

export const Route = createFileRoute("/permissions")({
  component: PermissionsPage,
});
