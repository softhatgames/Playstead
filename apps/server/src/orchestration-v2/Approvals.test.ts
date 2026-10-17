import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { CommandId } from "@playstead/contracts/baseSchemas";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import { makeTestServerConfig } from "../testUtils/testServer.ts";
import { makeOrchestrationHarness } from "./testkit/OrchestratorHarness.ts";
import { replayClaude, replayProvider } from "./testkit/ProviderReplay.ts";
import {
  awaitPendingApproval,
  CLAUDE_SUPERVISED_SCENARIO,
  CODEX_SUPERVISED_SCENARIO,
  runSupervisedScenario,
  sendSupervisedMessage,
  SUPERVISED_IDS,
} from "./testkit/fixtures/supervisedApproval.ts";
import {
  runSessionApprovalScenario,
  SESSION_APPROVAL_IDS,
  SESSION_APPROVAL_SCENARIOS,
  type SessionApprovalScenarioName,
} from "./testkit/fixtures/sessionApprovals.ts";

type Harness = Effect.Success<ReturnType<typeof makeOrchestrationHarness>>;

const projectionOf = (harness: Harness) =>
  Effect.map(harness.orchestrator.getThreadProjection(SUPERVISED_IDS.threadId), Option.getOrThrow);

/**
 * The content the provider wrote to the file, as its completed file change
 * says: a replay writes nothing, and the recorder checked the disk.
 */
const writtenContent = (harness: Harness, name: string) =>
  Effect.map(projectionOf(harness), (projection) => {
    const change = projection.turnItems.find(
      (item) =>
        item.type === "file_change" && item.fileName.endsWith(name) && item.status === "completed",
    );
    return change?.type === "file_change" ? (change.newStr ?? "") : undefined;
  });

const PROVIDERS = [
  { name: "Claude", scenario: CLAUDE_SUPERVISED_SCENARIO, file: "claude" },
  { name: "Codex", scenario: CODEX_SUPERVISED_SCENARIO, file: "codex" },
] as const;

describe("Approvals in Supervised", () => {
  it.layer(NodeServices.layer)((it) => {
    for (const provider of PROVIDERS) {
      it.effect(
        `${provider.name}: the change waits for the person's approval, and happens once approved`,
        () =>
          Effect.gen(function* () {
            const { harness, assertComplete } = yield* replayProvider(
              provider.file,
              `approval_accept.${provider.file}.ndjson`,
            );

            const { approvals, run } = yield* runSupervisedScenario(
              harness,
              provider.scenario,
              "accept",
            );

            yield* assertComplete;
            assert.strictEqual(run.status, "completed");
            assert.isAtLeast(approvals.length, 1);
            assert.strictEqual(approvals[0]?.kind, "file-change");
            const projection = yield* projectionOf(harness);
            for (const approval of approvals) {
              const request = projection.runtimeRequests.find(
                (candidate) => candidate.id === approval.id,
              );
              assert.strictEqual(request?.status, "resolved");
              assert.strictEqual(request?.decision, "accept");
              const item = projection.turnItems.find(
                (candidate) =>
                  candidate.type === "approval_request" && candidate.requestId === approval.id,
              );
              assert.strictEqual(item?.status, "completed");
              assert.strictEqual(
                projection.nodes.find((node) => node.id === approval.nodeId)?.status,
                "completed",
              );
            }
            const content = yield* writtenContent(harness, provider.scenario.fileName);
            assert.strictEqual(content?.trim(), provider.scenario.content);
          }).pipe(Effect.scoped),
      );

      it.effect(
        `${provider.name}: a declined change never happens, and the agent is told and goes on`,
        () =>
          Effect.gen(function* () {
            const { harness, assertComplete } = yield* replayProvider(
              provider.file,
              `approval_decline.${provider.file}.ndjson`,
            );

            const { approvals, run } = yield* runSupervisedScenario(
              harness,
              provider.scenario,
              "decline",
            );

            yield* assertComplete;
            assert.strictEqual(run.status, "completed");
            assert.isAtLeast(approvals.length, 1);
            const projection = yield* projectionOf(harness);
            for (const approval of approvals) {
              const request = projection.runtimeRequests.find(
                (candidate) => candidate.id === approval.id,
              );
              assert.strictEqual(request?.decision, "decline");
              const item = projection.turnItems.find(
                (candidate) =>
                  candidate.type === "approval_request" && candidate.requestId === approval.id,
              );
              assert.strictEqual(item?.status, "cancelled");
            }
            assert.isTrue(
              projection.turnItems.some(
                (item) => item.type === "assistant_message" && item.text.trim().length > 0,
              ),
            );
            assert.isUndefined(yield* writtenContent(harness, provider.scenario.fileName));
          }).pipe(Effect.scoped),
      );

      it.effect(`${provider.name}: Cancel stops the turn, and the change never happens`, () =>
        Effect.gen(function* () {
          const { harness, assertComplete } = yield* replayProvider(
            provider.file,
            `approval_cancel.${provider.file}.ndjson`,
          );

          const { approvals, run } = yield* runSupervisedScenario(
            harness,
            provider.scenario,
            "cancel",
          );

          yield* assertComplete;
          assert.strictEqual(run.status, "interrupted");
          assert.strictEqual(approvals.length, 1);
          const projection = yield* projectionOf(harness);
          assert.strictEqual(projection.runtimeRequests[0]?.decision, "cancel");
          assert.isUndefined(yield* writtenContent(harness, provider.scenario.fileName));
        }).pipe(Effect.scoped),
      );

      it.effect(
        `${provider.name}: interrupting a turn waiting on an approval clears the approval`,
        () =>
          Effect.gen(function* () {
            const { harness, assertComplete } = yield* replayProvider(
              provider.file,
              `approval_interrupt.${provider.file}.ndjson`,
            );

            const { approvals, run } = yield* runSupervisedScenario(
              harness,
              provider.scenario,
              "interrupt",
            );

            yield* assertComplete;
            assert.strictEqual(run.status, "interrupted");
            const projection = yield* projectionOf(harness);
            assert.deepStrictEqual(
              projection.runtimeRequests.map((request) => [request.id, request.status]),
              approvals.map((approval) => [approval.id, "cancelled"]),
            );
            assert.isTrue(
              projection.turnItems
                .filter((item) => item.type === "approval_request")
                .every((item) => item.status === "cancelled"),
            );
            assert.isUndefined(yield* writtenContent(harness, provider.scenario.fileName));

            // Nothing is left waiting: the approval cannot be answered.
            const late = yield* Effect.flip(
              harness.orchestrator.dispatch({
                type: "runtime-request.respond",
                commandId: CommandId.make("command:supervised:late"),
                threadId: SUPERVISED_IDS.threadId,
                requestId: approvals[0]!.id,
                decision: "accept",
              }),
            );
            assert.strictEqual(late.message, `Runtime request ${approvals[0]!.id} is cancelled.`);
          }).pipe(Effect.scoped),
      );
    }

    it.effect("an approval is refused without a decision, or with answers instead", () =>
      Effect.gen(function* () {
        const { harness } = yield* replayClaude("approval_accept.claude.ndjson");
        const { sent } = yield* sendSupervisedMessage(harness, CLAUDE_SUPERVISED_SCENARIO);
        const approval = yield* awaitPendingApproval(harness, sent.sequence);

        const noDecision = yield* Effect.flip(
          harness.orchestrator.dispatch({
            type: "runtime-request.respond",
            commandId: CommandId.make("command:supervised:no-decision"),
            threadId: SUPERVISED_IDS.threadId,
            requestId: approval.id,
            answers: { anything: "Blue" },
          }),
        );
        assert.strictEqual(
          noDecision.message,
          `Runtime request ${approval.id} needs an approval decision.`,
        );
        const projection = yield* projectionOf(harness);
        assert.strictEqual(projection.runtimeRequests[0]?.status, "pending");
      }).pipe(Effect.scoped),
    );

    it.effect(
      "an approval pending when the server stops has expired after the restart, and cannot be answered",
      () =>
        Effect.gen(function* () {
          // The first server stops (is left behind) while Claude waits on the decision.
          const config = yield* makeTestServerConfig();
          const first = yield* replayClaude("approval_accept.claude.ndjson", {
            harness: { config },
          });
          const { sent } = yield* sendSupervisedMessage(first.harness, CLAUDE_SUPERVISED_SCENARIO);
          const approval = yield* awaitPendingApproval(first.harness, sent.sequence);

          const { harness } = yield* replayClaude("approval_accept.claude.ndjson", {
            harness: { config, recoverOnStartup: true },
          });
          const projection = yield* projectionOf(harness);
          const request = projection.runtimeRequests.find(
            (candidate) => candidate.id === approval.id,
          );
          assert.strictEqual(request?.status, "expired");
          assert.strictEqual(request?.responseCapability.type, "not_resumable");
          assert.strictEqual(
            projection.turnItems.find(
              (candidate) =>
                candidate.type === "approval_request" && candidate.requestId === approval.id,
            )?.status,
            "cancelled",
          );

          const late = yield* Effect.flip(
            harness.orchestrator.dispatch({
              type: "runtime-request.respond",
              commandId: CommandId.make("command:supervised:after-restart"),
              threadId: SUPERVISED_IDS.threadId,
              requestId: approval.id,
              decision: "accept",
            }),
          );
          assert.strictEqual(late.message, `Runtime request ${approval.id} is expired.`);
        }).pipe(Effect.scoped),
    );
  });
});

describe("Auto-accept edits and approvals for the session", () => {
  const sessionProjection = (harness: Harness) =>
    Effect.map(
      harness.orchestrator.getThreadProjection(SESSION_APPROVAL_IDS.threadId),
      Option.getOrThrow,
    );

  /** The scenario over its recording, and each turn's approvals by kind. */
  const replaySession = (
    provider: (typeof PROVIDERS)[number],
    name: SessionApprovalScenarioName,
    firstAnswer?: "acceptAlways",
  ) =>
    Effect.gen(function* () {
      const { harness, assertComplete } = yield* replayProvider(
        provider.file,
        `${name}.${provider.file}.ndjson`,
      );
      const recorded = SESSION_APPROVAL_SCENARIOS[provider.file][name];
      const scenario =
        firstAnswer === undefined
          ? recorded
          : {
              ...recorded,
              turns: recorded.turns.map((turn, index) =>
                index === 0 ? { ...turn, answer: firstAnswer } : turn,
              ),
            };
      const { turns } = yield* runSessionApprovalScenario(harness, scenario);
      yield* assertComplete;
      for (const turn of turns) assert.strictEqual(turn.run.status, "completed");
      return {
        harness,
        turns,
        asked: turns.map((turn) => turn.approvals.map((approval) => approval.kind)),
      };
    });

  /** The completed items of one kind in a turn's run. */
  const completedItems = (
    harness: Harness,
    runId: string,
    type: "file_change" | "command_execution",
  ) =>
    Effect.map(sessionProjection(harness), (projection) =>
      projection.turnItems.filter(
        (item) => item.runId === runId && item.type === type && item.status === "completed",
      ),
    );

  it.layer(NodeServices.layer)((it) => {
    for (const provider of PROVIDERS) {
      it.effect(
        `${provider.name}: in Auto-accept edits a file is written without asking, and a command asks`,
        () =>
          Effect.gen(function* () {
            const { harness, turns, asked } = yield* replaySession(provider, "auto_accept_edits");

            assert.deepStrictEqual(asked, [["command"]]);
            const edits = yield* completedItems(harness, turns[0]!.run.id, "file_change");
            assert.isAtLeast(edits.length, 1);
            const projection = yield* sessionProjection(harness);
            assert.strictEqual(projection.runtimeRequests[0]?.decision, "accept");
            assert.strictEqual(projection.runtimeRequests[0]?.status, "resolved");
          }).pipe(Effect.scoped),
      );

      it.effect(
        `${provider.name}: Always allow this session stops later commands asking; after a mode change they ask until allowed again`,
        () =>
          Effect.gen(function* () {
            const { harness, turns, asked } = yield* replaySession(provider, "session_command");

            assert.deepStrictEqual(asked, [["command"], [], ["command"], []]);
            // The turns that did not ask ran their commands.
            for (const turn of [turns[1]!, turns[3]!]) {
              const ran = yield* completedItems(harness, turn.run.id, "command_execution");
              assert.isAtLeast(ran.length, 1);
            }
            const projection = yield* sessionProjection(harness);
            assert.deepStrictEqual(
              projection.runtimeRequests.map((request) => request.decision),
              ["acceptForSession", "acceptForSession"],
            );
          }).pipe(Effect.scoped),
      );

      it.effect(
        `${provider.name}: an approval to always allow is answered as an approval for the session`,
        () =>
          Effect.gen(function* () {
            // The adapter must answer the provider exactly as it did for
            // acceptForSession, or the replay fails at that frame.
            const { harness, asked } = yield* replaySession(
              provider,
              "session_command",
              "acceptAlways",
            );

            assert.deepStrictEqual(asked, [["command"], [], ["command"], []]);
            const projection = yield* sessionProjection(harness);
            assert.strictEqual(projection.runtimeRequests[0]?.decision, "acceptAlways");
            assert.strictEqual(projection.runtimeRequests[0]?.status, "resolved");
          }).pipe(Effect.scoped),
      );
    }

    it.effect(
      "Codex: an edit approved for the session lets every later edit of the session run without asking",
      () =>
        Effect.gen(function* () {
          const { harness, turns, asked } = yield* replaySession(PROVIDERS[1], "session_edits");

          assert.deepStrictEqual(asked, [["file-change"], []]);
          const later = yield* completedItems(harness, turns[1]!.run.id, "file_change");
          assert.isAtLeast(later.length, 1);
        }).pipe(Effect.scoped),
    );

    it.effect(
      "Claude: an edit approved for the session lets the turn's later edits run, and the next turn asks again, as T3 Code puts Claude Code back in Supervised",
      () =>
        Effect.gen(function* () {
          const { harness, turns, asked } = yield* replaySession(PROVIDERS[0], "session_edits");

          assert.deepStrictEqual(asked, [["file-change"], ["file-change"]]);
          // Both files of the first turn were written, one approval for them.
          const first = yield* completedItems(harness, turns[0]!.run.id, "file_change");
          assert.strictEqual(first.length, 2);
        }).pipe(Effect.scoped),
    );
  });
});
