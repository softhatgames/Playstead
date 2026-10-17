import type { ContextMenuItem, ContextMenuPosition } from "@playstead/contracts/ipc";

/**
 * A context menu drawn by the interface, for a browser, where there is no
 * native one (T3 Code's `apps/web/src/contextMenuFallback.ts` at 2577baf).
 * It opens at the pointer, kept inside the window, with submenus beside
 * their item. Escape, a click outside or another menu closes it; it then
 * resolves with null. Only one is open at a time.
 */

const PANEL_CLASS =
  "fixed z-[10000] min-w-40 max-w-sm overflow-y-auto rounded-lg border border-neutral-200 bg-white p-1 text-sm text-neutral-900 shadow-lg dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-100";
const ROW_CLASS =
  "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left outline-none disabled:cursor-not-allowed disabled:opacity-50";
const ROW_TONE = {
  neutral:
    "hover:bg-neutral-100 focus:bg-neutral-100 dark:hover:bg-neutral-800 dark:focus:bg-neutral-800",
  destructive:
    "text-red-600 hover:bg-red-50 focus:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40 dark:focus:bg-red-950/40",
} as const;

let dismissActive: (() => void) | null = null;

/** Closes the open menu, if any, as if dismissed. */
export function dismissContextMenu(): void {
  dismissActive?.();
}

const placeWithinWindow = (panel: HTMLElement, left: number, top: number) => {
  const rect = panel.getBoundingClientRect();
  panel.style.left = `${Math.min(Math.max(4, left), Math.max(4, window.innerWidth - rect.width - 4))}px`;
  panel.style.top = `${Math.min(Math.max(4, top), Math.max(4, window.innerHeight - rect.height - 4))}px`;
};

export function showContextMenuFallback<T extends string>(
  items: ReadonlyArray<ContextMenuItem<T>>,
  position?: ContextMenuPosition,
): Promise<T | null> {
  dismissContextMenu();
  return new Promise<T | null>((resolve) => {
    const restoreFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const panels: Array<HTMLDivElement> = [];
    let done = false;
    // The pointer press that opened the menu must not close it.
    let armed = false;

    const finish = (result: T | null) => {
      if (done) return;
      done = true;
      if (dismissActive === dismiss) dismissActive = null;
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("contextmenu", onContextMenu, true);
      const hadFocus = panels.some((panel) => panel.contains(document.activeElement));
      for (const panel of panels) panel.remove();
      if (hadFocus && restoreFocus?.isConnected) restoreFocus.focus({ preventScroll: true });
      resolve(result);
    };
    const dismiss = () => finish(null);
    const inside = (target: EventTarget | null) =>
      target instanceof Node && panels.some((panel) => panel.contains(target));
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        dismiss();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      if (armed && !inside(event.target)) dismiss();
    };
    const onContextMenu = (event: MouseEvent) => {
      if (armed && !inside(event.target)) dismiss();
    };

    const closeFrom = (level: number) => {
      while (panels.length > level) panels.pop()?.remove();
    };

    const open = (
      entries: ReadonlyArray<ContextMenuItem<T>>,
      left: number,
      top: number,
      level: number,
    ) => {
      closeFrom(level);
      const panel = document.createElement("div");
      panel.className = PANEL_CLASS;
      panel.setAttribute("role", "menu");
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      for (const item of entries) {
        if (item.separatorBefore === true && panel.childElementCount > 0) {
          const separator = document.createElement("div");
          separator.setAttribute("role", "separator");
          separator.className = "mx-2 my-1 h-px bg-neutral-200 dark:bg-neutral-800";
          panel.appendChild(separator);
        }
        if (item.header === true) {
          const header = document.createElement("div");
          header.className =
            "px-2 py-1.5 text-xs font-medium text-neutral-500 dark:text-neutral-400";
          header.textContent = item.label;
          panel.appendChild(header);
          continue;
        }
        const submenu =
          item.children !== undefined && item.children.length > 0 ? item.children : null;
        const row = document.createElement("button");
        row.type = "button";
        row.disabled = item.disabled === true;
        row.className = `${ROW_CLASS} ${item.destructive === true && submenu === null ? ROW_TONE.destructive : ROW_TONE.neutral}`;
        if (typeof item.checked === "boolean") {
          row.setAttribute("role", "menuitemradio");
          row.setAttribute("aria-checked", String(item.checked));
        } else {
          row.setAttribute("role", "menuitem");
        }
        const label = document.createElement("span");
        label.className = "min-w-0 flex-1 truncate";
        label.textContent =
          typeof item.checked === "boolean" && item.checked ? `✓ ${item.label}` : item.label;
        row.appendChild(label);
        if (submenu !== null) {
          row.setAttribute("aria-haspopup", "menu");
          const chevron = document.createElement("span");
          chevron.setAttribute("aria-hidden", "true");
          chevron.textContent = "›";
          row.appendChild(chevron);
          const openSubmenu = () => {
            const rect = row.getBoundingClientRect();
            open(submenu, rect.right + 4, rect.top, level + 1);
          };
          row.addEventListener("mouseenter", openSubmenu);
          row.addEventListener("click", openSubmenu);
        } else {
          row.addEventListener("mouseenter", () => closeFrom(level + 1));
          row.addEventListener("click", () => finish(item.id));
        }
        panel.appendChild(row);
      }
      document.body.appendChild(panel);
      panels[level] = panel;
      placeWithinWindow(panel, left, top);
    };

    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("contextmenu", onContextMenu, true);
    open(items, position?.x ?? 0, position?.y ?? 0, 0);
    dismissActive = dismiss;
    requestAnimationFrame(() => {
      armed = true;
    });
  });
}
