import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { TextGenerationError } from "./textGeneration.ts";

/**
 * The helpers each provider's text generation shares, following T3 Code's
 * `packages/provider-core/src/server/textGenerationUtils.ts` at 2577baf,
 * kept to what thread titles need.
 */

/** A schema as the JSON Schema object a provider's structured output takes. */
export function toJsonSchemaObject(schema: Schema.Top): unknown {
  const document = Schema.toJsonSchemaDocument(Schema.toType(schema), {
    onExcessProperty: "error",
  });
  return document.definitions && Object.keys(document.definitions).length > 0
    ? { ...document.schema, $defs: document.definitions }
    : document.schema;
}

const MAX_THREAD_TITLE_CHARS = 120;
const ELLIPSIS = "...";
const decodeJsonTitle = Schema.decodeOption(
  Schema.fromJsonString(Schema.Struct({ title: Schema.String })),
);

/**
 * The title as the sidebar shows it: a JSON object's `title` unwrapped, its
 * first line, without wrapping quotes or backticks, spaces collapsed;
 * "New thread" when nothing is left, and at most 120 characters, ending in
 * "..." when cut.
 */
export function sanitizeThreadTitle(raw: string): string {
  const title = Option.getOrElse(
    Option.map(decodeJsonTitle(raw), (decoded) => decoded.title),
    () => raw,
  );
  const line = (title.trim().split(/\r?\n/g)[0] ?? "")
    .trim()
    .replace(/^['"`]+|['"`]+$/g, "")
    .trim()
    .replace(/\s+/g, " ");
  if (line.length === 0) return "New thread";
  if (line.length <= MAX_THREAD_TITLE_CHARS) return line;
  return `${line.slice(0, MAX_THREAD_TITLE_CHARS - ELLIPSIS.length).trimEnd()}${ELLIPSIS}`;
}

const isTextGenerationError = Schema.is(TextGenerationError);

const cliLabel = (cliName: string) =>
  `${cliName.charAt(0).toUpperCase()}${cliName.slice(1)} CLI (\`${cliName}\`)`;

/**
 * A failure to start or read a provider's CLI as a `TextGenerationError`; a
 * missing command says so by name (T3 Code's `normalizeCliError`).
 */
export function normalizeCliError(
  cliName: string,
  operation: string,
  error: unknown,
  fallback: string,
): TextGenerationError {
  if (isTextGenerationError(error)) return error;
  if (error instanceof Error) {
    const lower = error.message.toLowerCase();
    if (
      error.message.includes(`Command not found: ${cliName}`) ||
      lower.includes(`spawn ${cliName}`) ||
      lower.includes("enoent")
    ) {
      return new TextGenerationError({
        operation,
        detail: `${cliLabel(cliName)} is required but not available on PATH.`,
        cause: error,
      });
    }
  }
  return new TextGenerationError({ operation, detail: fallback, cause: error });
}
