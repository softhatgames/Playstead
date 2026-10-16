import { CommandId, NonNegativeInt, ProjectId } from "@playstead/contracts/baseSchemas";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";

export class CommandReceiptStoreError extends Schema.TaggedError<CommandReceiptStoreError>()(
  "CommandReceiptStoreError",
  { commandId: CommandId, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Failed to read or write the receipt of command ${this.commandId}.`;
  }
}

const CommandReceiptStatus = Schema.Literals(["accepted", "rejected"]);
export type CommandReceiptStatus = typeof CommandReceiptStatus.Type;

/**
 * What a command did, kept by its id so a retried command gets the first
 * outcome again: accepted with the sequence it reached, or rejected with why.
 */
export const ProjectCommandReceiptV2 = Schema.Struct({
  commandId: CommandId,
  projectId: ProjectId,
  commandType: Schema.String,
  acceptedAt: Schema.DateTimeUtc,
  resultSequence: NonNegativeInt,
  status: CommandReceiptStatus,
  error: Schema.NullOr(Schema.String),
});
export type ProjectCommandReceiptV2 = typeof ProjectCommandReceiptV2.Type;

/**
 * Command receipts in `orchestration_command_receipts`, one table for project
 * and thread commands told apart by `aggregate_kind` (T3 Code's
 * `apps/server/src/orchestration-v2/CommandReceiptStore.ts` and
 * `apps/server/src/persistence/OrchestrationCommandReceipts.ts` at 2577baf).
 * Thread receipts join with the orchestration core.
 */
export class CommandReceiptStoreV2 extends Context.Service<
  CommandReceiptStoreV2,
  {
    /** False when a receipt with this command id is already there. */
    readonly insertIfAbsent: (
      receipt: ProjectCommandReceiptV2,
    ) => Effect.Effect<boolean, CommandReceiptStoreError>;
    readonly upsert: (
      receipt: ProjectCommandReceiptV2,
    ) => Effect.Effect<void, CommandReceiptStoreError>;
    /** None when the id is unused or belongs to a thread command. */
    readonly getProjectByCommandId: (
      commandId: CommandId,
    ) => Effect.Effect<Option.Option<ProjectCommandReceiptV2>, CommandReceiptStoreError>;
  }
>()("@playstead/server/orchestration-v2/CommandReceiptStore/CommandReceiptStoreV2") {}

const decodeProjectReceipt = Schema.decodeUnknownEffect(
  ProjectCommandReceiptV2.mapFields((fields) => ({
    ...fields,
    acceptedAt: Schema.DateTimeUtcFromString,
  })),
);

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const toError = (commandId: CommandId) => (cause: unknown) =>
    new CommandReceiptStoreError({ commandId, cause });

  const insert = (receipt: ProjectCommandReceiptV2, onConflict: "ignore" | "replace") =>
    sql<{ readonly commandId: string }>`
      INSERT INTO orchestration_command_receipts (
        command_id,
        aggregate_kind,
        aggregate_id,
        command_type,
        accepted_at,
        result_sequence,
        status,
        error
      )
      VALUES (
        ${receipt.commandId},
        'project',
        ${receipt.projectId},
        ${receipt.commandType},
        ${DateTime.formatIso(receipt.acceptedAt)},
        ${receipt.resultSequence},
        ${receipt.status},
        ${receipt.error}
      )
      ${
        onConflict === "ignore"
          ? sql`ON CONFLICT (command_id) DO NOTHING`
          : sql`ON CONFLICT (command_id) DO UPDATE SET
              aggregate_kind = excluded.aggregate_kind,
              aggregate_id = excluded.aggregate_id,
              command_type = excluded.command_type,
              accepted_at = excluded.accepted_at,
              result_sequence = excluded.result_sequence,
              status = excluded.status,
              error = excluded.error`
      }
      RETURNING command_id AS "commandId"
    `;

  return CommandReceiptStoreV2.of({
    insertIfAbsent: (receipt) =>
      insert(receipt, "ignore").pipe(
        Effect.map((rows) => rows.length === 1),
        Effect.mapError(toError(receipt.commandId)),
      ),
    upsert: (receipt) =>
      insert(receipt, "replace").pipe(Effect.asVoid, Effect.mapError(toError(receipt.commandId))),
    getProjectByCommandId: (commandId) =>
      sql`
        SELECT
          command_id AS "commandId",
          aggregate_id AS "projectId",
          command_type AS "commandType",
          accepted_at AS "acceptedAt",
          result_sequence AS "resultSequence",
          status,
          error
        FROM orchestration_command_receipts
        WHERE command_id = ${commandId} AND aggregate_kind = 'project'
      `.pipe(
        Effect.flatMap((rows) =>
          rows[0] === undefined ? Effect.succeedNone : Effect.asSome(decodeProjectReceipt(rows[0])),
        ),
        Effect.mapError(toError(commandId)),
      ),
  });
});

export const layer = Layer.effect(CommandReceiptStoreV2, make);
