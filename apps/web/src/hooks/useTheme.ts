import { useEffect, useSyncExternalStore } from "react";

const DARK_QUERY = "(prefers-color-scheme: dark)";

const subscribe = (listener: () => void) => {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
};

const prefersDark = () => window.matchMedia(DARK_QUERY).matches;

/**
 * Follows the system's light or dark appearance, with no setting of its own.
 * `index.html` sets the class before the first paint; this keeps it current.
 */
export function useSystemTheme(): "light" | "dark" {
  const dark = useSyncExternalStore(subscribe, prefersDark);
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  }, [dark]);
  return dark ? "dark" : "light";
}
