import { describe, expect, it } from "vitest";
import {
  LOCKED_COLUMN_IDS,
  hasVisibleDataColumn,
  isLockedColumn,
  reorderColumns,
} from "./column-settings-utils";

describe("column settings utils", () => {
  it("identifies locked selection and action columns", () => {
    expect(LOCKED_COLUMN_IDS.has("select")).toBe(true);
    expect(LOCKED_COLUMN_IDS.has("action")).toBe(true);
    expect(LOCKED_COLUMN_IDS.has("actions")).toBe(true);

    expect(isLockedColumn("select")).toBe(true);
    expect(isLockedColumn("action")).toBe(true);
    expect(isLockedColumn("actions")).toBe(true);
    expect(isLockedColumn("name")).toBe(false);
    expect(isLockedColumn("domain")).toBe(false);
  });

  it("refuses dragging locked columns and preserves boundary positions", () => {
    const order = ["select", "id", "name", "domain", "action"];
    expect(reorderColumns(order, "action", "name")).toEqual(order);
    expect(reorderColumns(order, "select", "name")).toEqual(order);
    expect(reorderColumns(order, "name", "action")).toEqual(order);
    expect(reorderColumns(order, "name", "select")).toEqual(order);

    expect(reorderColumns(order, "domain", "id")).toEqual([
      "select",
      "domain",
      "id",
      "name",
      "action",
    ]);

    // Even if input order has action/select misplaced, boundary pinning normalizes them.
    expect(reorderColumns(["id", "action", "name", "select"], "name", "id")).toEqual([
      "select",
      "name",
      "id",
      "action",
    ]);
  });

  it("requires at least one non-locked data column to remain visible", () => {
    expect(
      hasVisibleDataColumn({
        select: { visible: true },
        name: { visible: false },
        domain: { visible: false },
        action: { visible: true },
      }),
    ).toBe(false);

    expect(
      hasVisibleDataColumn({
        select: { visible: true },
        name: { visible: true },
        domain: { visible: false },
        action: { visible: true },
      }),
    ).toBe(true);
  });
});
