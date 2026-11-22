export const LOCKED_COLUMN_IDS = new Set(["select", "action", "actions"]);

export function isLockedColumn(id: string): boolean {
  return LOCKED_COLUMN_IDS.has(id);
}

/**
 * Reorders movable columns while keeping selection ("select") pinned first
 * and action ("action" / "actions") columns pinned last.
 */
export function reorderColumns(
  order: readonly string[],
  activeId: string,
  overId: string | null | undefined,
): string[] {
  if (!overId || activeId === overId) return [...order];
  if (isLockedColumn(activeId) || isLockedColumn(overId)) return [...order];

  const leading = order.filter((id) => id === "select");
  const trailing = order.filter((id) => id === "action" || id === "actions");
  const middle = order.filter((id) => !isLockedColumn(id));

  const oldIndex = middle.indexOf(activeId);
  const newIndex = middle.indexOf(overId);
  if (oldIndex === -1 || newIndex === -1) return [...order];

  const moved = [...middle];
  const [item] = moved.splice(oldIndex, 1);
  if (item === undefined) return [...order];
  moved.splice(newIndex, 0, item);

  return [...leading, ...moved, ...trailing];
}

export function hasVisibleDataColumn(
  prefs: Record<string, { visible: boolean }>,
): boolean {
  return Object.entries(prefs).some(
    ([id, cfg]) => !isLockedColumn(id) && cfg.visible,
  );
}
