import type { ModelSelection } from "@playstead/contracts/orchestrationV2";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * Text a provider writes for Playstead outside a thread's turn, following
 * T3 Code's `ProviderTextGeneration`
 * (`packages/provider-core/src/server/textGeneration.ts` at 2577baf). Only
 * thread titles are here: T3 Code's commit messages, pull request content,
 * branch names and review guides belong to version control and pull
 * requests, which are absent. So are attachments, policies and the linked
 * source control context.
 */

export class TextGenerationError extends Schema.TaggedError<TextGenerationError>()(
  "TextGenerationError",
  {
    operation: Schema.String,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Text generation failed in ${this.operation}: ${this.detail}`;
  }
}

export interface ThreadTitleGenerationInput {
  /** Where the provider runs: the thread's project folder. */
  readonly cwd: string;
  /** The first message, or for a regenerate the conversation's context. */
  readonly message: string;
  /** Set for a regenerate: the title the thread has now. */
  readonly previousTitle?: string | undefined;
  readonly modelSelection: ModelSelection;
}

export interface ThreadTitleGenerationResult {
  readonly title: string;
  /** The subject is still unknown, as for "fix this" (T3 Code's flag). */
  readonly needsRefinement?: boolean | undefined;
}

export interface ProviderTextGeneration {
  readonly generateThreadTitle: (
    input: ThreadTitleGenerationInput,
  ) => Effect.Effect<ThreadTitleGenerationResult, TextGenerationError>;
}
