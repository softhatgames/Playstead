/**
 * What a provider reads to retitle a thread, following T3 Code's
 * `packages/provider-core/src/server/threadTitleContext.ts` at 2577baf: the
 * conversation, at most 8000 characters and 2000 per message, with the first
 * user message kept, then the person's messages newest first, then the
 * agent's. A message too long keeps its start and its end. Attachments and
 * citations are absent.
 */

export interface ThreadTitleMessage {
  readonly role: "user" | "assistant";
  readonly text: string;
}

const MAX_CONTEXT = 8_000;
const MAX_MESSAGE = 2_000;
/** Room kept for the newer user messages while older ones are added. */
const RESERVED_FOR_LATER = 2_000;
const SEPARATOR = "\n\n";
export const EARLIER_CONTENT_TRUNCATED = "[Earlier content truncated]\n\n";
const CONTENT_TRUNCATED = "\n[Content truncated]\n";

/** The text cut to `budget` characters, keeping its first and last halves. */
export function limitTitleMessage(text: string, budget: number): string {
  if (text.length <= budget) return text;
  if (budget <= CONTENT_TRUNCATED.length) return "";
  const available = budget - CONTENT_TRUNCATED.length;
  const headLength = Math.ceil(available / 2);
  const tailLength = available - headLength;
  return `${text.slice(0, headLength)}${CONTENT_TRUNCATED}${tailLength > 0 ? text.slice(-tailLength) : ""}`;
}

interface Section {
  readonly index: number;
  readonly role: ThreadTitleMessage["role"];
  readonly label: string;
  readonly contents: string;
}

export function formatThreadTitleContext(messages: ReadonlyArray<ThreadTitleMessage>): {
  readonly message: string;
} {
  const sections: ReadonlyArray<Section> = messages.flatMap((message, index) => {
    const contents = message.text.trim();
    return contents.length === 0
      ? []
      : [{ index, role: message.role, label: `${message.role.toUpperCase()}:\n`, contents }];
  });

  const chosen = new Map<number, string>();
  let remaining = MAX_CONTEXT - EARLIER_CONTENT_TRUNCATED.length;
  const choose = (section: Section, budget: number) => {
    if (chosen.has(section.index)) return;
    const limit = Math.min(budget, remaining) - section.label.length - SEPARATOR.length;
    if (limit <= CONTENT_TRUNCATED.length) return;
    const contents = limitTitleMessage(section.contents, limit);
    if (contents.length === 0) return;
    const text = section.label + contents;
    chosen.set(section.index, text);
    remaining -= text.length + SEPARATOR.length;
  };

  const newestFirst = sections.toReversed();
  const firstUser = sections.find((section) => section.role === "user");
  if (firstUser !== undefined) choose(firstUser, MAX_MESSAGE);
  for (const section of newestFirst) {
    if (section.role === "user") {
      choose(section, Math.min(MAX_MESSAGE, remaining - RESERVED_FOR_LATER));
    }
  }
  for (const section of newestFirst) {
    if (section.role === "assistant") choose(section, MAX_MESSAGE);
  }
  // What room is left lets the chosen messages grow back, the person's first.
  for (const role of ["user", "assistant"] as const) {
    for (const section of newestFirst) {
      const previous = chosen.get(section.index);
      if (section.role !== role || previous === undefined) continue;
      const grown =
        section.label +
        limitTitleMessage(section.contents, previous.length + remaining - section.label.length);
      remaining -= grown.length - previous.length;
      chosen.set(section.index, grown);
    }
  }

  const kept = sections.filter((section) => chosen.has(section.index));
  const cut =
    kept.length < sections.length ||
    kept.some((section) => chosen.get(section.index) !== section.label + section.contents);
  return {
    message: `${cut ? EARLIER_CONTENT_TRUNCATED : ""}${kept
      .map((section) => chosen.get(section.index))
      .join(SEPARATOR)}`,
  };
}
