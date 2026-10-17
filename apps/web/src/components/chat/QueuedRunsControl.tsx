import type { RunId } from "@playstead/contracts/baseSchemas";
import type { QueuedThreadRun } from "@playstead/client-runtime/state/threadWorkflows";
import { type Ref, useId, useImperativeHandle, useRef, useState } from "react";

import {
  ChevronDownIcon,
  CornerUpRightIcon,
  GripVerticalIcon,
  ListOrderedIcon,
  PencilIcon,
  XIcon,
} from "../icons.tsx";

const QUEUED_RUN_DRAG_TYPE = "application/x-playstead-queued-run";

export interface QueuedRunsControlHandle {
  /** `alt+arrowup`: opens the last queued message for editing; false when there is none. */
  readonly editLatest: (repeat: boolean) => boolean;
  /** `mod+shift+enter`: sends the first queued message as a steer; false when it can't. */
  readonly steerNext: (repeat: boolean) => boolean;
}

/**
 * The queued messages above the composer (T3 Code's
 * `apps/web/src/components/chat/QueuedRunsControl.tsx` at 2577baf, without
 * attachments or optimistic rows): a header that collapses the list, and a
 * row per message in the order they will start. A row's grip reorders it,
 * by drag or with the arrow keys; the pencil opens it in the composer for
 * editing, **Steer** sends it into the running turn instead
 * (`queued-message.promote-to-steer`; `mod+shift+enter` does it for the
 * first), and the cross removes it. The row being edited is highlighted,
 * with **Cancel** in place of its actions.
 */
export function QueuedRunsControl(props: {
  readonly ref?: Ref<QueuedRunsControlHandle>;
  readonly queuedRuns: ReadonlyArray<QueuedThreadRun>;
  readonly editingRunId: RunId | null;
  readonly onEdit: (queued: QueuedThreadRun) => void;
  readonly onCancelEdit: () => void;
  readonly onReorder: (runId: RunId, beforeRunId: RunId | null) => Promise<void>;
  readonly onRemove: (runId: RunId) => Promise<void>;
  /** Whether a run is active, and whether its turn can take a steer now. */
  readonly hasActiveRun: boolean;
  readonly canPromoteToSteer: boolean;
  /** Sends a queued message as a steer into the active run. */
  readonly onSteer: (runId: RunId) => Promise<void>;
  /** `mod+shift+enter` as this platform writes it, for the first row's tooltip. */
  readonly steerShortcutLabel: string;
}) {
  const { queuedRuns } = props;
  const [expanded, setExpanded] = useState(true);
  const listId = useId();
  const [busyRunId, setBusyRunId] = useState<RunId | null>(null);
  const [drag, setDrag] = useState<{
    readonly runId: RunId;
    readonly insertIndex: number | null;
  } | null>(null);
  // A drag starts from the grip only, not from text dragged in the row.
  const armedRunId = useRef<RunId | null>(null);

  const busy = async (runId: RunId, work: Promise<void>) => {
    setBusyRunId(runId);
    try {
      await work;
    } catch {
      // The projection still shows the queue as it is; nothing to undo here.
    } finally {
      setBusyRunId(null);
    }
  };
  const move = (runId: RunId, beforeRunId: RunId | null) =>
    void busy(runId, props.onReorder(runId, beforeRunId));

  const completeDrag = (runId: RunId, insertIndex: number | null) => {
    setDrag(null);
    armedRunId.current = null;
    if (insertIndex === null || busyRunId !== null) return;
    const from = queuedRuns.findIndex(({ run }) => run.id === runId);
    if (from === -1 || insertIndex === from || insertIndex === from + 1) return;
    move(runId, queuedRuns[insertIndex]?.run.id ?? null);
  };

  // One steer at a time, even before the busy state renders.
  const steerInFlight = useRef(false);
  const steer = async (runId: RunId) => {
    if (!props.canPromoteToSteer || steerInFlight.current) return;
    steerInFlight.current = true;
    try {
      await busy(runId, props.onSteer(runId));
    } finally {
      steerInFlight.current = false;
    }
  };

  useImperativeHandle(props.ref, () => ({
    steerNext(repeat) {
      const next = queuedRuns[0];
      if (next === undefined || !props.canPromoteToSteer) return false;
      if (!repeat && busyRunId === null) void steer(next.run.id);
      return true;
    },
    editLatest(repeat) {
      const latest = queuedRuns.at(-1);
      // While one is being edited the key moves the caret in that draft instead.
      if (latest === undefined || props.editingRunId !== null || busyRunId !== null) return false;
      if (!repeat) {
        setExpanded(true);
        props.onEdit(latest);
      }
      return true;
    },
  }));

  if (queuedRuns.length === 0) return null;
  const count = queuedRuns.length;

  return (
    <section
      aria-label={`${count} queued message${count === 1 ? "" : "s"}`}
      aria-live="polite"
      className="mb-2 rounded-xl border border-neutral-200 bg-neutral-50 text-sm dark:border-neutral-800 dark:bg-neutral-900"
    >
      <button
        type="button"
        aria-label={expanded ? "Collapse queued messages" : "Expand queued messages"}
        aria-expanded={expanded}
        aria-controls={listId}
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => setExpanded((value) => !value)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-neutral-500 dark:text-neutral-400"
      >
        <ListOrderedIcon className="size-4 shrink-0" />
        <span className="flex-1">Queued</span>
        <span className="tabular-nums">{count}</span>
        <ChevronDownIcon
          className={`size-4 transition-transform ${expanded ? "" : "-rotate-90"}`}
        />
      </button>
      <ol id={listId} className={`max-h-32 overflow-y-auto px-1 pb-1 ${expanded ? "" : "hidden"}`}>
        {queuedRuns.map((queued, index) => {
          const runId = queued.run.id;
          const editing = runId === props.editingRunId;
          return (
            <li
              key={runId}
              aria-current={editing ? "true" : undefined}
              draggable={busyRunId === null}
              onDragStart={(event) => {
                if (armedRunId.current !== runId) {
                  event.preventDefault();
                  return;
                }
                event.dataTransfer.setData(QUEUED_RUN_DRAG_TYPE, runId);
                event.dataTransfer.effectAllowed = "move";
                setDrag({ runId, insertIndex: null });
              }}
              onDragEnd={() => {
                armedRunId.current = null;
                setDrag(null);
              }}
              onDragOver={(event) => {
                if (drag === null) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                const rect = event.currentTarget.getBoundingClientRect();
                const insertIndex = event.clientY < rect.top + rect.height / 2 ? index : index + 1;
                if (drag.insertIndex !== insertIndex) setDrag({ runId: drag.runId, insertIndex });
              }}
              onDrop={(event) => {
                if (drag === null) return;
                event.preventDefault();
                completeDrag(drag.runId, drag.insertIndex);
              }}
              className={`relative flex items-center gap-1 rounded-md px-1 py-0.5 ${
                editing ? "bg-neutral-200 dark:bg-neutral-800" : ""
              } ${drag?.runId === runId ? "opacity-50" : ""}`}
            >
              {drag?.insertIndex === index ? (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 top-0 h-0.5 rounded bg-neutral-500"
                />
              ) : null}
              {index === count - 1 && drag?.insertIndex === count ? (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 rounded bg-neutral-500"
                />
              ) : null}
              <button
                type="button"
                aria-label="Reorder queued message (drag, or press the arrow keys)"
                disabled={busyRunId !== null}
                onPointerDown={() => {
                  armedRunId.current = runId;
                }}
                onKeyDown={(event) => {
                  if (busyRunId !== null) return;
                  if (event.key === "ArrowUp" && index > 0) {
                    event.preventDefault();
                    move(runId, queuedRuns[index - 1]?.run.id ?? null);
                  }
                  if (event.key === "ArrowDown" && index < count - 1) {
                    event.preventDefault();
                    move(runId, queuedRuns[index + 2]?.run.id ?? null);
                  }
                }}
                className="cursor-grab rounded p-0.5 text-neutral-400 hover:text-neutral-700 active:cursor-grabbing disabled:cursor-default dark:hover:text-neutral-200"
              >
                <GripVerticalIcon className="size-3.5" />
              </button>
              <span className="min-w-0 flex-1 truncate" title={queued.text}>
                {editing ? <span className="sr-only">Editing queued message: </span> : null}
                {queued.text}
              </span>
              {editing ? (
                <button
                  type="button"
                  aria-label="Cancel editing queued message"
                  onClick={props.onCancelEdit}
                  className="rounded px-1.5 text-xs text-neutral-600 hover:underline dark:text-neutral-300"
                >
                  Cancel
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    aria-label="Edit queued message"
                    title={`Edit in the composer${index === count - 1 ? " (Alt+↑)" : ""}`}
                    disabled={busyRunId !== null}
                    onClick={() => props.onEdit(queued)}
                    className="rounded p-1 text-neutral-400 hover:text-neutral-700 disabled:opacity-50 dark:hover:text-neutral-200"
                  >
                    <PencilIcon className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    title={
                      props.hasActiveRun
                        ? `Send as a steer instead${index === 0 ? ` (${props.steerShortcutLabel})` : ""}`
                        : "There is no active run to steer"
                    }
                    disabled={busyRunId !== null || !props.canPromoteToSteer}
                    onClick={() => void steer(runId)}
                    className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-neutral-500 hover:text-neutral-800 disabled:opacity-50 dark:text-neutral-400 dark:hover:text-neutral-100"
                  >
                    <CornerUpRightIcon className="size-3.5" />
                    Steer
                  </button>
                  <button
                    type="button"
                    aria-label="Remove queued message"
                    title="Remove from queue"
                    disabled={busyRunId !== null}
                    onClick={() => void busy(runId, props.onRemove(runId))}
                    className="rounded p-1 text-neutral-400 hover:text-neutral-700 disabled:opacity-50 dark:hover:text-neutral-200"
                  >
                    <XIcon className="size-3.5" />
                  </button>
                </>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
