import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/**
 * Provider recordings as NDJSON, after T3 Code's `ProviderReplayTranscript`
 * (`packages/contracts/src/orchestrationV2.ts`) and
 * `packages/provider-testing/src/replayTranscript.ts` at 2577baf. The first
 * line is the header; each later line is a frame the client must send next
 * (`expect_outbound`) or one the provider sends (`emit_inbound`).
 *
 * Unlike T3 Code's header, Playstead's carries the provider's own version
 * and the capture date. Machine paths are written as the `<workspace>`
 * placeholder, which a replay fills with its temporary folder.
 */

export const REPLAY_WORKSPACE_PLACEHOLDER = "<workspace>";

const ProviderReplayTranscriptHeader = Schema.Struct({
  type: Schema.Literal("transcript_start"),
  provider: Schema.String,
  protocol: Schema.String,
  /** The provider's version, as its CLI reports it. */
  version: Schema.String,
  /** When it was recorded, as an ISO date. */
  capturedAt: Schema.String,
  scenario: Schema.String,
  metadata: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});
export type ProviderReplayTranscriptHeader = typeof ProviderReplayTranscriptHeader.Type;

export const ProviderReplayEntry = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("expect_outbound"),
    label: Schema.optionalKey(Schema.String),
    frame: Schema.Unknown,
  }),
  Schema.Struct({
    type: Schema.Literal("emit_inbound"),
    label: Schema.optionalKey(Schema.String),
    frame: Schema.Unknown,
  }),
]);
export type ProviderReplayEntry = typeof ProviderReplayEntry.Type;

export interface ProviderReplayTranscript {
  readonly header: ProviderReplayTranscriptHeader;
  readonly entries: ReadonlyArray<ProviderReplayEntry>;
}

class ProviderReplayNdjsonError extends Schema.TaggedError<ProviderReplayNdjsonError>()(
  "ProviderReplayNdjsonError",
  { line: Schema.Number, detail: Schema.String },
) {
  override get message(): string {
    return `Recording line ${this.line}: ${this.detail}`;
  }
}

const decodeLine = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Unknown));
const decodeHeader = Schema.decodeUnknownEffect(ProviderReplayTranscriptHeader);
const decodeEntry = Schema.decodeUnknownEffect(ProviderReplayEntry);
const encodeLine = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

/** Reads a recording: the header line first, then one entry per line. */
export const decodeProviderReplayNdjson = Effect.fn("decodeProviderReplayNdjson")(function* (
  text: string,
) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) {
    return yield* new ProviderReplayNdjsonError({ line: 1, detail: "The recording is empty." });
  }
  const parse = (line: string, index: number) =>
    decodeLine(line).pipe(
      Effect.mapError(
        (error) => new ProviderReplayNdjsonError({ line: index + 1, detail: error.message }),
      ),
    );
  const header = yield* parse(lines[0]!, 0).pipe(
    Effect.flatMap(decodeHeader),
    Effect.mapError(
      (error) =>
        new ProviderReplayNdjsonError({
          line: 1,
          detail: `The header is missing or wrong: ${error.message}`,
        }),
    ),
  );
  const entries = yield* Effect.forEach(lines.slice(1), (line, index) =>
    parse(line, index + 1).pipe(
      Effect.flatMap(decodeEntry),
      Effect.mapError(
        (error) => new ProviderReplayNdjsonError({ line: index + 2, detail: error.message }),
      ),
    ),
  );
  return { header, entries } satisfies ProviderReplayTranscript;
});

/** Writes a recording as NDJSON, one line per entry after the header. */
export const encodeProviderReplayNdjson = (transcript: ProviderReplayTranscript): string =>
  [transcript.header, ...transcript.entries].map((line) => encodeLine(line)).join("\n") + "\n";

const replaceInStrings = (value: unknown, from: string, to: string): unknown => {
  if (typeof value === "string") return value.split(from).join(to);
  if (Array.isArray(value)) return value.map((item) => replaceInStrings(item, from, to));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, replaceInStrings(item, from, to)]),
    );
  }
  return value;
};

/** Every frame with the workspace placeholder replaced by the replay's folder. */
export const materializeReplayWorkspace = (
  transcript: ProviderReplayTranscript,
  workspace: string,
): ProviderReplayTranscript => ({
  header: transcript.header,
  entries: transcript.entries.map((entry) => ({
    ...entry,
    frame: replaceInStrings(entry.frame, REPLAY_WORKSPACE_PLACEHOLDER, workspace),
  })),
});
