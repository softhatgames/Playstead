import * as Schema from "effect/Schema";

export class PersistenceError extends Schema.TaggedError<PersistenceError>()("PersistenceError", {
  operation: Schema.String,
  cause: Schema.Defect(),
}) {
  override get message(): string {
    return `Database operation '${this.operation}' failed.`;
  }
}

export const toPersistenceError = (operation: string) => (cause: unknown) =>
  new PersistenceError({ operation, cause });
