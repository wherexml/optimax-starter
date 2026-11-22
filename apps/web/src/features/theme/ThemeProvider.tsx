import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { storageKey } from "@/config/app-config";
import {
  DEFAULT_THEME_PREFERENCE,
  readThemePreference,
  resolveTheme,
  writeThemePreference,
  type ResolvedTheme,
  type ThemePreference,
} from "./theme-utils";

const THEME_STORAGE_KEY = storageKey("theme");
const DARK_MEDIA_QUERY = "(prefers-color-scheme: dark)";

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (next: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readSystemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(DARK_MEDIA_QUERY).matches;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() =>
    readThemePreference(
      typeof window !== "undefined" ? window.localStorage : null,
      THEME_STORAGE_KEY,
    ),
  );
  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(
    readSystemPrefersDark,
  );

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const media = window.matchMedia(DARK_MEDIA_QUERY);
    const sync = () => setSystemPrefersDark(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  const resolved = resolveTheme(preference, systemPrefersDark);

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", resolved === "dark");
    root.style.colorScheme = resolved;
  }, [resolved]);

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    writeThemePreference(
      next,
      typeof window !== "undefined" ? window.localStorage : null,
      THEME_STORAGE_KEY,
    );
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    return {
      preference: DEFAULT_THEME_PREFERENCE,
      resolved: "light",
      setPreference: () => {},
    };
  }
  return ctx;
}
