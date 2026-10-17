import { useEffect, useRef } from "react";

import { FilePenIcon, MessageCircleIcon, Redo2Icon, WrenchIcon } from "../icons.tsx";
import { ProposedPlanCard } from "./ProposedPlanCard.tsx";
import type { TimelineRow } from "./timeline.logic.ts";

/**
 * The thread's messages and activity log, after T3 Code's
 * `apps/web/src/components/chat/MessagesTimeline.tsx` and `WorkLog.tsx` at
 * 2577baf. Replies show as plain text while they stream, and a proposed
 * plan as its plan card; file links and every other action that opens a
 * panel are absent.
 */
export function MessagesTimeline(props: {
  readonly rows: ReadonlyArray<TimelineRow>;
  readonly working: boolean;
  /** The project's folder, where a plan card saves its plan. */
  readonly workspaceRoot: string | undefined;
  readonly onSavePlan: (relativePath: string, contents: string) => Promise<string>;
}) {
  const end = useRef<HTMLDivElement | null>(null);
  const lastRow = props.rows.at(-1);
  const lastText =
    lastRow?.kind === "assistant"
      ? lastRow.text
      : lastRow?.kind === "proposed-plan"
        ? lastRow.markdown
        : undefined;

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [props.rows.length, lastText]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-6 py-6" aria-live="polite">
      {props.rows.map((row) => {
        switch (row.kind) {
          case "user":
            return (
              <div key={row.id} className="flex flex-col items-end gap-1">
                {row.intent === undefined ? null : <UserMessageIntentMarker intent={row.intent} />}
                <div className="max-w-[80%] rounded-2xl bg-neutral-100 px-4 py-2 text-sm whitespace-pre-wrap dark:bg-neutral-800">
                  {row.text}
                </div>
              </div>
            );
          case "assistant":
            return (
              <div
                key={row.id}
                data-streaming={row.streaming ? "true" : undefined}
                className="text-sm leading-relaxed whitespace-pre-wrap"
              >
                {row.text}
                {row.streaming ? <span className="animate-pulse">▍</span> : null}
              </div>
            );
          case "work":
            return <WorkLogRow key={row.id} row={row} />;
          case "question":
            return (
              <div
                key={row.id}
                data-question-state={row.state}
                className="rounded-md border border-amber-300 px-3 py-1.5 text-xs dark:border-amber-800"
              >
                <span className="font-medium text-amber-800 dark:text-amber-300">
                  {row.state === "waiting"
                    ? "Waiting for your answer: "
                    : row.state === "answered"
                      ? "Asked: "
                      : "Not answered: "}
                </span>
                <span>{row.question}</span>
                {row.answer === undefined ? null : (
                  <span className="block text-neutral-600 dark:text-neutral-300">
                    You answered: {row.answer}
                  </span>
                )}
              </div>
            );
          // T3 Code's `V2LifecycleRow`: the request on the person's side,
          // the result as a divider across the timeline.
          case "interrupt-request":
            return (
              <div
                key={row.id}
                className="flex items-center justify-end gap-2 text-xs text-red-700 dark:text-red-400"
              >
                <span aria-hidden="true" className="font-mono">
                  ■
                </span>
                <span className="font-medium">{row.label}</span>
              </div>
            );
          case "interrupted":
            return (
              <div
                key={row.id}
                role="separator"
                aria-label={row.label}
                className="flex items-center gap-3 text-xs text-red-700 dark:text-red-400"
              >
                <span className="h-px flex-1 bg-red-200 dark:bg-red-900" />
                <span className="font-medium">{row.label}</span>
                <span className="h-px flex-1 bg-red-200 dark:bg-red-900" />
              </div>
            );
          case "proposed-plan":
            return (
              <ProposedPlanCard
                key={row.id}
                markdown={row.markdown}
                streaming={row.streaming}
                workspaceRoot={props.workspaceRoot}
                onSaveToWorkspace={props.onSavePlan}
              />
            );
        }
      })}
      {props.working && lastRow?.kind !== "assistant" ? (
        <div className="animate-pulse text-xs text-neutral-500 dark:text-neutral-400">Working…</div>
      ) : null}
      <div ref={end} />
    </div>
  );
}

/**
 * How a message reached its turn, above it (T3 Code's
 * `UserMessageIntentMarker`): "Steer" for one that steered the running turn,
 * "From queue" for one that waited in the queue; the title says more.
 */
function UserMessageIntentMarker(props: {
  readonly intent: NonNullable<Extract<TimelineRow, { kind: "user" }>["intent"]>;
}) {
  const steer = props.intent !== "queued_turn";
  return (
    <div
      data-user-message-intent={props.intent}
      title={
        props.intent === "queued_turn"
          ? "Queued while the agent was busy"
          : props.intent === "promoted_queued_to_steer"
            ? "Originally queued, then promoted to steer the active turn"
            : "Steered the active turn"
      }
      className="me-1 flex items-center gap-1 text-xs leading-none text-neutral-500 dark:text-neutral-400"
    >
      {steer ? <Redo2Icon className="size-3" /> : null}
      {steer ? "Steer" : "From queue"}
    </div>
  );
}

function WorkLogRow({ row }: { readonly row: Extract<TimelineRow, { kind: "work" }> }) {
  const tone =
    row.tone === "error"
      ? "text-red-700 dark:text-red-400"
      : "text-neutral-600 dark:text-neutral-300";
  const icon =
    row.icon === "file" ? (
      <FilePenIcon className="size-3.5 shrink-0" />
    ) : row.icon === "approval" ? (
      <MessageCircleIcon className="size-3.5 shrink-0" />
    ) : (
      <WrenchIcon className="size-3.5 shrink-0" />
    );
  const summary = (
    <span className={`flex items-center gap-2 text-xs ${tone}`}>
      {icon}
      <span className={`truncate ${row.running ? "animate-pulse" : ""}`}>{row.label}</span>
    </span>
  );
  if (row.detail === undefined) {
    return (
      <div className="rounded-md border border-neutral-200 px-3 py-1.5 dark:border-neutral-800">
        {summary}
      </div>
    );
  }
  return (
    <details className="rounded-md border border-neutral-200 px-3 py-1.5 dark:border-neutral-800">
      <summary className="cursor-pointer list-none">{summary}</summary>
      <pre className="mt-2 max-h-64 overflow-auto rounded bg-neutral-50 p-2 text-xs dark:bg-neutral-900">
        {row.detail}
      </pre>
    </details>
  );
}
