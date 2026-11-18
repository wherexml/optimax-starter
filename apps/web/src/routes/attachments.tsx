import { createFileRoute } from "@tanstack/react-router";
import { AttachmentsPage } from "@/features/attachments/AttachmentsPage";

export const Route = createFileRoute("/attachments")({
  component: AttachmentsPage,
});
