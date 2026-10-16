import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { lintFixture } from "../test/lintFixture.ts";

const rule = "playstead/namespace-node-imports";

describe(rule, () => {
  it.layer(NodeServices.layer)((it) => {
    it.effect("accepts Node built-ins imported as their canonical namespace", () =>
      Effect.gen(function* () {
        const result = yield* lintFixture(
          rule,
          `
            import * as NodeFS from "node:fs";
            import * as NodeFSP from "node:fs/promises";
            import * as NodeChildProcess from "node:child_process";
            import * as NodeTimersPromises from "node:timers/promises";
            import type * as NodeStream from "node:stream";

            export const read = NodeFS.readFileSync;
            export const readAsync = NodeFSP.readFile;
            export const spawn = NodeChildProcess.spawn;
            export const wait = NodeTimersPromises.setTimeout;
            export type Input = NodeStream.Readable;
          `,
        );
        assert.strictEqual(result.exitCode, 0, result.output);
      }),
    );

    it.effect("ignores packages that are not Node built-ins", () =>
      Effect.gen(function* () {
        const result = yield* lintFixture(
          rule,
          `
            import { defineConfig } from "vite-plus";
            export default defineConfig({});
          `,
        );
        assert.strictEqual(result.exitCode, 0, result.output);
      }),
    );

    it.effect("reports named and default imports with the expected namespace", () =>
      Effect.gen(function* () {
        const result = yield* lintFixture(
          rule,
          `
            import { readFile } from "node:fs/promises";
            import path from "node:path";
            export const values = [readFile, path];
          `,
        );
        assert.notStrictEqual(result.exitCode, 0);
        assert.include(result.output, "namespace named NodeFSP");
        assert.include(result.output, "namespace named NodePath");
      }),
    );

    it.effect("reports namespaces under another name", () =>
      Effect.gen(function* () {
        const result = yield* lintFixture(
          rule,
          `
            import * as Crypto from "node:crypto";
            import * as NodeOs from "node:os";
            export const values = [Crypto, NodeOs];
          `,
        );
        assert.notStrictEqual(result.exitCode, 0);
        assert.include(result.output, "namespace named NodeCrypto");
        assert.include(result.output, "namespace named NodeOS");
      }),
    );
  });
});
