/** "Plan ready" above the composer, with the plan's title (T3 Code's `ComposerPlanFollowUpBanner`). */
export function ComposerPlanFollowUpBanner(props: { readonly planTitle: string | null }) {
  return (
    <div
      role="status"
      className="mb-2 flex items-center gap-2 rounded-xl border border-neutral-200 px-3 py-2 text-xs dark:border-neutral-800"
    >
      <span className="shrink-0 font-medium text-neutral-500 dark:text-neutral-400">
        Plan ready
      </span>
      {props.planTitle === null ? null : (
        <span className="min-w-0 flex-1 truncate">{props.planTitle}</span>
      )}
    </div>
  );
}
