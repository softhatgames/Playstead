import type { RuntimeRequestId } from "@playstead/contracts/baseSchemas";
import type {
  ProviderApprovalDecision,
  ProviderApprovalOption,
} from "@playstead/contracts/orchestrationV2";
import { useEffect, useRef, useState } from "react";

import { EllipsisIcon, ShieldIcon } from "../icons.tsx";
import {
  approvalDetail,
  approvalDetailLabel,
  approvalHeading,
  type PendingApproval,
  splitApprovalOptions,
} from "./pendingApproval.logic.ts";

const errorMessage = (cause: unknown) =>
  typeof cause === "object" && cause !== null && "message" in cause
    ? String(cause.message)
    : "The decision could not be sent.";

/**
 * The approval the agent waits on, above the composer, after T3 Code's
 * warning banner in `ChatComposer.tsx` with `ComposerPendingApprovalPanel.tsx`
 * and `ComposerPendingApprovalActions.tsx` at 2577baf: a shield, the kind of
 * approval, the app's name, "1/N" when several wait, the provider's prompt,
 * and **Approve** and **Decline**, with the other decisions under "More
 * approval options". The buttons are disabled while a decision is being
 * sent, and when the provider that asked is gone. The turn waiting on it can
 * still be interrupted from the composer.
 */
export function ComposerPendingApprovalPanel(props: {
  readonly approval: PendingApproval;
  readonly pendingCount: number;
  readonly onRespond: (
    requestId: RuntimeRequestId,
    decision: ProviderApprovalDecision,
  ) => Promise<void>;
}) {
  const { approval } = props;
  const [responding, setResponding] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const heading = approvalHeading(approval.requestKind);
  const canRespond = approval.responseCapability === "live" && !responding;
  const { primary, more } = splitApprovalOptions(approval.options);

  const respond = async (decision: ProviderApprovalDecision) => {
    if (!canRespond) return;
    setResponding(true);
    setError(undefined);
    try {
      await props.onRespond(approval.requestId, decision);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setResponding(false);
    }
  };

  return (
    <section
      role="group"
      aria-label={heading}
      className="mb-2 flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950/40"
    >
      <ShieldIcon className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex min-w-0 items-center gap-2 text-xs text-neutral-500 dark:text-neutral-400">
          <span className="shrink-0 font-medium text-amber-800 dark:text-amber-300">{heading}</span>
          {approval.appName === undefined ? null : (
            <span className="min-w-0 truncate">{approval.appName}</span>
          )}
          {props.pendingCount > 1 ? (
            <span className="ml-auto shrink-0 tabular-nums">1/{props.pendingCount}</span>
          ) : null}
        </span>
        <code
          aria-label={approvalDetailLabel(approval.requestKind)}
          tabIndex={0}
          className="block max-h-20 w-full overflow-auto font-mono text-xs whitespace-pre"
        >
          {approvalDetail(approval)}
        </code>
        {error === undefined ? null : (
          <p role="alert" className="text-xs text-red-700 dark:text-red-400">
            {error}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {primary.map((option) => (
          <button
            key={option.decision}
            type="button"
            disabled={!canRespond}
            title={option.warning}
            onClick={() => void respond(option.decision)}
            className={
              option.decision === "accept"
                ? "rounded-full bg-neutral-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-30 dark:bg-neutral-100 dark:text-neutral-900"
                : "rounded-full border border-neutral-300 bg-white px-3 py-1 text-xs disabled:opacity-30 dark:border-neutral-700 dark:bg-neutral-900"
            }
          >
            {option.label}
          </button>
        ))}
        {more.length === 0 ? null : (
          <MoreApprovalOptions
            options={more}
            disabled={!canRespond}
            onChoose={(decision) => void respond(decision)}
          />
        )}
      </div>
    </section>
  );
}

/** T3 Code's "More approval options" menu: the decisions that are not buttons. */
function MoreApprovalOptions(props: {
  readonly options: ReadonlyArray<ProviderApprovalOption>;
  readonly disabled: boolean;
  readonly onChoose: (decision: ProviderApprovalDecision) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label="More approval options"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={props.disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
        className="flex size-6 items-center justify-center rounded-full border border-neutral-300 bg-white disabled:opacity-30 dark:border-neutral-700 dark:bg-neutral-900"
      >
        <EllipsisIcon className="size-3.5" />
      </button>
      {open ? (
        <div
          role="menu"
          className="absolute right-0 bottom-full z-10 mb-1 min-w-32 rounded-md border border-neutral-200 bg-white p-1 shadow-md dark:border-neutral-800 dark:bg-neutral-900"
        >
          {props.options.map((option) => (
            <button
              key={option.decision}
              type="button"
              role="menuitem"
              title={option.warning}
              onClick={() => {
                setOpen(false);
                props.onChoose(option.decision);
              }}
              className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
