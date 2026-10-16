const TITLE_SEED_MAX_LENGTH = 50;

/**
 * A new thread's title from its first message, as T3 Code's
 * `deriveThreadTitleSeed` (`packages/client-runtime/src/operations/threadTitle.ts`
 * and `truncate` in `packages/shared/src/String.ts` at 2577baf) makes it:
 * whitespace collapsed, the first 50 characters with an ellipsis after, or
 * "New thread". There are no attachments to fall back on.
 */
export const deriveThreadTitleSeed = (text: string): string => {
  const normalized = text.trim().replace(/\s+/gu, " ");
  if (normalized.length === 0) return "New thread";
  return normalized.length <= TITLE_SEED_MAX_LENGTH
    ? normalized
    : `${normalized.slice(0, TITLE_SEED_MAX_LENGTH)}...`;
};
