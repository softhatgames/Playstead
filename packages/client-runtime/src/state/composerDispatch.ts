/**
 * What the composer does with a message (T3 Code's
 * `packages/client-runtime/src/state/composerDispatch.ts` at 2577baf):
 * while no run is active it starts one (`auto`); while one is, it does the
 * thread's follow-up behaviour, and with Mod held the other one. Playstead
 * has one follow-up behaviour so far, queueing; steering adds the other.
 */

/** The follow-ups a message sent during a run can be, in T3 Code's order. */
export const ACTIVE_TURN_COMPOSER_ACTIONS = ["queue"] as const;
export type ActiveTurnComposerAction = (typeof ACTIVE_TURN_COMPOSER_ACTIONS)[number];
export type ComposerDispatchMode = "auto" | ActiveTurnComposerAction;

/** The follow-up Mod+Enter and Ctrl/⌘-click give instead of `activeTurnDefault`, if there is one. */
export function alternateComposerDispatchAction(
  activeTurnDefault: ActiveTurnComposerAction,
): ActiveTurnComposerAction | undefined {
  return ACTIVE_TURN_COMPOSER_ACTIONS.find((action) => action !== activeTurnDefault);
}

export function resolveComposerDispatchMode(input: {
  readonly running: boolean;
  readonly alternateModifier: boolean;
  readonly activeTurnDefault: ActiveTurnComposerAction;
}): ComposerDispatchMode {
  if (!input.running) return "auto";
  if (!input.alternateModifier) return input.activeTurnDefault;
  return alternateComposerDispatchAction(input.activeTurnDefault) ?? input.activeTurnDefault;
}
