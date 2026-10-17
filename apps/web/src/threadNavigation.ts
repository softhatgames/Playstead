/** Sidebar navigation follows T3 Code's Sidebar.logic.ts at 2577baf. */
export function threadNavigationTarget(
  orderedIds: ReadonlyArray<string>,
  currentId: string | undefined,
  command: string | null,
): string | null {
  if (command?.startsWith("thread.jump.")) {
    const digit = command.slice("thread.jump.".length);
    return /^[1-9]$/.test(digit) ? (orderedIds[Number(digit) - 1] ?? null) : null;
  }
  if (command !== "thread.previous" && command !== "thread.next") return null;
  const step = command === "thread.next" ? 1 : -1;
  if (currentId === undefined) return (step === 1 ? orderedIds[0] : orderedIds.at(-1)) ?? null;
  const index = orderedIds.indexOf(currentId);
  return index < 0 ? null : (orderedIds[index + step] ?? null);
}

/** New-thread context, following routes/_chat.tsx at 2577baf. */
export function newThreadDestination(input: {
  readonly projectIds: ReadonlyArray<string>;
  readonly preferredProjectIds: ReadonlyArray<string | undefined>;
  readonly legacySidebarEnabled: boolean;
  readonly local: boolean;
  readonly scratchAvailable?: boolean;
  readonly scratchProjectId?: string | undefined;
}):
  | { readonly kind: "scratch" }
  | { readonly kind: "picker" }
  | { readonly kind: "add-project" }
  | { readonly kind: "project"; readonly projectId: string } {
  if (
    !input.local &&
    !input.legacySidebarEnabled &&
    input.projectIds.length +
      (input.scratchAvailable && !input.projectIds.includes(input.scratchProjectId ?? "") ? 1 : 0) >
      1
  )
    return { kind: "picker" };
  const projectId =
    input.preferredProjectIds.find((id) => id !== undefined && input.projectIds.includes(id)) ??
    input.projectIds[0];
  return projectId === undefined
    ? { kind: input.scratchAvailable ? "scratch" : "add-project" }
    : { kind: "project", projectId };
}
