import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME_PREFERENCE,
  parseThemePreference,
  readThemePreference,
  resolveTheme,
  writeThemePreference,
} from "./theme-utils";

describe("theme utils", () => {
  it("defaults to light mode and falls back safely on corrupt values", () => {
    expect(DEFAULT_THEME_PREFERENCE).toBe("light");
    expect(parseThemePreference(null)).toBe("light");
    expect(parseThemePreference(undefined)).toBe("light");
    expect(parseThemePreference("")).toBe("light");
    expect(parseThemePreference("sepia")).toBe("light");
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("system")).toBe("system");
  });

  it("resolves theme explicitly or via system preference", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("system", true)).toBe("dark");
  });

  it("reads and writes storage safely", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
    };
    expect(readThemePreference(storage, "k")).toBe("light");
    store.set("k", "invalid");
    expect(readThemePreference(storage, "k")).toBe("light");
    writeThemePreference("dark", storage, "k");
    expect(readThemePreference(storage, "k")).toBe("dark");
  });
});
