/**
 * What the composer does with a message (T3 Code's
 * `packages/client-runtime/src/state/composerDispatch.ts` at 2577baf,
 * without `restart`): while no run is active it starts one (`auto`); while
 * one is, it does the thread's follow-up behaviour, queueing or steering,
 * and with Mod held the other one.
 */

/** The follow-ups a message sent during a run can be, in T3 Code's order. */
export const ACTIVE_TURN_COMPOSER_ACTIONS = ["queue", "steer"] as const;
export type ActiveTurnComposerAction = (typeof ACTIVE_TURN_COMPOSER_ACTIONS)[number];
export type ComposerDispatchMode = "auto" | ActiveTurnComposerAction;

/** The follow-up Mod+Enter and Ctrl/⌘-click give instead of `activeTurnDefault`. */
export function alternateComposerDispatchAction(
  activeTurnDefault: ActiveTurnComposerAction,
): ActiveTurnComposerAction {
  return activeTurnDefault === "queue" ? "steer" : "queue";
}

export function resolveComposerDispatchMode(input: {
  readonly running: boolean;
  readonly alternateModifier: boolean;
  readonly activeTurnDefault: ActiveTurnComposerAction;
}): ComposerDispatchMode {
  if (!input.running) return "auto";
  return input.alternateModifier
    ? alternateComposerDispatchAction(input.activeTurnDefault)
    : input.activeTurnDefault;
}
