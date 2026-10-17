import type { ProviderInteractionMode } from "@playstead/contracts/orchestrationV2";

import { BotIcon, PencilRulerIcon } from "../icons.tsx";

/**
 * Plan or build (T3 Code's interaction-mode control in
 * `ComposerFooterModeControls`, `ChatComposer.tsx` at 2577baf): pressed in
 * plan mode, labelled "Plan" or "Build", its tooltip saying what a click does.
 */
export function InteractionModeToggle(props: {
  readonly mode: ProviderInteractionMode;
  readonly onToggle: () => void;
}) {
  const plan = props.mode === "plan";
  const tooltip = plan
    ? "Plan mode — click to return to normal build mode"
    : "Default mode — click to enter plan mode";
  return (
    <>
      <span aria-hidden="true" className="h-4 w-px bg-neutral-200 dark:bg-neutral-800" />
      <button
        type="button"
        aria-pressed={plan}
        aria-label={tooltip}
        title={tooltip}
        onClick={props.onToggle}
        className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 ${
          plan ? "text-neutral-900 dark:text-neutral-100" : "text-neutral-600 dark:text-neutral-300"
        }`}
      >
        {plan ? <PencilRulerIcon className="size-3.5" /> : <BotIcon className="size-3.5" />}
        <span>{plan ? "Plan" : "Build"}</span>
      </button>
    </>
  );
}
