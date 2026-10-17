// @effect-diagnostics preferSchemaOverJson:off -- The fake CLIs' scripts are plain JSON.
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeSocket from "@effect/platform-node/NodeSocket";
import { assert, describe, it } from "@effect/vitest";
import type { LocalConnection } from "@playstead/client-runtime/connection";
import { CommandId, MessageId, ProjectId, ThreadId } from "@playstead/contracts/baseSchemas";
import {
  type ModelSelection,
  ORCHESTRATION_V2_WS_METHODS,
  type OrchestrationV2Command,
  type OrchestrationV2ThreadShell,
} from "@playstead/contracts/orchestrationV2";
import type { ProviderInstanceId } from "@playstead/contracts/providerInstance";
import { WsRpcGroup } from "@playstead/contracts/rpc";
import { DEFAULT_TEXT_GENERATION_MODEL_SELECTION } from "@playstead/contracts/settings";
import { writeFakeCli } from "@playstead/provider-testing/fakeCli";
import { makeTempDirectoryScoped } from "@playstead/shared/tempDirectory";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as FetchHttpClient from "effect/http/FetchHttpClient";

import { awaitConnectionState, connectSignedIn } from "./testUtils/testClient.ts";
import { makeTestServerConfig, startTestServer } from "./testUtils/testServer.ts";

/**
 * Generated titles through the real server, as the interface sees them: a
 * new thread's seed is replaced in the sidebar by the title the **Text
 * generation** provider writes, here a fake `codex exec` or `claude -p`
 * named by each instance's **Binary path**, while the thread's own turn
 * runs (and fails, with no real Claude). Also the setting itself, and the
 * internal completion command no client may send.
 */

const isWindows = process.platform === "win32";

/** A fake `codex` that answers only `codex exec` (and an empty `mcp list`). */
const fakeCodexSource = (title: string) => `
import * as NodeFS from "node:fs";
const args = process.argv.slice(2);
if (args.includes("mcp")) { process.stdout.write("[]"); process.exit(0); }
if (args[0] !== "exec") process.exit(1);
for await (const _ of process.stdin) {}
NodeFS.writeFileSync(args[args.indexOf("--output-last-message") + 1], JSON.stringify({ title: ${JSON.stringify(title)}, needsRefinement: false }));
`;

/** A fake `claude` that answers only `claude -p`. */
const fakeClaudeSource = (title: string) => `
const args = process.argv.slice(2);
if (args[0] !== "-p") process.exit(1);
for await (const _ of process.stdin) {}
process.stdout.write(JSON.stringify({ type: "result", structured_output: { title: ${JSON.stringify(title)}, needsRefinement: false } }));
`;

const setBinaryPath = (
  connection: LocalConnection,
  instanceId: ProviderInstanceId,
  binaryPath: string,
) =>
  connection.request((client) =>
    client["server.updateSettings"]({
      patch: {},
      providerInstanceMutation: {
        operation: "upsert",
        instanceId,
        instance: { driver: instanceId, config: { binaryPath } },
      },
    }),
  );

const setTextGeneration = (connection: LocalConnection, selection: ModelSelection) =>
  connection.request((client) =>
    client["server.updateSettings"]({ patch: { textGenerationModelSelection: selection } }),
  );

describe("generated titles over RPC", () => {
  it.layer(
    Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer, NodeSocket.layerWebSocketConstructor),
    { excludeTestServices: true },
  )((it) => {
    it.effect(
      "a new thread's seed is replaced by Codex's title, and Regenerate title asks Claude once it is chosen",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const bin = yield* makeTempDirectoryScoped("playstead-title-bin-");
          const codex = yield* writeFakeCli({
            directory: bin,
            name: "codex",
            source: fakeCodexSource("Moon level jump height"),
          });
          const claude = yield* writeFakeCli({
            directory: bin,
            name: "claude",
            source: fakeClaudeSource("Lunar gravity tuning"),
          });
          const server = yield* startTestServer({
            providerEnvironment: {
              PATH: path.dirname(process.execPath),
              ...(isWindows
                ? { PATHEXT: ".COM;.EXE;.BAT;.CMD", SystemRoot: process.env.SystemRoot }
                : {}),
            },
          });
          const { connection } = yield* connectSignedIn(server);
          yield* setBinaryPath(connection, "codex", codex);
          const folder = path.join(server.config.baseDir, "moon-game");
          yield* fs.makeDirectory(folder);
          const projectId = ProjectId.make("project:moon-game");
          const threadId = ThreadId.make("thread:moon");
          const dispatch = (command: OrchestrationV2Command) =>
            connection.request((client) => client["orchestration.dispatchCommand"](command));
          const sidebarThread = (matches: (thread: OrchestrationV2ThreadShell) => boolean) =>
            Effect.map(
              awaitConnectionState(connection, (state) =>
                (state.shell?.threads ?? []).some(
                  (thread) => thread.id === threadId && matches(thread),
                ),
              ),
              (state) => state.shell!.threads.find((thread) => thread.id === threadId)!,
            );

          yield* connection.request((client) =>
            client["projects.mutate"]({
              type: "project.create",
              commandId: CommandId.make("command:moon-game"),
              projectId,
              title: "moon-game",
              workspaceRoot: folder,
            }),
          );
          yield* dispatch({
            type: "thread.create",
            runtimeMode: "full-access",
            commandId: CommandId.make("command:create"),
            threadId,
            projectId,
            title: "New thread",
            modelSelection: { instanceId: "claudeAgent", model: "claude-haiku-5-5" },
          });
          yield* dispatch({
            type: "message.dispatch",
            dispatchMode: { type: "start_immediately" },
            commandId: CommandId.make("command:message"),
            threadId,
            messageId: MessageId.make("message:moon:1"),
            text: "Make the player jump higher on the moon level",
            titleSeed: "Make the player jump higher on the moon level",
          });
          const titled = yield* sidebarThread(
            (thread) => thread.title === "Moon level jump height",
          );
          assert.isNull(titled.titleRegeneration);

          yield* setBinaryPath(connection, "claudeAgent", claude);
          yield* setTextGeneration(connection, {
            instanceId: "claudeAgent",
            model: "claude-haiku-5-5",
          });
          yield* dispatch({
            type: "thread.metadata.update",
            commandId: CommandId.make("command:regenerate"),
            threadId,
            regenerateTitle: true,
          });
          const regenerated = yield* sidebarThread(
            (thread) => thread.title === "Lunar gravity tuning",
          );
          assert.isNull(regenerated.titleRegeneration);
        }).pipe(Effect.scoped),
    );

    it.effect("the Text generation setting is saved, sent to clients, and defaults to Codex", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const server = yield* startTestServer();
        const { connection } = yield* connectSignedIn(server);
        const initial = yield* awaitConnectionState(
          connection,
          (state) => state.config !== undefined,
        );
        assert.deepStrictEqual(
          initial.config?.settings.textGenerationModelSelection,
          DEFAULT_TEXT_GENERATION_MODEL_SELECTION,
        );

        const claudeHaiku: ModelSelection = {
          instanceId: "claudeAgent",
          model: "claude-haiku-5-5",
          options: [{ id: "effort", value: "low" }],
        };
        const settings = yield* setTextGeneration(connection, claudeHaiku);
        assert.deepStrictEqual(settings, {
          providerInstances: {},
          textGenerationModelSelection: claudeHaiku,
          defaultRuntimeMode: "full-access",
          sidebarAutoSettleAfterDays: 3,
        });
        yield* awaitConnectionState(
          connection,
          (state) =>
            state.config?.settings.textGenerationModelSelection.instanceId === "claudeAgent",
        );
        assert.deepStrictEqual(
          JSON.parse(yield* fs.readFileString(server.config.settingsPath)),
          settings,
        );
      }).pipe(Effect.scoped),
    );

    it.effect("settings saved before the setting existed read as T3 Code's default", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const config = yield* makeTestServerConfig();
        yield* fs.makeDirectory(path.dirname(config.settingsPath), { recursive: true });
        yield* fs.writeFileString(
          config.settingsPath,
          JSON.stringify({
            providerInstances: { codex: { driver: "codex", config: { binaryPath: "my-codex" } } },
          }),
        );
        const server = yield* startTestServer({ config });
        const { connection } = yield* connectSignedIn(server);
        const state = yield* awaitConnectionState(
          connection,
          (state) => state.config !== undefined,
        );
        assert.deepStrictEqual(state.config?.settings, {
          providerInstances: { codex: { driver: "codex", config: { binaryPath: "my-codex" } } },
          textGenerationModelSelection: DEFAULT_TEXT_GENERATION_MODEL_SELECTION,
          defaultRuntimeMode: "full-access",
          sidebarAutoSettleAfterDays: 3,
        });
      }).pipe(Effect.scoped),
    );

    it.effect("no client can send the internal title completion", () =>
      Effect.sync(() => {
        const dispatchCommand = WsRpcGroup.requests.get(
          ORCHESTRATION_V2_WS_METHODS.dispatchCommand,
        )!;
        const decode = Schema.decodeUnknownExit(dispatchCommand.payloadSchema);
        const base = { commandId: "command:forged", threadId: "thread:any" };
        assert.isTrue(
          Exit.isFailure(
            decode({
              ...base,
              type: "thread.title.regeneration.complete",
              requestId: "command:any",
              title: "Forged",
            }),
          ),
        );
        assert.isTrue(
          Exit.isSuccess(
            decode({ ...base, type: "thread.metadata.update", regenerateTitle: true }),
          ),
        );
      }),
    );
  });
});
