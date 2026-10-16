import * as NodeServices from "@effect/platform-node/NodeServices";
import { writeFakeClaude, writeFakeCodex } from "@playstead/provider-testing/fakeProviders";
import * as HostProcess from "@playstead/shared/hostProcess";
import { assert, describe, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import type { ProviderInstanceId } from "@playstead/contracts/providerInstance";
import type { ServerProviders } from "@playstead/contracts/server";

import * as ServerConfig from "../config.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ProviderRegistry from "./ProviderRegistry.ts";

/**
 * Seam 2: provider discovery at the provider registry, with real processes
 * started from fake CLIs on a temporary PATH or through **Binary path**.
 */

const isWindows = process.platform === "win32";

/** A temporary folder, removed with retries, since Windows holds files a moment after they close. */
const makeTempDirectory = (prefix: string) =>
  Effect.acquireRelease(
    Effect.flatMap(FileSystem.FileSystem, (fs) => fs.makeTempDirectory({ prefix })),
    (directory) =>
      Effect.flatMap(FileSystem.FileSystem, (fs) => fs.remove(directory, { recursive: true })).pipe(
        Effect.retry({ times: 10 }),
        Effect.ignore,
      ),
  );

/**
 * The registry over a temporary home, with PATH holding only the given
 * folders and Node's, so the fakes' launchers can start `node`.
 */
const startRegistry = (pathDirectories: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const home = yield* makeTempDirectory("playstead-providers-");
    const paths = yield* ServerConfig.deriveServerPaths(home, undefined);
    const environment: Record<string, string | undefined> = {
      PATH: [...pathDirectories, path.dirname(process.execPath)].join(isWindows ? ";" : ":"),
      ...(isWindows ? { PATHEXT: ".COM;.EXE;.BAT;.CMD", SystemRoot: process.env.SystemRoot } : {}),
    };
    const context = yield* Layer.build(
      ProviderRegistry.layer.pipe(
        Layer.provideMerge(ServerSettings.layer),
        Layer.provide(
          ServerConfig.layer({
            cwd: home,
            baseDir: home,
            ...paths,
            port: 0,
            devUrl: undefined,
            staticDir: undefined,
            desktopBootstrapToken: undefined,
          }),
        ),
        Layer.provide(Layer.succeed(HostProcess.Environment, environment)),
      ),
    );
    return {
      registry: Context.get(context, ProviderRegistry.ProviderRegistry),
      settings: Context.get(context, ServerSettings.ServerSettingsService),
    };
  });

/** Waits for the registry's statuses to match, without sleeping. */
const awaitProviders = (
  registry: ProviderRegistry.ProviderRegistry["Service"],
  matches: (providers: ServerProviders) => boolean,
) =>
  registry.streamChanges.pipe(
    Stream.filter(matches),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  );

const providerById = (providers: ServerProviders, instanceId: ProviderInstanceId) =>
  providers.find((provider) => provider.instanceId === instanceId);

describe("ProviderRegistry", () => {
  // A real clock, so a probe that hangs times out instead of hanging the test.
  it.layer(NodeServices.layer, { excludeTestServices: true })((it) => {
    it.effect("finds Codex and Claude on PATH and reports their versions", () =>
      Effect.gen(function* () {
        const bin = yield* makeTempDirectory("playstead-bin-");
        yield* writeFakeCodex({ directory: bin, version: "0.160.0" });
        yield* writeFakeClaude({ directory: bin, version: "2.1.301" });
        const { registry } = yield* startRegistry([bin]);

        const providers = yield* registry.refresh();

        assert.deepInclude(providerById(providers, "codex"), {
          driver: "codex",
          displayName: "Codex",
          installed: true,
          version: "0.160.0",
          status: "ready",
        });
        assert.deepInclude(providerById(providers, "claudeAgent"), {
          driver: "claudeAgent",
          displayName: "Claude",
          installed: true,
          version: "2.1.301",
          status: "ready",
        });
      }).pipe(Effect.scoped),
    );

    it.effect("reports a provider missing from PATH as not found", () =>
      Effect.gen(function* () {
        const emptyBin = yield* makeTempDirectory("playstead-bin-");
        const { registry } = yield* startRegistry([emptyBin]);

        const providers = yield* registry.refresh();

        assert.deepInclude(providerById(providers, "codex"), {
          installed: false,
          version: null,
          status: "error",
          message:
            "Could not start Codex CLI (`codex`). Check Settings → Providers → Codex → Binary path on the server. Installing ChatGPT or Codex desktop may not add codex to PATH.",
        });
        assert.deepInclude(providerById(providers, "claudeAgent"), {
          installed: false,
          version: null,
          status: "error",
          message: "Claude Agent CLI (`claude`) was not found on PATH.",
        });
        assert.notProperty(providerById(providers, "codex"), "compatibilityAdvisory");
      }).pipe(Effect.scoped),
    );

    it.effect("warns when a found provider is older than the supported range", () =>
      Effect.gen(function* () {
        const bin = yield* makeTempDirectory("playstead-bin-");
        yield* writeFakeCodex({ directory: bin, version: "0.150.0" });
        yield* writeFakeClaude({ directory: bin, version: "2.1.200" });
        const { registry } = yield* startRegistry([bin]);

        const providers = yield* registry.refresh();

        assert.deepInclude(providerById(providers, "codex"), {
          installed: true,
          version: "0.150.0",
          compatibilityAdvisory: {
            status: "unsupported",
            message:
              "This provider version is outside the supported range for this Playstead release. Use >=0.159.0.",
            recommendedVersion: null,
            recommendedRange: ">=0.159.0",
          },
        });
        assert.deepInclude(providerById(providers, "claudeAgent"), {
          installed: true,
          version: "2.1.200",
          compatibilityAdvisory: {
            status: "graceful",
            message:
              "This provider version has limited compatibility with this Playstead release. Use >=2.1.280.",
            recommendedVersion: null,
            recommendedRange: ">=2.1.280",
          },
        });
      }).pipe(Effect.scoped),
    );

    it.effect("accepts the oldest supported versions without a warning", () =>
      Effect.gen(function* () {
        const bin = yield* makeTempDirectory("playstead-bin-");
        yield* writeFakeCodex({ directory: bin, version: "0.156.0" });
        yield* writeFakeClaude({ directory: bin, version: "2.1.280" });
        const { registry } = yield* startRegistry([bin]);

        const providers = yield* registry.refresh();

        assert.deepInclude(providerById(providers, "codex"), {
          compatibilityAdvisory: {
            status: "supported",
            message: null,
            recommendedVersion: null,
            recommendedRange: ">=0.159.0",
          },
        });
        assert.deepInclude(providerById(providers, "claudeAgent"), {
          compatibilityAdvisory: {
            status: "supported",
            message: null,
            recommendedVersion: null,
            recommendedRange: ">=2.1.280",
          },
        });
      }).pipe(Effect.scoped),
    );

    it.effect("uses Binary path over PATH, and checks again when it changes", () =>
      Effect.gen(function* () {
        const pathBin = yield* makeTempDirectory("playstead-bin-");
        const ownBin = yield* makeTempDirectory("playstead-own-");
        yield* writeFakeCodex({ directory: pathBin, version: "0.157.0" });
        const ownCodex = yield* writeFakeCodex({ directory: ownBin, version: "0.161.0" });
        const { registry, settings } = yield* startRegistry([pathBin]);
        assert.deepInclude(providerById(yield* registry.refresh("codex"), "codex"), {
          version: "0.157.0",
        });

        yield* settings.updateProviderInstance({
          operation: "upsert",
          instanceId: "codex",
          instance: { driver: "codex", config: { binaryPath: ownCodex } },
        });
        const updated = yield* awaitProviders(
          registry,
          (providers) => providerById(providers, "codex")?.version === "0.161.0",
        );

        assert.deepInclude(providerById(updated, "codex"), {
          installed: true,
          version: "0.161.0",
          status: "ready",
        });
      }).pipe(Effect.scoped),
    );

    it.effect("reads a signed-in Codex's account and models over its app-server", () =>
      Effect.gen(function* () {
        const bin = yield* makeTempDirectory("playstead-bin-");
        yield* writeFakeCodex({
          directory: bin,
          version: "0.163.0",
          account: { type: "chatgpt", email: "person@example.com", planType: "plus" },
          // More than one page: the fake answers two models at a time.
          models: [
            { model: "gpt-6.1-sol", displayName: "GPT-6.1-Sol", isDefault: true },
            { model: "gpt-6-astra", displayName: "GPT-6-Astra" },
            { model: "gpt-6-luna", displayName: "GPT-6-Luna" },
          ],
        });
        const { registry } = yield* startRegistry([bin]);

        const providers = yield* registry.refresh("codex");

        assert.deepInclude(providerById(providers, "codex"), {
          installed: true,
          version: "0.163.0",
          status: "ready",
          auth: {
            status: "authenticated",
            type: "chatgpt",
            label: "ChatGPT Plus Subscription",
            email: "person@example.com",
          },
          models: [
            { slug: "gpt-6.1-sol", name: "GPT-6.1-Sol", isDefault: true },
            { slug: "gpt-6-astra", name: "GPT-6-Astra" },
            { slug: "gpt-6-luna", name: "GPT-6-Luna" },
          ],
        });
        assert.notProperty(providerById(providers, "codex"), "message");
      }).pipe(Effect.scoped),
    );

    it.effect("labels a Codex signed in with an API key, without an e-mail", () =>
      Effect.gen(function* () {
        const bin = yield* makeTempDirectory("playstead-bin-");
        yield* writeFakeCodex({ directory: bin, version: "0.163.0", account: { type: "apiKey" } });
        const { registry } = yield* startRegistry([bin]);

        const providers = yield* registry.refresh("codex");

        assert.deepInclude(providerById(providers, "codex"), {
          status: "ready",
          auth: { status: "authenticated", type: "apiKey", label: "OpenAI API Key" },
        });
      }).pipe(Effect.scoped),
    );

    it.effect("says a signed-out Codex needs `codex login`, with no models", () =>
      Effect.gen(function* () {
        const bin = yield* makeTempDirectory("playstead-bin-");
        yield* writeFakeCodex({ directory: bin, version: "0.163.0", account: null });
        const { registry } = yield* startRegistry([bin]);

        const providers = yield* registry.refresh("codex");

        assert.deepInclude(providerById(providers, "codex"), {
          installed: true,
          version: "0.163.0",
          status: "error",
          auth: { status: "unauthenticated" },
          message: "Codex CLI is not authenticated. Run `codex login` and try again.",
          models: [],
        });
      }).pipe(Effect.scoped),
    );

    it.effect("finds a provider installed after the server started when refreshed", () =>
      Effect.gen(function* () {
        const bin = yield* makeTempDirectory("playstead-bin-");
        const { registry } = yield* startRegistry([bin]);
        assert.deepInclude(providerById(yield* registry.refresh("claudeAgent"), "claudeAgent"), {
          installed: false,
        });

        yield* writeFakeClaude({ directory: bin, version: "2.1.301" });
        const providers = yield* registry.refresh("claudeAgent");

        assert.deepInclude(providerById(providers, "claudeAgent"), {
          installed: true,
          version: "2.1.301",
          status: "ready",
        });
      }).pipe(Effect.scoped),
    );
  });
});
