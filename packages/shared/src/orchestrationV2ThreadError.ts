/**
 * Which of a thread's runs ran last (T3 Code's `latestExecutedRun` and
 * `runRanAfter` in `packages/shared/src/orchestrationV2ThreadError.ts` at
 * 2577baf, the module's only part Playstead needs so far; its thread error
 * summaries are not here yet). Typed by shape, as the contracts depend on
 * this package.
 */
interface RunShape {
  readonly ordinal: number;
  readonly status: string;
  readonly startedAt: string | null;
  /** An ISO time, which orders as text. */
  readonly completedAt: string | null;
}

/**
 * Ordinals follow submission, but a run can start ahead of a held queue (a
 * message sent while the queue is held), so a queued run resumed later can
 * have a lower ordinal than one that already ended. An unfinished run is
 * the latest.
 */
function runRanAfter(run: RunShape, other: RunShape): boolean {
  if (run.completedAt === other.completedAt) return run.ordinal > other.ordinal;
  if (run.completedAt === null) return true;
  if (other.completedAt === null) return false;
  return run.completedAt > other.completedAt;
}

/** The run that ran last, leaving out queued runs and those removed before they started. */
export function latestExecutedRun<Run extends RunShape>(runs: ReadonlyArray<Run>): Run | undefined {
  let latest: Run | undefined;
  for (const run of runs) {
    if (run.status === "queued") continue;
    if (run.status === "cancelled" && run.startedAt === null) continue;
    if (latest === undefined || runRanAfter(run, latest)) latest = run;
  }
  return latest;
}
