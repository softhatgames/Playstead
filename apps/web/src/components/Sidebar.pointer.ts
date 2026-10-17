import type { SensorProps } from "@dnd-kit/core";
import { getOwnerDocument, getWindow } from "@dnd-kit/utilities";
import { type PointerEvent as ReactPointerEvent, useLayoutEffect } from "react";

/**
 * The inbox sidebar's pointer sensor (T3 Code's
 * `apps/web/src/components/Sidebar.pointer.ts` at 2577baf). A press becomes
 * a drag only past `distance` pixels, so a click still opens the thread; a
 * drag swallows the click that ends it and clears any text selection.
 * Escape, losing focus, hiding the page or resizing the window cancel it.
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

type Point = { x: number; y: number };

export class SidebarPointerSensor {
  static activators = [
    {
      eventName: "onPointerDown" as const,
      handler: ({ nativeEvent }: ReactPointerEvent) =>
        nativeEvent.isPrimary && nativeEvent.button === 0,
    },
  ];

  autoScrollEnabled = true;
  private phase: "pending" | "dragging" | "finished" = "pending";
  private readonly pointer: PointerEvent;
  private readonly document: Document;
  private readonly window: Window;
  private readonly props: Omit<SensorProps<SidebarPointerSensorOptions>, "activeNode" | "context">;

  constructor(props: Omit<SensorProps<SidebarPointerSensorOptions>, "activeNode" | "context">) {
    this.props = props;
    this.pointer = props.event as PointerEvent;
    this.document = getOwnerDocument(this.pointer.target);
    this.window = getWindow(this.pointer.target);
    this.document.addEventListener("pointermove", this.move, { passive: false, capture: true });
    this.document.addEventListener("pointerup", this.end, { capture: true });
    this.document.addEventListener("pointercancel", this.pointerCancel, { capture: true });
    this.document.addEventListener("keydown", this.keydown, { capture: true });
    this.document.addEventListener("visibilitychange", this.visibilityChange);
    this.document.addEventListener("dragstart", this.preventDefault);
    this.document.addEventListener("contextmenu", this.preventDefault);
    this.window.addEventListener("blur", this.cancel);
    this.window.addEventListener("pagehide", this.cancel);
    this.window.addEventListener("resize", this.cancel);
    props.options.onAttach(this);
    props.onPending(props.active, { distance: props.options.distance }, this.origin());
  }

  private origin = (): Point => ({ x: this.pointer.clientX, y: this.pointer.clientY });
  private preventDefault = (event: Event) => event.preventDefault();
  private clearSelection = () => this.document.getSelection()?.removeAllRanges();

  private suppressClick = (event: Event) => {
    event.stopPropagation();
    // Rows are links: without this the browser would follow one natively.
    event.preventDefault();
    this.stopSuppressingClicks();
  };
  private stopSuppressingClicks = () => {
    this.document.removeEventListener("click", this.suppressClick, { capture: true });
    this.document.removeEventListener("pointerdown", this.stopSuppressingClicks, {
      capture: true,
    });
  };

  private move = (event: PointerEvent) => {
    if (this.phase === "finished" || event.pointerId !== this.pointer.pointerId) return;
    // The button can be up on the last move before pointerup (desktop).
    if ((event.buttons & 1) === 0) return this.cancel();
    if (this.phase === "pending") {
      const offset = {
        x: event.clientX - this.pointer.clientX,
        y: event.clientY - this.pointer.clientY,
      };
      if (Math.hypot(offset.x, offset.y) <= this.props.options.distance) {
        this.props.onPending(
          this.props.active,
          { distance: this.props.options.distance },
          this.origin(),
          offset,
        );
        return;
      }
      this.phase = "dragging";
      this.document.addEventListener("click", this.suppressClick, { capture: true });
      this.document.addEventListener("selectionchange", this.clearSelection);
      this.clearSelection();
      this.props.onStart(this.origin());
    }
    if (event.cancelable) event.preventDefault();
    this.props.onMove({ x: event.clientX, y: event.clientY });
  };

  private end = (event: PointerEvent) => {
    if (event.pointerId === this.pointer.pointerId) this.finish(false);
  };
  private pointerCancel = (event: PointerEvent) => {
    if (event.pointerId === this.pointer.pointerId) this.cancel();
  };
  private keydown = (event: KeyboardEvent) => {
    if (event.code === "Escape") this.cancel();
  };
  private visibilityChange = () => {
    if (this.document.hidden) this.cancel();
  };

  /** Ends the gesture without dropping. */
  cancel = () => this.finish(true);

  private finish(cancelled: boolean) {
    if (this.phase === "finished") return;
    const aborted = this.phase === "pending";
    this.phase = "finished";
    this.document.removeEventListener("pointermove", this.move, { capture: true });
    this.document.removeEventListener("pointerup", this.end, { capture: true });
    this.document.removeEventListener("pointercancel", this.pointerCancel, { capture: true });
    this.document.removeEventListener("keydown", this.keydown, { capture: true });
    this.document.removeEventListener("visibilitychange", this.visibilityChange);
    this.document.removeEventListener("dragstart", this.preventDefault);
    this.document.removeEventListener("contextmenu", this.preventDefault);
    this.document.removeEventListener("selectionchange", this.clearSelection);
    this.window.removeEventListener("blur", this.cancel);
    this.window.removeEventListener("pagehide", this.cancel);
    this.window.removeEventListener("resize", this.cancel);
    // The release may come long after a cancel, or outside the page: swallow
    // its click, or stop at the next press.
    if (!aborted || cancelled) {
      this.document.addEventListener("click", this.suppressClick, { capture: true });
      this.document.addEventListener("pointerdown", this.stopSuppressingClicks, {
        capture: true,
      });
    }
    try {
      // Let the sidebar release its preview before dnd-kit clears the transforms.
      this.props.options.onFinish(!aborted);
    } finally {
      if (aborted) this.props.onAbort(this.props.active);
      if (cancelled) this.props.onCancel();
      else this.props.onEnd();
    }
  }
}
