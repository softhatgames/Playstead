import type { RuntimeRequestId } from "@playstead/contracts/baseSchemas";
import type {
  OrchestrationV2RuntimeRequest,
  OrchestrationV2TurnItem,
  OrchestrationV2UserInputQuestion,
  ProviderUserInputAnswers,
} from "@playstead/contracts/orchestrationV2";

/**
 * The pending user-input panel's logic, after T3 Code's
 * `derivePendingThreadRequests` (`packages/client-runtime/src/state/threadRequests.ts`)
 * and `apps/web/src/pendingUserInput.ts` at 2577baf, without approvals,
 * attachments, suggested answers or answers sent as messages.
 */

export interface PendingUserInput {
  readonly requestId: RuntimeRequestId;
  readonly questions: ReadonlyArray<OrchestrationV2UserInputQuestion>;
}

/** The questions still waiting on the person, oldest first, each with its item's questions. */
export function derivePendingUserInputs(
  runtimeRequests: ReadonlyArray<OrchestrationV2RuntimeRequest>,
  turnItems: ReadonlyArray<OrchestrationV2TurnItem>,
): ReadonlyArray<PendingUserInput> {
  return runtimeRequests.flatMap((request) => {
    if (request.status !== "pending" || request.kind !== "user_input") return [];
    const item = turnItems.findLast(
      (candidate) => candidate.type === "user_input_request" && candidate.requestId === request.id,
    );
    return item?.type === "user_input_request"
      ? [{ requestId: request.id, questions: item.questions }]
      : [];
  });
}

/** What the person has picked or written for one question so far. */
export interface PendingUserInputDraftAnswer {
  readonly selectedOptionLabels?: ReadonlyArray<string>;
  readonly customAnswer?: string;
}

/** Their own words win over a picked option; a multiple choice answers with every pick. */
function resolvePendingUserInputAnswer(
  question: OrchestrationV2UserInputQuestion,
  draft: PendingUserInputDraftAnswer | undefined,
): string | ReadonlyArray<string> | null {
  const custom = draft?.customAnswer?.trim() ?? "";
  if (custom.length > 0) return custom;
  const picked = (draft?.selectedOptionLabels ?? []).filter((label) =>
    question.options.some((option) => option.label === label),
  );
  if (question.multiSelect === true) return picked.length > 0 ? picked : null;
  return picked[0] ?? null;
}

/** Picks an option, or for a multiple choice adds or removes it; picking clears the person's own words. */
export function togglePendingUserInputOption(
  question: OrchestrationV2UserInputQuestion,
  draft: PendingUserInputDraftAnswer | undefined,
  label: string,
): PendingUserInputDraftAnswer {
  if (question.multiSelect !== true) return { selectedOptionLabels: [label] };
  const picked = draft?.selectedOptionLabels ?? [];
  return {
    selectedOptionLabels: picked.includes(label)
      ? picked.filter((candidate) => candidate !== label)
      : [...picked, label],
  };
}

/** The person's own words; while there are any, no option stays picked. */
export function setPendingUserInputCustomAnswer(
  draft: PendingUserInputDraftAnswer | undefined,
  customAnswer: string,
): PendingUserInputDraftAnswer {
  return customAnswer.trim().length > 0 || draft?.selectedOptionLabels === undefined
    ? { customAnswer }
    : { customAnswer, selectedOptionLabels: draft.selectedOptionLabels };
}

/** The answers `runtime-request.respond` sends, or null until every question has one. */
export function buildPendingUserInputAnswers(
  questions: ReadonlyArray<OrchestrationV2UserInputQuestion>,
  drafts: Readonly<Record<string, PendingUserInputDraftAnswer>>,
): ProviderUserInputAnswers | null {
  const answers: Record<string, string | ReadonlyArray<string>> = {};
  for (const question of questions) {
    const answer = resolvePendingUserInputAnswer(question, drafts[question.id]);
    if (answer === null) return null;
    answers[question.id] = answer;
  }
  return answers;
}
