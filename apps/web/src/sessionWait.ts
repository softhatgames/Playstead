/**
 * Whether the page's session checks are waiting for the server, so the view
 * shown while a route loads can say it is reconnecting instead of staying
 * blank.
 */
export const makeSessionWait = () => {
  let waitingChecks = 0;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  return {
    isWaiting: () => waitingChecks > 0,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Runs a check, counted as waiting from its first unanswered try until it settles. */
    track: <A>(check: (onWaiting: () => void) => Promise<A>): Promise<A> => {
      let waited = false;
      const onWaiting = () => {
        if (waited) return;
        waited = true;
        waitingChecks += 1;
        notify();
      };
      return check(onWaiting).finally(() => {
        if (!waited) return;
        waitingChecks -= 1;
        notify();
      });
    },
  };
};

/** What the page says while it loads, before and after the server failed to answer. */
export const describeSessionWait = (waiting: boolean) =>
  waiting ? "Can't reach the server. Reconnecting…" : "Connecting to the server…";
