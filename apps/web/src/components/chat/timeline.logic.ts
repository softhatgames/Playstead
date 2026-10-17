import type { OrchestrationV2TurnItem } from "@playstead/contracts/orchestrationV2";

/**
 * A row of the thread's timeline: a message, or an activity-log entry for
 * the work the provider did. After T3 Code's
 * `deriveTimelineEntriesFromVisibleTurnItemsWithState` and `projectedWorkEntry`
 * (`apps/web/src/session-logic.ts`) and the labels in
 * `apps/web/src/components/chat/MessagesTimeline.logic.ts` at 2577baf.
 */
export type TimelineRow =
  | {
      readonly kind: "user";
      readonly id: string;
      readonly text: string;
      /**
       * How a message that did not simply start its turn reached it (T3
       * Code's `UserMessageIntentMarker`): it steered the running turn, was
       * queued and then steered, or waited in the queue.
       */
      readonly intent?: "steer" | "promoted_queued_to_steer" | "queued_turn";
    }
  | {
      readonly kind: "assistant";
      readonly id: string;
      readonly text: string;
      readonly streaming: boolean;
    }
  | {
      readonly kind: "work";
      readonly id: string;
      readonly label: string;
      /** What opens under the row: a written file's content, a command's output, or an approval's prompt. */
      readonly detail?: string;
      readonly icon: "file" | "tool" | "approval";
      readonly tone: "tool" | "error";
      readonly running: boolean;
    }
  /**
   * A provider's question: waiting on the person (the pending user-input
   * panel answers it), answered, or left unanswered when the turn ended.
   */
  | {
      readonly kind: "question";
      readonly id: string;
      readonly question: string;
      readonly state: "waiting" | "answered" | "unanswered";
      readonly answer?: string;
    }
  /** A plan the provider proposed, shown as T3 Code's plan card. */
  | {
      readonly kind: "proposed-plan";
      readonly id: string;
      readonly planId: string;
      readonly markdown: string;
      readonly streaming: boolean;
    }
  /** The person pressed **Interrupt** (T3 Code's `V2LifecycleRow`). */
  | { readonly kind: "interrupt-request"; readonly id: string; readonly label: string }
  /** The run has stopped. */
  | { readonly kind: "interrupted"; readonly id: string; readonly label: string };

/** A path inside the project, shown from the project's folder. */
const displayPath = (fileName: string, workspaceRoot: string | undefined) => {
  if (workspaceRoot === undefined) return fileName;
  const root = workspaceRoot.replace(/[\\/]+$/, "");
  const inside =
    fileName.startsWith(`${root}/`) || fileName.startsWith(`${root}\\`)
      ? fileName.slice(root.length + 1)
      : undefined;
  return inside === undefined || inside.length === 0 ? fileName : inside;
};

const verb = (item: OrchestrationV2TurnItem, running: string, done: string) =>
  item.status === "running" || item.status === "pending"
    ? running
    : item.status === "failed"
      ? "Failed"
      : item.status === "interrupted" || item.status === "cancelled"
        ? "Stopped"
        : done;

const workRow = (
  item: OrchestrationV2TurnItem,
  label: string,
  detail: string | undefined,
): TimelineRow => ({
  kind: "work",
  id: item.id,
  label,
  ...(detail === undefined || detail.length === 0 ? {} : { detail }),
  icon:
    item.type === "file_change" ? "file" : item.type === "approval_request" ? "approval" : "tool",
  tone: item.status === "failed" ? "error" : "tool",
  running: item.status === "running" || item.status === "pending" || item.status === "waiting",
});

const questionRow = (
  item: Extract<OrchestrationV2TurnItem, { type: "user_input_request" }>,
): TimelineRow => {
  const question = item.questions.map((candidate) => candidate.question).join(" ");
  if (item.status === "waiting" || item.status === "pending") {
    return { kind: "question", id: item.id, question, state: "waiting" };
  }
  if (item.answers === undefined) {
    return { kind: "question", id: item.id, question, state: "unanswered" };
  }
  const { answers } = item;
  const answer = item.questions
    .map((candidate) => answers[candidate.id])
    .flatMap((given) =>
      given === undefined ? [] : [typeof given === "string" ? given : given.join(", ")],
    )
    .join("; ");
  return { kind: "question", id: item.id, question, state: "answered", answer };
};

export function deriveTimelineRows(
  items: ReadonlyArray<OrchestrationV2TurnItem>,
  workspaceRoot: string | undefined,
): ReadonlyArray<TimelineRow> {
  // Claude's `AskUserQuestion` tool shows as its question, and `ExitPlanMode`
  // as its plan card, not as tools too.
  const shown = items.filter(
    (item) =>
      item.type !== "dynamic_tool" ||
      (item.toolName !== "AskUserQuestion" && item.toolName !== "ExitPlanMode"),
  );
  return shown.map((item): TimelineRow => {
    switch (item.type) {
      case "user_message":
        return item.inputIntent === undefined || item.inputIntent === "turn_start"
          ? { kind: "user", id: item.id, text: item.text }
          : { kind: "user", id: item.id, text: item.text, intent: item.inputIntent };
      case "assistant_message":
        return { kind: "assistant", id: item.id, text: item.text, streaming: item.streaming };
      case "file_change":
        return workRow(
          item,
          `${verb(item, "Changing", "Changed")} ${displayPath(item.fileName, workspaceRoot)}`,
          item.newStr,
        );
      case "command_execution":
        return workRow(item, `${verb(item, "Running", "Ran")} ${item.input}`, item.output);
      case "dynamic_tool":
        return workRow(item, item.toolName, undefined);
      case "error":
        return workRow(item, item.failure.message, undefined);
      // T3 Code's `session-logic.ts`: "Approval requested", with the prompt or the kind.
      case "approval_request":
        return workRow(item, "Approval requested", item.prompt ?? item.requestKind);
      case "user_input_request":
        return questionRow(item);
      case "proposed_plan":
        return {
          kind: "proposed-plan",
          id: item.id,
          planId: item.planId,
          markdown: item.markdown,
          streaming: item.streaming,
        };
      case "todo_list":
        // T3 Code's "Plan updated" row, its steps under it.
        return workRow(
          item,
          "Plan updated",
          [item.explanation, item.steps.map((step) => `${step.status}: ${step.text}`).join("\n")]
            .filter((part) => part !== undefined && part.length > 0)
            .join("\n\n"),
        );
      case "run_interrupt_request":
        return { kind: "interrupt-request", id: item.id, label: "Interrupt requested" };
      case "run_interrupt_result":
        return { kind: "interrupted", id: item.id, label: "Interrupted" };
    }
  });
}
