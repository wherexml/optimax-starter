import { useNavigate } from "@tanstack/react-router";
import { ArrowUpRight } from "lucide-react";
import { stepDownAssistantWidth } from "./AssistantDrawer";
import type { EntityLinkTarget } from "./assistant-links-utils";

export function EntityRefChip({
  target,
  compact,
  onAfterNavigate,
}: {
  target: EntityLinkTarget;
  compact?: boolean;
  onAfterNavigate?: () => void;
}) {
  const navigate = useNavigate();

  function openTarget() {
    stepDownAssistantWidth();
    void navigate({ to: target.to as never, search: (target.search ?? {}) as never });
    onAfterNavigate?.();
  }

  return (
    <button
      type="button"
      className="pi-entity-chip"
      data-compact={compact || undefined}
      title={target.label ?? `跳转到 ${target.code}`}
      aria-label={target.label ?? `打开 ${target.code}`}
      onClick={openTarget}
    >
      <span>{target.code}</span>
      <ArrowUpRight size={11} aria-hidden="true" />
    </button>
  );
}
