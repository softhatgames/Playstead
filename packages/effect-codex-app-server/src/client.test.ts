import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import * as CodexReplay from "./replay.ts";

const transcript = (
  entries: CodexReplay.CodexAppServerReplayTranscript["entries"],
): CodexReplay.CodexAppServerReplayTranscript => ({
  provider: "codex",
  protocol: "codex.app-server",
  version: "0.163.0",
  scenario: "server-requests",
  capturedAt: "2026-10-17T00:00:00.000Z",
  entries,
});

const question = {
  isBlocking: true,
  itemId: "item-1",
  threadId: "thread-1",
  turnId: "turn-1",
  questions: [{ header: "Name", id: "q1", question: "What should the file be called?" }],
};

describe("CodexAppServerClient", () => {
  it.effect("answers Codex's requests with their handlers, and others with method not found", () =>
    Effect.gen(function* () {
      const driver = yield* CodexReplay.makeReplayDriver(
        transcript([
          { type: "expect_outbound", frame: { id: 1, method: "account/read", params: {} } },
          {
            type: "emit_inbound",
            frame: { id: 0, method: "item/tool/requestUserInput", params: question },
          },
          {
            type: "expect_outbound",
            frame: { id: 0, result: { answers: { q1: { answers: ["hello.txt"] } } } },
          },
          {
            type: "emit_inbound",
            frame: { id: 7, method: "attestation/generate", params: {} },
          },
          {
            type: "expect_outbound",
            frame: {
              id: 7,
              error: { code: -32601, message: "Method not found: attestation/generate" },
            },
          },
          {
            type: "emit_inbound",
            frame: { id: 1, result: { account: null, requiresOpenaiAuth: true } },
          },
        ]),
      );
      const client = yield* CodexReplay.makeReplayClient(driver);
      const asked: Array<string> = [];
      yield* client.handleServerRequest("item/tool/requestUserInput", (params) =>
        Effect.sync(() => {
          asked.push(...params.questions.map((entry) => entry.question));
          return { answers: { q1: { answers: ["hello.txt"] } } };
        }),
      );

      const account = yield* client.request("account/read", {});

      assert.deepStrictEqual(account, { account: null, requiresOpenaiAuth: true });
      assert.deepStrictEqual(asked, ["What should the file be called?"]);
      yield* driver.assertComplete;
    }).pipe(Effect.scoped),
  );

  it.effect("fails a request Codex answers with an error, naming the method", () =>
    Effect.gen(function* () {
      const driver = yield* CodexReplay.makeReplayDriver(
        transcript([
          { type: "expect_outbound", frame: { id: 1, method: "model/list", params: {} } },
          {
            type: "emit_inbound",
            frame: { id: 1, error: { code: -32600, message: "not signed in" } },
          },
        ]),
      );
      const client = yield* CodexReplay.makeReplayClient(driver);

      const error = yield* Effect.flip(client.request("model/list", {}));

      assert.strictEqual(error.message, "model/list failed: not signed in");
      yield* driver.assertComplete;
    }).pipe(Effect.scoped),
  );

  it.effect("tells when Codex's output has ended, after its last message", () =>
    Effect.gen(function* () {
      const driver = yield* CodexReplay.makeReplayDriver(
        transcript([
          { type: "expect_outbound", frame: { id: 1, method: "account/read", params: {} } },
          {
            type: "emit_inbound",
            frame: { id: 1, result: { account: null, requiresOpenaiAuth: false } },
          },
          {
            type: "emit_inbound",
            frame: { method: "account/updated", params: { authMode: "apikey" } },
          },
          { type: "runtime_exit", status: "success" },
        ]),
      );
      const client = yield* CodexReplay.makeReplayClient(driver);
      const seen: Array<string> = [];
      yield* client.handleServerNotification("account/updated", (params) =>
        Effect.sync(() => seen.push(String(params.authMode))),
      );
      yield* client.request("account/read", {});

      const ended = yield* client.terminated;

      assert.strictEqual(ended._tag, "CodexAppServerProcessExitedError");
      assert.deepStrictEqual(seen, ["apikey"]);
      yield* driver.assertComplete;
    }).pipe(Effect.scoped),
  );
});
