import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

import * as CodexClient from "./client.ts";
import * as CodexReplay from "./replay.ts";

/**
 * The replay driver stands in for Codex's stdio under the real client. These
 * recordings are written by hand from Codex 0.163.0's schema.
 */

const initializeParams = {
  clientInfo: { name: "playstead", title: "Playstead", version: "0.0.0" },
  capabilities: { experimentalApi: true },
};

const transcript = (
  entries: CodexReplay.CodexAppServerReplayTranscript["entries"],
): CodexReplay.CodexAppServerReplayTranscript => ({
  provider: "codex",
  protocol: "codex.app-server",
  version: "0.163.0",
  scenario: "status",
  capturedAt: "2026-10-17T00:00:00.000Z",
  entries,
});

const statusEntries: CodexReplay.CodexAppServerReplayTranscript["entries"] = [
  {
    type: "expect_outbound",
    frame: {
      id: 1,
      method: "initialize",
      // The version changes with every Playstead release, so replays ignore it.
      params: {
        ...initializeParams,
        clientInfo: { ...initializeParams.clientInfo, version: "9.9.9" },
      },
    },
  },
  {
    type: "emit_inbound",
    frame: {
      id: 1,
      result: {
        userAgent: "Playstead/0.163.0 (Mac OS 26.6.2; arm64) unknown (playstead; 0.0.0)",
        codexHome: "/home/replay-user/.codex",
        platformFamily: "unix",
        platformOs: "macos",
      },
    },
  },
  { type: "expect_outbound", frame: { method: "initialized" } },
  { type: "expect_outbound", frame: { id: 2, method: "account/read", params: {} } },
  {
    type: "emit_inbound",
    frame: { method: "account/updated", params: { authMode: "chatgpt", planType: "plus" } },
  },
  {
    type: "emit_inbound",
    frame: {
      id: 2,
      result: {
        account: { type: "chatgpt", email: "person@example.com", planType: "plus" },
        requiresOpenaiAuth: true,
      },
    },
  },
];

/** What a status check sends: initialize, initialized, account/read. */
const readStatus = (client: CodexClient.CodexAppServerClient["Service"]) =>
  Effect.gen(function* () {
    const initialize = yield* client.request("initialize", initializeParams);
    yield* client.notify("initialized", undefined);
    const account = yield* client.request("account/read", {});
    return { initialize, account };
  });

describe("Codex app-server replay", () => {
  it.effect("answers the real client's requests from a recording, and is complete", () =>
    Effect.gen(function* () {
      const driver = yield* CodexReplay.makeReplayDriver(transcript(statusEntries));
      const client = yield* CodexReplay.makeReplayClient(driver);
      const notified: Array<unknown> = [];
      yield* client.handleServerNotification("account/updated", (params) =>
        Effect.sync(() => notified.push(params)),
      );

      const { initialize, account } = yield* readStatus(client);

      assert.strictEqual(initialize.platformOs, "macos");
      assert.deepStrictEqual(account, {
        account: { type: "chatgpt", email: "person@example.com", planType: "plus" },
        requiresOpenaiAuth: true,
      });
      assert.deepStrictEqual(notified, [{ authMode: "chatgpt", planType: "plus" }]);
      yield* driver.assertComplete;
    }).pipe(Effect.scoped),
  );

  it.effect("fails when part of the recording goes unused", () =>
    Effect.gen(function* () {
      const driver = yield* CodexReplay.makeReplayDriver(
        transcript([
          ...statusEntries,
          { type: "expect_outbound", frame: { id: 3, method: "model/list", params: {} } },
          { type: "emit_inbound", frame: { id: 3, result: { data: [], nextCursor: null } } },
        ]),
      );
      const client = yield* CodexReplay.makeReplayClient(driver);
      yield* readStatus(client);

      const error = yield* Effect.flip(driver.assertComplete);

      assert.strictEqual(error._tag, "CodexAppServerReplayIncompleteError");
      assert.deepInclude(error, { scenario: "status", cursor: 6, remaining: 2 });
    }).pipe(Effect.scoped),
  );

  it.effect("fails the scope that used it when the recording is not used up", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.gen(function* () {
        const driver = yield* CodexReplay.makeReplayDriver(transcript(statusEntries));
        const client = yield* CodexReplay.makeReplayClient(driver);
        yield* client.request("initialize", initializeParams);
      }).pipe(Effect.scoped, Effect.exit);

      assert.isTrue(Exit.isFailure(exit));
      assert.include(String(exit), "CodexAppServerReplayIncompleteError");
    }),
  );

  it.effect("ignores a recording's clean exit at its end", () =>
    Effect.gen(function* () {
      const driver = yield* CodexReplay.makeReplayDriver(
        transcript([...statusEntries, { type: "runtime_exit", status: "success" }]),
      );
      const client = yield* CodexReplay.makeReplayClient(driver);
      yield* readStatus(client);

      yield* driver.assertComplete;
    }).pipe(Effect.scoped),
  );

  it.effect("fails a request that differs from the recording, and says how", () =>
    Effect.gen(function* () {
      const driver = yield* CodexReplay.makeReplayDriver(transcript(statusEntries));
      const client = yield* CodexReplay.makeReplayClient(driver);

      const requestError = yield* Effect.flip(
        client.request("initialize", { ...initializeParams, capabilities: null }),
      );
      const replayError = yield* Effect.flip(driver.assertComplete);

      assert.include(requestError.message, "did not match the recording at entry 0");
      assert.strictEqual(replayError._tag, "CodexAppServerReplayFrameMismatchError");
    }).pipe(Effect.scoped),
  );
});
