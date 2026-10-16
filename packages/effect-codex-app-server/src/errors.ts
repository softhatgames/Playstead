import * as Schema from "effect/Schema";

/**
 * What can go wrong talking to `codex app-server`, trimmed from T3 Code's
 * `packages/effect-codex-app-server/src/errors.ts` at 2577baf.
 */

/** `codex app-server` could not be started. */
export class CodexAppServerSpawnError extends Schema.TaggedError<CodexAppServerSpawnError>()(
  "CodexAppServerSpawnError",
  { command: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not start ${this.command}: ${String(this.cause)}`;
  }
}

/** Codex's output ended: the process exited, with its exit code and the end of its error output. */
export class CodexAppServerProcessExitedError extends Schema.TaggedError<CodexAppServerProcessExitedError>()(
  "CodexAppServerProcessExitedError",
  { code: Schema.NullOr(Schema.Number), stderr: Schema.String },
) {
  override get message(): string {
    return `codex app-server exited (code ${this.code ?? "unknown"})`;
  }
}

/** Codex wrote something that isn't a JSON-RPC message, or the transport failed. */
export class CodexAppServerProtocolError extends Schema.TaggedError<CodexAppServerProtocolError>()(
  "CodexAppServerProtocolError",
  { detail: Schema.String },
) {
  override get message(): string {
    return this.detail;
  }
}

/** A request's params or result don't match Codex's schema. */
export class CodexAppServerPayloadError extends Schema.TaggedError<CodexAppServerPayloadError>()(
  "CodexAppServerPayloadError",
  { method: Schema.String, operation: Schema.Literals(["encode", "decode"]), issue: Schema.String },
) {
  override get message(): string {
    return `${this.method}: could not ${this.operation} the payload: ${this.issue}`;
  }
}

const METHOD_NOT_FOUND = -32601;
const INTERNAL_ERROR = -32603;

/** A JSON-RPC error answer, from Codex to a request, or from a handler to Codex. */
export class CodexAppServerRequestError extends Schema.TaggedError<CodexAppServerRequestError>()(
  "CodexAppServerRequestError",
  {
    method: Schema.String,
    code: Schema.Number,
    detail: Schema.String,
    data: Schema.optionalKey(Schema.Unknown),
  },
) {
  override get message(): string {
    return `${this.method} failed: ${this.detail}`;
  }

  static methodNotFound(method: string) {
    return new CodexAppServerRequestError({
      method,
      code: METHOD_NOT_FOUND,
      detail: `Method not found: ${method}`,
    });
  }

  static internal(method: string, detail: string) {
    return new CodexAppServerRequestError({ method, code: INTERNAL_ERROR, detail });
  }

  toJsonRpc() {
    return {
      code: this.code,
      message: this.detail,
      ...(this.data === undefined ? {} : { data: this.data }),
    };
  }
}

export type CodexAppServerError =
  | CodexAppServerSpawnError
  | CodexAppServerProcessExitedError
  | CodexAppServerProtocolError
  | CodexAppServerPayloadError
  | CodexAppServerRequestError;
