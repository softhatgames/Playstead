import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { CommandId } from "@playstead/contracts/baseSchemas";
import {
  decodeProviderReplayNdjson,
  materializeReplayWorkspace,
} from "@playstead/provider-testing/replayTranscript";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import { makeClaudeReplay } from "./Adapters/ClaudeAdapterV2.testkit.ts";
import { makeCodexReplay } from "./Adapters/CodexAdapterV2.testkit.ts";
import { makeTestServerConfig } from "../testUtils/testServer.ts";
import { makeOrchestrationHarness } from "./testkit/OrchestratorHarness.ts";
import {
  awaitPendingApproval,
  CLAUDE_SUPERVISED_SCENARIO,
  CODEX_SUPERVISED_SCENARIO,
  runSupervisedScenario,
  sendSupervisedMessage,
  SUPERVISED_IDS,
} from "./testkit/fixtures/supervisedApproval.ts";

const readRecording = (name: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const file = path.join(
      path.dirname(yield* path.fromFileUrl(new URL(import.meta.url))),
      "testkit",
      "fixtures",
      name,
    );
    return yield* decodeProviderReplayNdjson(yield* fs.readFileString(file));
  });

type HarnessInput = Parameters<typeof makeOrchestrationHarness>[0];

/** Seam 1 with the provider's transport replaying a recording made in the harness's folder. */
const replayed = (
  provider: "Claude" | "Codex",
  name: string,
  options: Pick<HarnessInput, "config" | "recoverOnStartup"> = {},
) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const recorded = yield* readRecording(name);
    if (provider === "Claude") {
      let replay: Effect.Success<ReturnType<typeof makeClaudeReplay>> | undefined;
      const harness = yield* makeOrchestrationHarness({
        ...options,
        claudeRunner: {
          allocateSessionId: Effect.suspend(() => replay!.runner.allocateSessionId),
          open: (input) => Effect.suspend(() => replay!.runner.open(input)),
        },
      });
      replay = yield* makeClaudeReplay(
        yield* materializeReplayWorkspace(recorded, path.join(harness.home, "empty-game")),
      );
      return { harness, assertComplete: replay.assertComplete };
    }
    let replay: Effect.Success<ReturnType<typeof makeCodexReplay>> | undefined;
    const harness = yield* makeOrchestrationHarness({
      ...options,
      codexClients: { open: (input) => Effect.suspend(() => replay!.clients.open(input)) },
    });
    replay = yield* makeCodexReplay(
      yield* materializeReplayWorkspace(recorded, path.join(harness.home, "empty-game")),
    );
    return { harness, assertComplete: replay.assertComplete };
  });

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
            const { harness, assertComplete } = yield* replayed(
              provider.name,
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
            const { harness, assertComplete } = yield* replayed(
              provider.name,
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
          const { harness, assertComplete } = yield* replayed(
            provider.name,
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
            const { harness, assertComplete } = yield* replayed(
              provider.name,
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
        const { harness } = yield* replayed("Claude", "approval_accept.claude.ndjson");
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
          const first = yield* replayed("Claude", "approval_accept.claude.ndjson", { config });
          const { sent } = yield* sendSupervisedMessage(first.harness, CLAUDE_SUPERVISED_SCENARIO);
          const approval = yield* awaitPendingApproval(first.harness, sent.sequence);

          const { harness } = yield* replayed("Claude", "approval_accept.claude.ndjson", {
            config,
            recoverOnStartup: true,
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
