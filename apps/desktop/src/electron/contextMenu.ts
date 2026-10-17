import type { ContextMenuItem, ContextMenuPosition } from "@playstead/contracts/ipc";
import { type BrowserWindow, Menu, nativeImage, type NativeImage } from "electron";

/**
 * The window's context menus as native menus (T3 Code's
 * `apps/desktop/src/electron/ElectronMenu.ts` `showContextMenu` at 2577baf).
 * Headers are left out, since a native menu has no such row. A separator
 * comes before an item that asks for one, and before the first destructive
 * item of a section; on macOS a destructive item carries the trash symbol.
 * It resolves with the chosen item's id, or null when the menu closes
 * without a choice.
 */
export const showNativeContextMenu = (input: {
  readonly window: BrowserWindow;
  readonly items: ReadonlyArray<ContextMenuItem>;
  readonly position: ContextMenuPosition | undefined;
}): Promise<string | null> =>
  new Promise((resolve) => {
    let settled = false;
    const complete = (id: string | null) => {
      if (settled) return;
      settled = true;
      resolve(id);
    };
    const template = buildTemplate(input.items, complete);
    if (template.length === 0) {
      complete(null);
      return;
    }
    // The window sends CSS pixels; the menu is placed in window points.
    const zoom = input.window.webContents.getZoomFactor();
    const position =
      input.position !== undefined &&
      Number.isFinite(input.position.x) &&
      Number.isFinite(input.position.y) &&
      input.position.x >= 0 &&
      input.position.y >= 0
        ? { x: Math.floor(input.position.x * zoom), y: Math.floor(input.position.y * zoom) }
        : {};
    Menu.buildFromTemplate(template).popup({
      window: input.window,
      ...position,
      // Called when the menu closes, after a chosen item's click.
      callback: () => complete(null),
    });
  });

let trashIcon: NativeImage | null | undefined;
const destructiveIcon = (): NativeImage | undefined => {
  if (process.platform !== "darwin") return undefined;
  if (trashIcon === undefined) {
    try {
      const icon = nativeImage.createFromNamedImage("trash").resize({ width: 12, height: 12 });
      icon.setTemplateImage(true);
      trashIcon = icon.isEmpty() ? null : icon;
    } catch {
      trashIcon = null;
    }
  }
  return trashIcon ?? undefined;
};

function buildTemplate(
  items: ReadonlyArray<ContextMenuItem>,
  complete: (id: string) => void,
): Array<Electron.MenuItemConstructorOptions> {
  const template: Array<Electron.MenuItemConstructorOptions> = [];
  const separate = () => {
    if (template.length > 0 && template.at(-1)?.type !== "separator") {
      template.push({ type: "separator" });
    }
  };
  let separatedForDestructive = false;
  let sectionStartedBySeparator = false;
  for (const item of items) {
    if (item.header === true) continue;
    const children =
      item.children === undefined ? undefined : buildTemplate(item.children, complete);
    if (children !== undefined && children.length === 0) continue;
    if (item.separatorBefore === true) {
      separate();
      sectionStartedBySeparator = true;
    }
    if (item.destructive === true && !separatedForDestructive && !sectionStartedBySeparator) {
      separate();
      separatedForDestructive = true;
    }
    const icon =
      item.destructive === true && children === undefined ? destructiveIcon() : undefined;
    template.push({
      label: item.label,
      enabled: item.disabled !== true,
      ...(typeof item.checked === "boolean" ? { type: "checkbox", checked: item.checked } : {}),
      ...(children === undefined ? { click: () => complete(item.id) } : { submenu: children }),
      ...(icon === undefined ? {} : { icon }),
    });
  }
  return template;
}
