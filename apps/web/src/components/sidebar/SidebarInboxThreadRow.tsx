import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  canSnooze,
  resolveSnoozePresets,
  snoozeWakeLabel,
} from "@playstead/client-runtime/state/threadSettled";
import type { OrchestrationV2ThreadShell } from "@playstead/contracts/orchestrationV2";
import { Link } from "@tanstack/react-router";
import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useMemo,
} from "react";

import { useThreadActionMenu } from "../../hooks/useThreadActionMenu.ts";
import {
  confirmAndUnpinThread,
  unsettleThread,
  unsnoozeThread,
  visitThread,
} from "../../hooks/useThreadActions.ts";
import { readLocalApi } from "../../localApi.ts";
import { useThreadSelection } from "../../threadSelectionStore.ts";
import { requestCustomSnooze } from "../CustomSnoozeDialog.tsx";
import {
  AlarmClockIcon,
  AlarmClockOffIcon,
  CheckIcon,
  CircleCheckIcon,
  ClockIcon,
  PinIcon,
  PinOffIcon,
  Undo2Icon,
} from "../icons.tsx";
import { animateSidebarLayoutChanges } from "../Sidebar.drag.ts";
import type { SidebarDropVerb } from "../Sidebar.drag.logic.ts";
import {
  compactTimeLabel,
  resolveSidebarThreadWokeAt,
  type SidebarSection,
} from "../Sidebar.logic.ts";
import { snoozeMenuChildren } from "../Sidebar.snooze.ts";
import { failureToast } from "../ui/toast.tsx";
import {
  JumpHintBadge,
  sidebarThreadLinkHandlers,
  SidebarThreadTitle,
  ThreadStatusIndicator,
  useThreadRename,
} from "./SidebarThreadParts.tsx";

/**
 * The inbox sidebar's thread row and what makes it draggable (T3 Code's
 * `SidebarThreadRow` and `SortableThreadRow` in `apps/web/src/components/Sidebar.tsx`
 * at 2577baf).
 */

type SidebarThread = OrchestrationV2ThreadShell;

/** What a press-and-drag across rows does from a row's hover button. */
export type SidebarSweepAction = "settle" | "unsettle" | "unsnooze";

export type SortableBag = Pick<
  ReturnType<typeof useSortable>,
  "listeners" | "setNodeRef" | "transform" | "transition" | "isDragging"
>;

/** A thread row the sidebar can drag (T3 Code's `SortableThreadRow`). */
export function SortableThreadRow(props: {
  readonly id: string;
  readonly disabled: boolean;
  readonly children: (sortable: SortableBag) => ReactNode;
}) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.id,
    disabled: { draggable: props.disabled },
    animateLayoutChanges: animateSidebarLayoutChanges,
  });
  const bag = useMemo(
    () => ({ listeners, setNodeRef, transform, transition, isDragging }),
    [listeners, setNodeRef, transform, transition, isDragging],
  );
  return props.children(bag);
}

/** What the dragged row says its drop will do (T3 Code's `dropVerbBadge`). */
const DROP_VERB_BADGE: Record<SidebarDropVerb, ReactNode> = {
  pin: (
    <>
      <PinIcon className="size-3" />
      Pin
    </>
  ),
  unpin: (
    <>
      <PinOffIcon className="size-3" />
      Unpin
    </>
  ),
  settle: (
    <>
      <CircleCheckIcon className="size-3" />
      Settle
    </>
  ),
  unsettle: (
    <>
      <Undo2Icon className="size-3" />
      Un-settle
    </>
  ),
  wake: (
    <>
      <AlarmClockOffIcon className="size-3" />
      Wake
    </>
  ),
};

/**
 * A row (T3 Code's `SidebarThreadRow`): a card in Pinned, Active and
 * Working, a slim row in Snoozed and Settled. A card's hover buttons snooze
 * it (presets and **Custom…**) and settle it; a snoozed row shows the time
 * left and wakes from its hover button, a settled one un-settles. Pressed
 * and dragged across rows, Settle, Un-settle and Wake act on each. A pinned
 * row's pin unpins it. Dragged, the row shows what the drop will do instead
 * of its status and hover buttons.
 */
export function InboxThreadRow(props: {
  readonly thread: SidebarThread;
  readonly section: SidebarSection;
  readonly current: boolean;
  /** Shown when the sidebar spans several projects. */
  readonly projectName: string | null;
  readonly orderedIdsRef: { readonly current: ReadonlyArray<string> };
  /** The row's jump key while the jump modifier is held. */
  readonly jumpLabel: string | null;
  readonly sortable: SortableBag;
  readonly dropVerb: SidebarDropVerb | null;
  readonly dragOverPinned: boolean;
  readonly sweepAction: SidebarSweepAction | null;
  readonly onSettle: (thread: SidebarThread) => void;
  readonly onSnooze: (thread: SidebarThread, snoozedUntil: string) => void;
  readonly onActionSweepStart: (
    thread: SidebarThread,
    action: SidebarSweepAction,
    event: PointerEvent,
  ) => void;
  readonly onBulkMenu: (position: { x: number; y: number }) => void;
}) {
  const { thread, section, current, onSnooze, sortable } = props;
  const rename = useThreadRename(thread);
  const { openMenu } = useThreadActionMenu(thread, {
    onStartRename: rename.start,
    projectFilter: true,
    onSnooze: useCallback(
      (snoozedUntil: string) => onSnooze(thread, snoozedUntil),
      [onSnooze, thread],
    ),
  });
  const selected = useThreadSelection().selectedThreadIds.has(thread.id);
  const settled = section === "settled";
  const snoozed = section === "snoozed";
  const slim = settled || snoozed;
  const pinned = thread.pinnedAt !== null;
  const dragging = sortable.isDragging;
  const sweeping = props.sweepAction !== null;
  const now = Date.now();
  const timeLabel =
    snoozed && thread.snoozedUntil !== null
      ? snoozeWakeLabel(thread.snoozedUntil, { now: new Date(now).toISOString() })
      : compactTimeLabel(
          settled
            ? (thread.settledAt ?? thread.updatedAt)
            : (thread.latestRunRequestedAt ?? thread.updatedAt),
          now,
        );
  const showSnoozeButton = !slim && !dragging && !sweeping && canSnooze(thread);
  const wokeAt = resolveSidebarThreadWokeAt(thread, { now: new Date(now).toISOString() });

  /** The snooze button's menu: the presets and **Custom…**, below the button. */
  const openSnoozeMenu = (button: HTMLElement) => {
    const presets = resolveSnoozePresets(new Date());
    const box = button.getBoundingClientRect();
    void (async () => {
      const chosen = await readLocalApi()
        .contextMenu.show(snoozeMenuChildren(presets), { x: box.left, y: box.bottom })
        .catch(() => null);
      if (chosen === null) return;
      const choice =
        chosen === "snooze:custom"
          ? await requestCustomSnooze()
          : presets.find((preset) => `snooze:${preset.id}` === chosen);
      if (choice != null) onSnooze(thread, choice.snoozedUntil);
    })();
  };

  const surface = dragging
    ? "bg-neutral-200 shadow-lg dark:bg-neutral-800"
    : current
      ? "bg-neutral-200 dark:bg-neutral-800"
      : selected || sweeping
        ? "bg-sky-100 dark:bg-sky-950"
        : "hover:bg-neutral-100 dark:hover:bg-neutral-900";
  const rowClass = `group relative flex w-full items-center gap-2 rounded-md px-2.5 text-left text-sm ${
    slim ? "h-8 text-neutral-500 dark:text-neutral-400" : "min-h-9 py-1.5"
  } ${surface}`;
  const sortableProps = {
    ref: sortable.setNodeRef,
    style: {
      transform: CSS.Translate.toString(sortable.transform),
      transition: sortable.transition,
      // A row the projected layout folds away hides; the dragged row never does.
      visibility: !dragging && sortable.transform?.scaleY === 0 ? ("hidden" as const) : undefined,
    },
  };

  if (rename.input !== null) {
    return (
      <li {...sortableProps} className="list-none">
        <div className={rowClass}>
          <ThreadStatusIndicator thread={thread} />
          {rename.input}
        </div>
      </li>
    );
  }

  // Dragged, a pin stays only while the row is over Pinned without a badge.
  const showPin = pinned && (!dragging || (props.dragOverPinned && props.dropVerb === null));
  const badgeVerb: SidebarDropVerb | null = dragging
    ? props.dropVerb
    : props.sweepAction === "unsnooze"
      ? "wake"
      : props.sweepAction;
  const badge =
    badgeVerb === null ? null : (
      <span
        role="status"
        className="pointer-events-none ml-auto inline-flex h-5 shrink-0 items-center gap-1 rounded-sm border border-sky-500/40 bg-sky-500/10 px-1.5 text-[11px] font-medium text-sky-700 dark:text-sky-300"
      >
        {DROP_VERB_BADGE[badgeVerb]}
      </span>
    );
  const startSweep = (event: ReactPointerEvent) => {
    if (!event.isPrimary || event.button !== 0) return;
    // The sweep, not the row's drag, takes this press.
    event.stopPropagation();
    props.onActionSweepStart(
      thread,
      snoozed ? "unsnooze" : settled ? "unsettle" : "settle",
      event.nativeEvent,
    );
  };
  const hoverButtonClass =
    "pointer-events-none absolute top-1/2 right-1 -translate-y-1/2 rounded-md p-1.5 text-neutral-500 opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100";

  return (
    <li
      {...sortableProps}
      {...sortable.listeners}
      className={`group relative list-none${dragging ? " z-20" : ""}`}
    >
      <Link
        to="/threads/$threadId"
        params={{ threadId: thread.id }}
        draggable={false}
        data-thread-item={thread.id}
        aria-current={current ? "page" : undefined}
        aria-selected={selected || undefined}
        {...sidebarThreadLinkHandlers({
          thread,
          orderedIds: () => props.orderedIdsRef.current,
          startRename: rename.start,
          openMenu,
          onBulkMenu: props.onBulkMenu,
        })}
        className={`${rowClass} ${
          dragging || sweeping ? "" : showSnoozeButton ? "pr-16" : "pr-9"
        } select-none`}
      >
        {dragging ? null : <ThreadStatusIndicator thread={thread} />}
        <span className="flex min-w-0 flex-1 flex-col">
          <SidebarThreadTitle thread={thread} />
          {props.projectName !== null && !slim ? (
            <span className="truncate text-xs text-neutral-500 dark:text-neutral-400">
              {props.projectName}
            </span>
          ) : null}
        </span>
        {showPin && dragging ? (
          <PinIcon className="size-3 shrink-0 text-neutral-400" />
        ) : showPin ? (
          <span className="size-3 shrink-0" aria-hidden />
        ) : null}
        {badge ??
          (wokeAt !== null ? (
            <button
              type="button"
              aria-label="Dismiss Woke notification"
              title="Dismiss Woke notification"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                // T3 Code's acknowledgement does not report a failure either.
                visitThread(thread.id, wokeAt).catch(() => undefined);
              }}
              className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-sm text-xs font-medium text-amber-600 hover:underline dark:text-amber-400"
            >
              <AlarmClockIcon className="size-3.5 shrink-0" />
              <span role="status">Woke</span>
            </button>
          ) : (
            <span
              className={`shrink-0 text-xs tabular-nums group-hover:opacity-0 ${
                snoozed
                  ? "text-sky-700 dark:text-sky-400"
                  : "text-neutral-500 dark:text-neutral-400"
              }`}
            >
              {timeLabel}
            </span>
          ))}
        {props.jumpLabel === null ? null : <JumpHintBadge label={props.jumpLabel} />}
      </Link>
      {showPin && !dragging ? (
        <button
          type="button"
          aria-label="Unpin thread"
          title="Unpin thread"
          onClick={() =>
            confirmAndUnpinThread(thread).catch((error: unknown) =>
              failureToast("Failed to unpin thread", error),
            )
          }
          className="group/unpin absolute top-1/2 right-9 -translate-y-1/2 rounded-sm text-neutral-400 hover:text-neutral-900 dark:hover:text-neutral-100"
        >
          <PinIcon className="size-3 group-hover/unpin:hidden" />
          <PinOffIcon className="hidden size-3 group-hover/unpin:block" />
        </button>
      ) : null}
      {showSnoozeButton ? (
        <button
          type="button"
          aria-label="Snooze thread"
          title="Snooze thread"
          aria-haspopup="menu"
          onClick={(event) => openSnoozeMenu(event.currentTarget)}
          className="pointer-events-none absolute top-1/2 right-8 -translate-y-1/2 rounded-md p-1.5 text-neutral-500 opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
        >
          <ClockIcon className="size-3.5" />
        </button>
      ) : null}
      {dragging || sweeping ? null : snoozed ? (
        <button
          type="button"
          aria-label="Wake thread now"
          title="Wake thread now"
          onPointerDown={startSweep}
          onClick={() =>
            unsnoozeThread(thread.id).catch((error: unknown) =>
              failureToast("Failed to wake thread", error),
            )
          }
          className={hoverButtonClass}
        >
          <AlarmClockOffIcon className="size-3.5" />
        </button>
      ) : settled ? (
        <button
          type="button"
          aria-label="Un-settle thread"
          title="Un-settle thread"
          onPointerDown={startSweep}
          onClick={() =>
            unsettleThread(thread.id).catch((error: unknown) =>
              failureToast("Failed to un-settle thread", error),
            )
          }
          className={hoverButtonClass}
        >
          <Undo2Icon className="size-3.5" />
        </button>
      ) : (
        <button
          type="button"
          aria-label="Settle thread"
          title="Settle thread"
          onPointerDown={startSweep}
          onClick={() => props.onSettle(thread)}
          className={hoverButtonClass}
        >
          <CheckIcon className="size-3.5" />
        </button>
      )}
    </li>
  );
}
