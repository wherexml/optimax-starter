export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const DEFAULT_THEME_PREFERENCE: ThemePreference = "light";

export function parseThemePreference(raw: unknown): ThemePreference {
  if (raw === "dark" || raw === "system" || raw === "light") {
    return raw;
  }
  return DEFAULT_THEME_PREFERENCE;
}

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === "dark") return "dark";
  if (preference === "light") return "light";
  return systemPrefersDark ? "dark" : "light";
}

export function readThemePreference(
  storage: Pick<Storage, "getItem"> | null | undefined,
  key: string,
): ThemePreference {
  try {
    return parseThemePreference(storage?.getItem(key));
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
}

export function writeThemePreference(
  preference: ThemePreference,
  storage: Pick<Storage, "setItem"> | null | undefined,
  key: string,
): void {
  try {
    storage?.setItem(key, preference);
  } catch {
    // 存储不可用时仅在本次页面会话内生效。
  }
}
