import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { EARLIER_CONTENT_TRUNCATED, limitTitleMessage } from "./threadTitleContext.ts";

/**
 * Playstead's own prompts for thread titles, written after T3 Code's
 * `INITIAL_THREAD_TITLE_PROMPT`, `regenerateThreadTitlePrompt` and
 * `buildThreadTitlePrompt` (`packages/provider-core/src/server/textGenerationPrompts.ts`
 * at 2577baf): the same steps and limits, without the rules for linked pull
 * requests, Git history and attachments, which Playstead does not have.
 */

const MAX_TITLE_MESSAGE_CHARS = 8_000;

// The two prompts share their editorial rules; change them together.
const FIRST_TITLE_PROMPT = `Write a short title for a new Playstead thread, so the person can find it again weeks from now. Playstead threads are conversations with a coding agent, usually about making a game.
Answer with JSON holding two keys: title and needsRefinement.
Set needsRefinement to true only when the message does not say what it is about yet, such as "fix this" with nothing else. Otherwise set it to false.

First, without writing it down, work out:
- The subject: which game, system, feature or problem the message is really about.
- The outcome: what the person wants to understand, build or change.
- The incidental instructions: anything that only says how the agent should work.

Title the subject and the outcome, and leave the incidental instructions out.

Rules for the title:
- 3 to 8 words, under 40 characters.
- A compact noun phrase or a clear action phrase.
- When the message lists several symptoms or steps, name the goal they share.
- Name the change to the game or the program, not the plan, mockup or report used to get there.
- Leave out models, agents, tools, output formats and monitoring instructions unless they are the topic.
- For a review, name what is reviewed and the concern. For research, name the question, not the research.
- Do not say the work is done.
- Do not copy the message and cut it short.
- No project names the interface already shows, no quotes, labels, filler or closing punctuation.`;

const regenerateTitlePrompt = (previousTitle: string) =>
  `Write a new title for an existing Playstead thread, so the person can find it again weeks from now. Playstead threads are conversations with a coding agent, usually about making a game.
The previous title was ${JSON.stringify(previousTitle)}.
Answer with JSON holding two keys: title and needsRefinement. Set needsRefinement to false.

Work the title out in this order:
1. Read the USER messages first and find the latest goal that lasts. The first subject stays the subject until the person clearly changes what the thread is about.
2. Use the ASSISTANT messages to make vague references concrete, such as the code or feature they found. Do not make one of the agent's findings the subject unless the person takes it up as a new goal.
3. Compare that subject with the previous title. Keep words that still describe the scope, above all when earlier content was cut. Replace the previous title when it is generic, names an artifact, reports progress, or no longer matches the thread.
4. Title the lasting subject and the outcome wanted, not where the work stands now.

Rules for the title:
- 3 to 8 words, under 40 characters.
- A compact noun phrase or a clear action phrase.
- Keep the overall subject when later messages narrow to one finding, platform or detail.
- A thread that moves from research to planning, building, testing and review has usually kept its subject.
- Leave out deliverables and steps such as mockups, plans, tests and builds unless they are the topic.
- Leave out models, agents, tools, output formats and monitoring instructions unless they are the topic.
- Treat closing follow-ups and the agent's summaries of finished work as weak evidence of the subject.
- For a review, name the reviewed feature or system and its lasting concern. For research, name the question, not the research.
- Do not say the work is done.
- Do not copy a message and cut it short.
- No project names the interface already shows, no quotes, labels, filler or closing punctuation.
- Keep the previous title exactly when it is still accurate. Otherwise give a clearly better title, not the same one reworded.`;

/** A regenerate's context, cut to its last 8000 characters and marked once. */
function keepMessageEnd(message: string): string {
  const marked = message.startsWith(EARLIER_CONTENT_TRUNCATED);
  const contents = marked ? message.slice(EARLIER_CONTENT_TRUNCATED.length) : message;
  if (!marked && contents.length <= MAX_TITLE_MESSAGE_CHARS) return contents;
  return `${EARLIER_CONTENT_TRUNCATED}${contents.slice(-MAX_TITLE_MESSAGE_CHARS)}`;
}

/** The structured answer: the title, and whether the subject is still unknown. */
const ThreadTitleOutput = Schema.Struct({
  title: Schema.String,
  needsRefinement: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
});

/**
 * The prompt and output schema for a title: a first title from the first
 * message, at most 8000 characters with its start and end kept, or with
 * `previousTitle` a regenerate from the conversation, keeping its end.
 */
export function buildThreadTitlePrompt(input: {
  readonly message: string;
  readonly previousTitle?: string | undefined;
}) {
  const prompt =
    input.previousTitle === undefined
      ? `${FIRST_TITLE_PROMPT}\n\nUser message:\n${limitTitleMessage(input.message, MAX_TITLE_MESSAGE_CHARS)}`
      : `${regenerateTitlePrompt(input.previousTitle)}\n\nThread contents:\n${keepMessageEnd(input.message)}`;
  return { prompt, outputSchema: ThreadTitleOutput };
}
