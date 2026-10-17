import { type RefObject, useEffect, useRef } from "react";

/**
 * Closes a popover while it is open: when a press lands outside the element
 * the returned ref is on, and on Escape when `closeOnEscape` is set. Used by
 * the sidebars' menus (the inbox's project scope, the tree's Sidebar
 * options).
 */
export function useDismissOnOutsidePointer(
  open: boolean,
  onDismiss: () => void,
  options: { readonly closeOnEscape?: boolean } = {},
): RefObject<HTMLDivElement | null> {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const closeOnEscape = options.closeOnEscape === true;
  useEffect(() => {
    if (!open) return;
    const listening = new AbortController();
    window.addEventListener(
      "pointerdown",
      (event) => {
        if (!rootRef.current?.contains(event.target as Node)) dismissRef.current();
      },
      { signal: listening.signal },
    );
    if (closeOnEscape) {
      window.addEventListener(
        "keydown",
        (event) => {
          if (event.key === "Escape") dismissRef.current();
        },
        { signal: listening.signal },
      );
    }
    return () => listening.abort();
  }, [open, closeOnEscape]);
  return rootRef;
}
