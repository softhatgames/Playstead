import type { ModelSelection } from "@playstead/contracts/orchestrationV2";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export class TextGenerationError extends Schema.TaggedError<TextGenerationError>()(
  "TextGenerationError",
  {
    detail: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}
export interface ThreadTitleInput {
  readonly cwd: string;
  readonly message: string;
  readonly previousTitle?: string;
  readonly modelSelection: ModelSelection;
}
export interface ProviderTextGeneration {
  readonly generateThreadTitle: (
    input: ThreadTitleInput,
  ) => Effect.Effect<{ readonly title: string }, TextGenerationError>;
}
