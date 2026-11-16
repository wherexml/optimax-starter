export type FormsDemoDialogMode = "create" | "edit";

export interface FormsDemoSearch {
  dialog?: FormsDemoDialogMode;
}

export function parseFormsDemoSearch(
  raw: Record<string, unknown>,
): FormsDemoSearch {
  if (raw.dialog === "create" || raw.dialog === "edit") {
    return { dialog: raw.dialog };
  }
  return {};
}
