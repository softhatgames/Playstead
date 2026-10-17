/**
 * What becomes of a queued message's edit when the message stops being
 * queued before it is saved: it started, or was removed (T3 Code's
 * `recoverQueuedMessageEdit` in `apps/web/src/components/chat/queuedMessageEdit.ts`
 * at 2577baf, without attachments). A changed edit moves into the composer
 * when nothing was typed there before the edit began; otherwise it is
 * discarded and the composer gets back what was typed.
 */
export function recoverQueuedMessageEdit(input: {
  readonly editText: string;
  readonly originalText: string;
  /** What the composer held before the edit began. */
  readonly threadText: string;
}): { readonly outcome: "kept" | "discarded" | "clean"; readonly text: string } {
  const dirty = input.editText !== input.originalText;
  if (dirty && input.threadText.trim().length === 0) {
    return { outcome: "kept", text: input.editText };
  }
  return { outcome: dirty ? "discarded" : "clean", text: input.threadText };
}
