import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { makeOrchestrationHarness } from "./orchestration-v2/testkit/OrchestratorHarness.ts";
import {
  FILE_CREATE_IDS,
  sendFileCreateMessage,
} from "./orchestration-v2/testkit/fixtures/fileCreate.ts";
import { connectSignedIn } from "./testUtils/testClient.ts";
import { makeTestServerConfig, startTestServer } from "./testUtils/testServer.ts";

describe("Thread search RPC", () => {
  it.layer(
    Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer, NodeSocket.layerWebSocketConstructor),
    { excludeTestServices: true },
  )((it) => {
    it.effect("searches persisted messages after restart through the authenticated wire", () =>
      Effect.gen(function* () {
        const config = yield* makeTestServerConfig();
        yield* Effect.scoped(
          Effect.gen(function* () {
            const harness = yield* makeOrchestrationHarness({
              config,
              claudeRunner: {
                allocateSessionId: Effect.succeed("unused"),
                open: () => Effect.die("No provider needed"),
              },
            });
            yield* sendFileCreateMessage(harness);
          }),
        );
        const server = yield* startTestServer({ config });
        const { connection } = yield* connectSignedIn(server);
        for (const input of [
          { query: "x" },
          { query: "   " },
          { query: "x".repeat(201) },
          { query: "hello", limit: 0 },
          { query: "hello", limit: 51 },
          { query: "hello", limit: 1.5 },
        ]) {
          const outcome = yield* Effect.exit(
            connection.request((client) => client["orchestration.searchThreads"](input)),
          );
          assert.strictEqual(outcome._tag, "Failure");
        }
        // Invalid requests do not prevent the next valid search.
        const result = yield* connection.request((client) =>
          client["orchestration.searchThreads"]({ query: "  HELLO-CLAUDE  ", limit: 1 }),
        );
        assert.strictEqual(result.matches.length, 1);
        assert.strictEqual(result.matches[0]?.threadId, FILE_CREATE_IDS.threadId);
        assert.strictEqual(result.matches[0]?.source, "user");
        assert.include(result.matches[0]?.snippet, "hello-claude.txt");
      }).pipe(Effect.scoped),
    );
  });
});
