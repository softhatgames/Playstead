import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import { assert, describe, it } from "@effect/vitest";
import type { LocalConnection } from "@playstead/client-runtime/connection";
import { applyThreadStreamItem, type ThreadState } from "@playstead/client-runtime/state/thread";
import {
  CommandId,
  MessageId,
  ProjectId,
  type ThreadId,
  ThreadId as ThreadIdSchema,
} from "@playstead/contracts/baseSchemas";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";

import type { ClaudeAgentSdkQueryRunner } from "./orchestration-v2/Adapters/ClaudeAdapterV2.ts";
import { makeOrchestrationHarness } from "./orchestration-v2/testkit/OrchestratorHarness.ts";
import {
  FILE_CREATE_IDS,
  FILE_CREATE_SCENARIO,
  sendFileCreateMessage,
} from "./orchestration-v2/testkit/fixtures/fileCreate.ts";
import { awaitConnectionState, connectDesktop, connectSignedIn } from "./testUtils/testClient.ts";
import { makeTestServerConfig, startTestServer } from "./testUtils/testServer.ts";

const DESCRIPTOR_PATH = "/.well-known/playstead/environment";

const unreachableClaude: ClaudeAgentSdkQueryRunner["Service"] = {
  allocateSessionId: Effect.die("Claude was not expected to start."),
  open: () => Effect.die("Claude was not expected to start."),
};

/** The thread as a client's thread view folds it, once it matches. */
const awaitThread = (
  connection: LocalConnection,
  threadId: ThreadId,
  matches: (state: ThreadState) => boolean,
) =>
  connection
    .stream((client) => client["orchestration.subscribeThread"]({ threadId }))
    .pipe(
      Stream.scan((): ThreadState | undefined => undefined, applyThreadStreamItem),
      Stream.filter((state): state is ThreadState => state !== undefined && matches(state)),
      Stream.runHead,
      Effect.map(Option.getOrThrow),
    );

describe("Survive a restart, and the same thread in a browser", () => {
  it.layer(
    Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer, NodeSocket.layerWebSocketConstructor),
    { excludeTestServices: true },
  )((it) => {
    it.effect(
      "a run in flight at the stop is settled once the environment descriptor answers",
      () =>
        Effect.gen(function* () {
          const config = yield* makeTestServerConfig();
          yield* Effect.scoped(
            Effect.gen(function* () {
              const stopped = yield* makeOrchestrationHarness({
                claudeRunner: unreachableClaude,
                config,
              });
              yield* sendFileCreateMessage(stopped);
            }),
          );

          const server = yield* startTestServer({ config });
          const client = yield* HttpClient.HttpClient;
          const descriptor = yield* client.get(`${server.baseUrl}${DESCRIPTOR_PATH}`);
          assert.strictEqual(descriptor.status, 200);

          const { connection } = yield* connectSignedIn(server);
          const thread = yield* awaitThread(connection, FILE_CREATE_IDS.threadId, () => true);
          assert.deepStrictEqual(
            thread.projection.runs.map((run) => run.status),
            ["cancelled"],
          );
          assert.deepStrictEqual(
            thread.projection.messages.map((message) => message.text),
            [FILE_CREATE_SCENARIO.prompt],
          );
          const state = yield* awaitConnectionState(
            connection,
            (current) => current.shell !== undefined,
          );
          assert.deepStrictEqual(
            state.shell?.threads.map((shellThread) => [shellThread.id, shellThread.status]),
            [[FILE_CREATE_IDS.threadId, "cancelled"]],
          );
        }).pipe(Effect.scoped),
    );

    it.effect("listens on this computer only, so nothing on another machine can reach it", () =>
      Effect.gen(function* () {
        const server = yield* startTestServer();
        assert.strictEqual(server.listeningOn, "127.0.0.1");
      }).pipe(Effect.scoped),
    );

    it.effect("refuses a second server on the same Playstead home until the first stops", () =>
      Effect.gen(function* () {
        const firstScope = yield* Scope.make();
        const first = yield* startTestServer().pipe(Scope.provide(firstScope));

        const refused = yield* Effect.flip(
          Effect.scoped(startTestServer({ config: first.config })),
        );
        assert.strictEqual(refused._tag, "ServerAlreadyRunningError");
        const client = yield* HttpClient.HttpClient;
        assert.strictEqual((yield* client.get(`${first.baseUrl}${DESCRIPTOR_PATH}`)).status, 200);

        yield* Scope.close(firstScope, Exit.void);
        const restarted = yield* startTestServer({ config: first.config });
        assert.strictEqual(
          (yield* client.get(`${restarted.baseUrl}${DESCRIPTOR_PATH}`)).status,
          200,
        );
      }).pipe(Effect.scoped),
    );

    it.effect("stops at once while a browser is connected, so quitting can restart it", () =>
      Effect.gen(function* () {
        // Effect's HTTP server otherwise waits 20 s for open sockets to
        // close; the connected WebSocket would hold it for all of them.
        const serverScope = yield* Scope.make();
        const server = yield* startTestServer().pipe(Scope.provide(serverScope));
        yield* connectSignedIn(server);

        yield* Scope.close(serverScope, Exit.void).pipe(Effect.timeout("5 seconds"));
      }).pipe(Effect.scoped),
    );

    it.effect("a message sent from the desktop window appears in a paired browser", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const server = yield* startTestServer({ desktopBootstrapToken: "desktop-bootstrap" });
        const desktop = yield* connectDesktop(server, "desktop-bootstrap");
        const { connection: browser } = yield* connectSignedIn(server);
        const folder = path.join(server.config.baseDir, "shared-game");
        yield* fs.makeDirectory(folder);
        const projectId = ProjectId.make("project:shared-game");
        const threadId = ThreadIdSchema.make("thread:shared-game");

        yield* browser.request((rpc) =>
          rpc["projects.mutate"]({
            type: "project.create",
            commandId: CommandId.make("command:shared-game:project"),
            projectId,
            title: "shared-game",
            workspaceRoot: folder,
          }),
        );
        yield* desktop.request((rpc) =>
          rpc["orchestration.dispatchCommand"]({
            type: "thread.create",
            commandId: CommandId.make("command:shared-game:thread"),
            threadId,
            projectId,
            title: "New thread",
            modelSelection: { instanceId: "claudeAgent", model: FILE_CREATE_SCENARIO.model },
          }),
        );
        const seenInBrowser = yield* Effect.forkScoped(
          awaitThread(browser, threadId, (state) =>
            state.projection.messages.some((message) => message.text === "Hello from the desktop"),
          ),
        );
        yield* desktop.request((rpc) =>
          rpc["orchestration.dispatchCommand"]({
            type: "message.dispatch",
            commandId: CommandId.make("command:shared-game:message"),
            threadId,
            messageId: MessageId.make("message:shared-game:1"),
            text: "Hello from the desktop",
          }),
        );

        const thread = yield* Fiber.join(seenInBrowser);
        assert.deepStrictEqual(
          thread.projection.messages.map((message) => [message.role, message.text]),
          [["user", "Hello from the desktop"]],
        );
      }).pipe(Effect.scoped),
    );
  });
});
