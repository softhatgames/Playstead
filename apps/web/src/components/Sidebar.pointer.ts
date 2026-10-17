import type { SensorProps } from "@dnd-kit/core";
import { getOwnerDocument, getWindow } from "@dnd-kit/utilities";
import { type PointerEvent as ReactPointerEvent, useLayoutEffect } from "react";

/**
 * How a press on an inbox row turns into a drag. The behaviour follows T3
 * Code's sidebar sensor (`apps/web/src/components/Sidebar.pointer.ts` at
 * 2577baf):
 *
 * - A press becomes a drag only once it travels past `distance` pixels, so a
 *   plain click still opens the thread.
 * - While dragging, text selection is cleared, and the click that ends the
 *   drag is swallowed.
 * - Escape, the pointer being cancelled, the window losing focus, the page
 *   hiding or the window resizing all cancel it. After a cancel the release
 *   may come much later, or outside the page, so the next click is swallowed
 *   too, until the next press.
 *
 * The same sensor drives the press-and-drag **Settle** sweep.
 */

/** Cancels a drag when the list that owns it unmounts (search replacing the list, #41). */
export function SidebarDragLifecycle({ onUnmount }: { readonly onUnmount: () => void }) {
  useLayoutEffect(() => onUnmount, [onUnmount]);
  return null;
}

export interface SidebarPointerSensorOptions {
  readonly distance: number;
  /** Called with each sensor as it starts listening, so the sidebar can cancel it. */
  readonly onAttach: (sensor: SidebarPointerSensor) => void;
  /** Called once when the gesture ends; `started` tells whether it became a drag. */
  readonly onFinish: (started: boolean) => void;
}

type SensorInput = Omit<SensorProps<SidebarPointerSensorOptions>, "activeNode" | "context">;
type Point = { readonly x: number; readonly y: number };

const PRIMARY_BUTTON = 1;
const pointOf = (event: { clientX: number; clientY: number }): Point => ({
  x: event.clientX,
  y: event.clientY,
});

/**
 * Swallows the next click in `document` until another press starts. Rows
 * are links, so the swallowed click also stops the browser following one.
 */
function swallowNextClick(document: Document) {
  const listening = new AbortController();
  const options = { capture: true, signal: listening.signal };
  document.addEventListener(
    "click",
    (event) => {
      event.stopPropagation();
      event.preventDefault();
      listening.abort();
    },
    options,
  );
  document.addEventListener("pointerdown", () => listening.abort(), options);
}

/** A dnd-kit sensor: dnd-kit constructs one per press that its activator accepts. */
export class SidebarPointerSensor {
  static activators = [
    {
      eventName: "onPointerDown" as const,
      handler: ({ nativeEvent: press }: ReactPointerEvent) => press.isPrimary && press.button === 0,
    },
  ];

  autoScrollEnabled = true;

  /** Ends the gesture without dropping. */
  readonly cancel: () => void;

  constructor(input: SensorInput) {
    const press = input.event as PointerEvent;
    const document = getOwnerDocument(press.target);
    const window = getWindow(press.target);
    const { distance, onAttach, onFinish } = input.options;
    const start = pointOf(press);
    const constraint = { distance };

    let state: "pressed" | "dragging" | "done" = "pressed";
    // Every listener of the gesture goes when it ends.
    const gesture = new AbortController();
    const listen = <K extends keyof DocumentEventMap>(
      type: K,
      listener: (event: DocumentEventMap[K]) => void,
      capture = false,
    ) => document.addEventListener(type, listener, { capture, signal: gesture.signal });
    const isThisPointer = (event: PointerEvent) => event.pointerId === press.pointerId;
    const clearSelection = () => document.getSelection()?.removeAllRanges();

    const finish = (outcome: "dropped" | "cancelled") => {
      if (state === "done") return;
      const becameDrag = state === "dragging";
      state = "done";
      gesture.abort();
      if (becameDrag || outcome === "cancelled") swallowNextClick(document);
      try {
        // The sidebar lets go of its preview before dnd-kit clears the transforms.
        onFinish(becameDrag);
      } finally {
        if (!becameDrag) input.onAbort(input.active);
        if (outcome === "cancelled") input.onCancel();
        else input.onEnd();
      }
    };
    this.cancel = () => finish("cancelled");

    const beginDrag = () => {
      state = "dragging";
      listen("selectionchange", clearSelection);
      clearSelection();
      input.onStart(start);
    };

    listen(
      "pointermove",
      (event) => {
        if (state === "done" || !isThisPointer(event)) return;
        // Desktop can report the button up on the last move before pointerup.
        if ((event.buttons & PRIMARY_BUTTON) === 0) return this.cancel();
        if (state === "pressed") {
          const offset = { x: event.clientX - start.x, y: event.clientY - start.y };
          if (Math.hypot(offset.x, offset.y) <= distance) {
            input.onPending(input.active, constraint, start, offset);
            return;
          }
          beginDrag();
        }
        if (event.cancelable) event.preventDefault();
        input.onMove(pointOf(event));
      },
      true,
    );
    listen("pointerup", (event) => isThisPointer(event) && finish("dropped"), true);
    listen("pointercancel", (event) => isThisPointer(event) && this.cancel(), true);
    listen("keydown", (event) => event.code === "Escape" && this.cancel(), true);
    listen("visibilitychange", () => document.hidden && this.cancel());
    listen("dragstart", (event) => event.preventDefault());
    listen("contextmenu", (event) => event.preventDefault());
    for (const type of ["blur", "pagehide", "resize"] as const) {
      window.addEventListener(type, this.cancel, { signal: gesture.signal });
    }

    onAttach(this);
    input.onPending(input.active, constraint, start);
  }
}
