export type ThemeMode = "system" | "light" | "dark";

export const THEME_STORAGE_KEY = "landalert_theme";

/**
 * Returns the currently stored theme preference, defaulting to "system".
 */
export function getStoredTheme(): ThemeMode {
  if (typeof window === "undefined") return "system";
  try {
    const val = localStorage.getItem(THEME_STORAGE_KEY);
    if (val === "light" || val === "dark" || val === "system") {
      return val;
    }
  } catch {
    // Ignore storage errors
  }
  return "system";
}

/**
 * Applies the given theme to the document root element.
 */
export function applyTheme(mode: ThemeMode): void {
  if (typeof document === "undefined") return;

  const isDark =
    mode === "dark" ||
    (mode === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  const root = document.documentElement;
  if (isDark) {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

/**
 * Updates theme preference in localStorage and applies it to the DOM.
 */
export function setTheme(mode: ThemeMode): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Ignore storage errors
  }
  applyTheme(mode);
}

/**
 * Registers an OS color-scheme listener to automatically adapt in system mode.
 */
export function initThemeListener(onChange?: (activeDark: boolean) => void): () => void {
  if (typeof window === "undefined") return () => {};

  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const listener = (e: MediaQueryListEvent) => {
    const current = getStoredTheme();
    if (current === "system") {
      applyTheme("system");
      onChange?.(e.matches);
    }
  };

  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}
