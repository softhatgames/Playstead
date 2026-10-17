/**
 * The inbox list's motion (T3 Code's `apps/web/src/components/Sidebar.motion.ts`
 * at 2577baf). When rows change place (pin, settle, a drop), each slides
 * from where it was to where it is; a row that leaves fades out where it
 * stood, and one that arrives fades in. During a drag dnd-kit moves the
 * rows, so motion is suspended; on release every row glides from where the
 * drag left it to its committed place. Nothing moves when the system asks
 * for reduced motion.
 */

const TIMING: KeyframeAnimationOptions = { duration: 150, easing: "ease-out" };
const travelFor = (height: number) => Math.min(height, 40);
// Each fade clones a row and runs its own animation; past this many, skip them.
const MAX_FADES_PER_UPDATE = 40;
// Attributes a fading clone must not keep, or it would be found as the row.
const CLONE_DROPPED_ATTRIBUTES = new Set(["data-thread-item", "data-testid"]);

type Box = { top: number; left: number; width: number; height: number };

const progressOf = (animation: Animation): number =>
  animation.playState === "finished" ? 1 : (animation.effect?.getComputedTiming().progress ?? 0);

/**
 * Motion for the list `parent`, which must be positioned so its children's
 * `offsetTop` share one origin. Call `update(animate)` after each render
 * that may move rows, `suspend()` when a drag starts, `release()` as it
 * ends and `dispose()` when the list goes.
 */
export function createSidebarListMotion(parent: HTMLElement) {
  let boxes: Map<HTMLElement, Box> | null = null;
  let disposed = false;
  let released: Map<HTMLElement, number> | null = null;
  const reducedMotion = parent.ownerDocument.defaultView?.matchMedia(
    "(prefers-reduced-motion: reduce)",
  );
  const sliding = new Map<HTMLElement, { animation: Animation; offset: number }>();
  const entering = new Map<HTMLElement, { animation: Animation; travel: number }>();
  const exiting = new Map<HTMLElement, Animation>();

  /** How far a row still is from its place, in its own slide and entry. */
  const remaining = (node: HTMLElement): number => {
    const slide = sliding.get(node);
    const entry = entering.get(node);
    return (
      (slide ? slide.offset * (1 - progressOf(slide.animation)) : 0) +
      (entry ? entry.travel * (1 - progressOf(entry.animation)) : 0)
    );
  };

  const stopSlide = (node: HTMLElement) => {
    sliding.get(node)?.animation.cancel();
    sliding.delete(node);
  };

  const clearFades = () => {
    for (const { animation } of entering.values()) animation.cancel();
    for (const [clone, animation] of exiting) {
      animation.cancel();
      clone.remove();
    }
    entering.clear();
    exiting.clear();
  };

  const slide = (node: HTMLElement, offset: number) => {
    stopSlide(node);
    const entry = entering.get(node);
    if (entry) entry.travel = 0;
    if (offset === 0 && !entry) return;
    const animation = node.animate(
      [{ transform: `translateY(${offset}px)` }, { transform: "translateY(0px)" }],
      TIMING,
    );
    sliding.set(node, { animation, offset });
    animation.addEventListener(
      "finish",
      () => {
        if (sliding.get(node)?.animation === animation) sliding.delete(node);
      },
      { once: true },
    );
  };

  const fadeOut = (node: HTMLElement, box: Box, travel: number) => {
    if (box.height === 0) return;
    const clone = node.cloneNode(true) as HTMLElement;
    for (const element of [clone, ...clone.querySelectorAll<Element>("*")]) {
      for (const { name } of Array.from(element.attributes)) {
        const isHtmlId = name === "id" && element.namespaceURI !== "http://www.w3.org/2000/svg";
        if (isHtmlId || CLONE_DROPPED_ATTRIBUTES.has(name)) element.removeAttribute(name);
      }
    }
    clone.setAttribute("aria-hidden", "true");
    clone.inert = true;
    Object.assign(clone.style, {
      position: "absolute",
      top: `${box.top + remaining(node)}px`,
      left: `${box.left}px`,
      width: `${box.width}px`,
      height: `${box.height}px`,
      margin: "0",
      boxSizing: "border-box",
      transform: "none",
      transition: "none",
      pointerEvents: "none",
    });
    parent.append(clone);
    const entry = entering.get(node);
    const animation = clone.animate(
      [
        { opacity: entry ? progressOf(entry.animation) : 1, transform: "translateY(0px)" },
        { opacity: 0, transform: `translateY(${travel}px)` },
      ],
      TIMING,
    );
    exiting.set(clone, animation);
    animation.addEventListener(
      "finish",
      () => {
        clone.remove();
        exiting.delete(clone);
      },
      { once: true },
    );
  };

  const measure = (): Map<HTMLElement, Box> =>
    new Map(
      Array.from(parent.children)
        .filter((node): node is HTMLElement => node instanceof HTMLElement && !exiting.has(node))
        .map((node) => [
          node,
          {
            top: node.offsetTop,
            left: node.offsetLeft,
            width: node.offsetWidth,
            height: node.offsetHeight,
          },
        ]),
    );

  const suspend = () => {
    for (const node of sliding.keys()) stopSlide(node);
    clearFades();
    boxes = null;
    released = null;
  };

  return {
    update(animate: boolean) {
      if (disposed) return;
      const next = measure();
      const previous = boxes;
      let fades = 0;
      if (previous !== null) {
        for (const [node, box] of previous) if (!next.has(node) && box.height > 0) fades += 1;
        for (const [node, box] of next) if (!previous.has(node) && box.height > 0) fades += 1;
      }
      const shouldAnimate =
        animate && previous !== null && !reducedMotion?.matches && fades <= MAX_FADES_PER_UPDATE;

      // A row that arrives or leaves rides with the nearest row above it that moved.
      const moved = new Map<HTMLElement, number>();
      const ridingOffset = (
        order: ReadonlyArray<HTMLElement>,
        index: number,
        kept: (node: HTMLElement) => boolean,
      ): number | undefined => {
        for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
          const node = order[cursor]!;
          const offset = moved.get(node);
          if (offset !== undefined) return offset;
          if (kept(node)) return remaining(node);
        }
        return undefined;
      };

      if (!shouldAnimate) clearFades();
      else {
        for (const [node, box] of next) {
          const before = previous.get(node)?.top;
          if (before !== undefined && before !== box.top) {
            moved.set(node, before + remaining(node) - box.top);
          }
        }
        const oldOrder = [...previous.keys()];
        for (const [node, box] of previous) {
          if (next.has(node)) continue;
          const offset = ridingOffset(oldOrder, oldOrder.indexOf(node), (n) => next.has(n));
          fadeOut(node, box, offset === undefined ? travelFor(box.height) : -offset);
        }
      }
      for (const [node, entry] of entering) {
        if (next.has(node)) continue;
        entry.animation.cancel();
        entering.delete(node);
      }
      for (const node of sliding.keys()) {
        if (!shouldAnimate || !next.has(node)) stopSlide(node);
      }
      if (shouldAnimate) {
        const newOrder = [...next.keys()];
        newOrder.forEach((node, index) => {
          const box = next.get(node)!;
          if (previous.has(node)) {
            const offset = moved.get(node);
            if (offset !== undefined) slide(node, offset);
            return;
          }
          if (box.height === 0) return;
          const offset = ridingOffset(newOrder, index, (n) => previous.has(n));
          const travel = offset === undefined ? -travelFor(box.height) : offset;
          const animation = node.animate(
            [
              { opacity: 0, transform: `translateY(${travel}px)` },
              { opacity: 1, transform: "translateY(0px)" },
            ],
            TIMING,
          );
          entering.set(node, { animation, travel });
          animation.addEventListener(
            "finish",
            () => {
              if (entering.get(node)?.animation === animation) entering.delete(node);
            },
            { once: true },
          );
        });
      }
      if (released !== null) {
        if (!reducedMotion?.matches) {
          for (const [node, box] of next) {
            const top = released.get(node);
            if (top !== undefined) slide(node, top - box.top);
          }
        }
        released = null;
      }
      boxes = next;
    },
    /** Notes where each row is as a drag ends, so the next update glides them home. */
    release() {
      suspend();
      const origin = parent.getBoundingClientRect().top;
      released = new Map(
        Array.from(parent.children)
          .filter((node): node is HTMLElement => node instanceof HTMLElement)
          .map((node) => [node, node.getBoundingClientRect().top - origin]),
      );
    },
    suspend,
    dispose() {
      suspend();
      disposed = true;
    },
  };
}
