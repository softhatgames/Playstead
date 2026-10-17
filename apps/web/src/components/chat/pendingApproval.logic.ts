import type { RuntimeRequestId } from "@playstead/contracts/baseSchemas";
import type {
  OrchestrationV2RuntimeRequest,
  OrchestrationV2TurnItem,
  ProviderApprovalOption,
  ProviderRequestKind,
} from "@playstead/contracts/orchestrationV2";

/**
 * The approval panel's logic, after T3 Code's `derivePendingThreadRequests`
 * (`packages/client-runtime/src/state/threadRequests.ts`) and
 * `ComposerPendingApprovalPanel.tsx` / `ComposerPendingApprovalActions.tsx`
 * (`apps/web/src/components/chat/`) at 2577baf.
 */

export interface PendingApproval {
  readonly requestId: RuntimeRequestId;
  readonly requestKind: ProviderRequestKind;
  /** The provider's prompt: the command, the files, or its reason. */
  readonly detail?: string;
  readonly appName?: string;
  readonly options?: ReadonlyArray<ProviderApprovalOption>;
  /** `not_resumable` once the provider that asked is gone. */
  readonly responseCapability: "live" | "not_resumable";
}

/** The approvals still waiting on the person, oldest first, each with its item's prompt. */
export function derivePendingApprovals(
  runtimeRequests: ReadonlyArray<OrchestrationV2RuntimeRequest>,
  turnItems: ReadonlyArray<OrchestrationV2TurnItem>,
): ReadonlyArray<PendingApproval> {
  return runtimeRequests.flatMap((request): ReadonlyArray<PendingApproval> => {
    if (request.status !== "pending" || request.kind === "user_input") return [];
    const item = turnItems.findLast(
      (candidate) => candidate.type === "approval_request" && candidate.requestId === request.id,
    );
    const approval = item?.type === "approval_request" ? item : undefined;
    return [
      {
        requestId: request.id,
        requestKind: request.kind,
        ...(approval?.prompt ? { detail: approval.prompt } : {}),
        ...(approval?.appName ? { appName: approval.appName } : {}),
        ...(approval?.options === undefined ? {} : { options: approval.options }),
        responseCapability: request.responseCapability.type === "live" ? "live" : "not_resumable",
      },
    ];
  });
}

/** What the panel calls each kind of approval. */
export function approvalHeading(kind: ProviderRequestKind): string {
  switch (kind) {
    case "command":
      return "Command approval";
    case "file-read":
      return "File read approval";
    case "file-change":
      return "File change approval";
    case "permission":
      return "App permission approval";
    case "mcp-elicitation":
      return "App access approval";
  }
}

/** What the detail is, for a screen reader. */
export function approvalDetailLabel(kind: ProviderRequestKind): string {
  switch (kind) {
    case "command":
      return "Command";
    case "file-read":
      return "File to read";
    case "file-change":
      return "File change";
    case "permission":
      return "Permission request";
    case "mcp-elicitation":
      return "App access request";
  }
}

/** The panel's detail: the prompt, the kind of approval without one, or that nobody can answer it. */
export function approvalDetail(approval: PendingApproval): string {
  if (approval.responseCapability === "not_resumable") {
    return "Provider process is gone — interrupt or restart the run to respond.";
  }
  return approval.detail || approvalHeading(approval.requestKind);
}

/**
 * The decisions the panel offers when the provider gives none, in T3 Code's
 * order. T3 Code also offers **Always allow this session**
 * (`acceptForSession`); it comes with the session's approvals.
 */
const DEFAULT_APPROVAL_OPTIONS: ReadonlyArray<ProviderApprovalOption> = [
  { decision: "cancel", label: "Cancel" },
  { decision: "decline", label: "Decline" },
  { decision: "accept", label: "Approve" },
];

/** Approve and Decline are buttons; every other decision goes in the "More approval options" menu. */
export function splitApprovalOptions(options: ReadonlyArray<ProviderApprovalOption> | undefined): {
  readonly primary: ReadonlyArray<ProviderApprovalOption>;
  readonly more: ReadonlyArray<ProviderApprovalOption>;
} {
  const all = options ?? DEFAULT_APPROVAL_OPTIONS;
  const isPrimary = (option: ProviderApprovalOption) =>
    option.decision === "decline" || option.decision === "accept";
  return { primary: all.filter(isPrimary), more: all.filter((option) => !isPrimary(option)) };
}
