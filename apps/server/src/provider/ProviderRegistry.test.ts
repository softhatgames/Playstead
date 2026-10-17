import * as NodeServices from "@effect/platform-node/NodeServices";
import { writeFakeClaude, writeFakeCodex } from "@playstead/provider-testing/fakeProviders";
import * as HostProcess from "@playstead/shared/hostProcess";
import { makeTempDirectoryScoped } from "@playstead/shared/tempDirectory";
import { assert, describe, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import { ProviderSessionId, ThreadId } from "@playstead/contracts/baseSchemas";
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

/**
 * The registry over a temporary home, with PATH holding only the given
 * folders and Node's, so the fakes' launchers can start `node`.
 */
const startRegistry = (
  pathDirectories: ReadonlyArray<string>,
  serverEnvironment: Readonly<Record<string, string>> = {},
) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const home = yield* makeTempDirectoryScoped("playstead-providers-");
    const paths = yield* ServerConfig.deriveServerPaths(home, undefined);
    const environment: Record<string, string | undefined> = {
      ...serverEnvironment,
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
        const bin = yield* makeTempDirectoryScoped("playstead-bin-");
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
        const emptyBin = yield* makeTempDirectoryScoped("playstead-bin-");
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
          auth: { status: "unknown" },
          message: "Claude Agent CLI (`claude`) was not found on PATH.",
        });
        assert.notProperty(providerById(providers, "codex"), "compatibilityAdvisory");
      }).pipe(Effect.scoped),
    );

    it.effect("warns when a found provider is older than the supported range", () =>
      Effect.gen(function* () {
        const bin = yield* makeTempDirectoryScoped("playstead-bin-");
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
        const bin = yield* makeTempDirectoryScoped("playstead-bin-");
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
        const pathBin = yield* makeTempDirectoryScoped("playstead-bin-");
        const ownBin = yield* makeTempDirectoryScoped("playstead-own-");
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
        const bin = yield* makeTempDirectoryScoped("playstead-bin-");
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

    it.effect("opens a Codex session over the app-server of the Codex it found", () =>
      Effect.gen(function* () {
        const bin = yield* makeTempDirectoryScoped("playstead-bin-");
        const workspace = yield* makeTempDirectoryScoped("playstead-workspace-");
        yield* writeFakeCodex({ directory: bin, version: "0.163.0" });
        const { registry } = yield* startRegistry([bin]);
        const adapter = Option.getOrThrow(yield* registry.getAdapter("codex"));

        // The session starts its own app-server and initializes it, after the
        // registry finished building the instance. A session bound to a
        // finished scope never gets its app-server's answer, hence the bound.
        const session = yield* adapter
          .openSession({
            threadId: ThreadId.make("thread:codex-session"),
            providerSessionId: ProviderSessionId.make("provider-session:codex-session"),
            modelSelection: { instanceId: "codex", model: "gpt-fake" },
            runtimePolicy: {
              runtimeMode: "full-access",
              interactionMode: "default",
              cwd: workspace,
            },
          })
          .pipe(Effect.timeout("30 seconds"));

        assert.strictEqual(session.providerSession.driver, "codex");
        assert.isTrue(yield* session.isLive);
      }).pipe(Effect.scoped),
    );

    it.effect(
      "starts Codex and Claude with the server's environment, but not ELECTRON_RUN_AS_NODE",
      () =>
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem;
          const path = yield* Path.Path;
          const bin = yield* makeTempDirectoryScoped("playstead-bin-");
          const workspace = yield* makeTempDirectoryScoped("playstead-workspace-");
          const codexLog = path.join(bin, "codex-environments.ndjson");
          const claudeLog = path.join(bin, "claude-environments.ndjson");
          yield* writeFakeCodex({ directory: bin, version: "0.163.0", environmentLog: codexLog });
          yield* writeFakeClaude({ directory: bin, version: "2.1.301", environmentLog: claudeLog });
          // The desktop app starts the server with ELECTRON_RUN_AS_NODE=1.
          const { registry } = yield* startRegistry([bin], {
            ELECTRON_RUN_AS_NODE: "1",
            PLAYSTEAD_SERVER_VARIABLE: "from the server",
          });
          yield* registry.refresh();
          const codex = Option.getOrThrow(yield* registry.getAdapter("codex"));
          yield* codex
            .openSession({
              threadId: ThreadId.make("thread:codex-environment"),
              providerSessionId: ProviderSessionId.make("provider-session:codex-environment"),
              modelSelection: { instanceId: "codex", model: "gpt-fake" },
              runtimePolicy: {
                runtimeMode: "full-access",
                interactionMode: "default",
                cwd: workspace,
              },
            })
            .pipe(Effect.timeout("30 seconds"));

          const started = (log: string) =>
            Effect.map(fs.readFileString(log), (text) =>
              text
                .trim()
                .split("\n")
                .map((line) => JSON.parse(line) as Record<string, string>),
            );
          const environments = [...(yield* started(codexLog)), ...(yield* started(claudeLog))];
          assert.isAbove(environments.length, 1);
          for (const environment of environments) {
            assert.strictEqual(environment.PLAYSTEAD_SERVER_VARIABLE, "from the server");
            assert.notProperty(environment, "ELECTRON_RUN_AS_NODE");
          }
        }).pipe(Effect.scoped),
    );

    it.effect("labels a Codex signed in with an API key, without an e-mail", () =>
      Effect.gen(function* () {
        const bin = yield* makeTempDirectoryScoped("playstead-bin-");
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
        const bin = yield* makeTempDirectoryScoped("playstead-bin-");
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

    it.effect("reports a signed-in Claude with its plan and the models its version runs", () =>
      Effect.gen(function* () {
        const bin = yield* makeTempDirectoryScoped("playstead-bin-");
        yield* writeFakeClaude({ directory: bin, version: "2.1.301", signedIn: true });
        const { registry } = yield* startRegistry([bin]);

        const providers = yield* registry.refresh("claudeAgent");

        assert.deepInclude(providerById(providers, "claudeAgent"), {
          installed: true,
          status: "ready",
          auth: { status: "authenticated", type: "max", label: "Claude Max Subscription" },
          models: [
            { slug: "claude-opus-5-5", name: "Claude Opus 5.5" },
            { slug: "claude-sonnet-5-5", name: "Claude Sonnet 5.5" },
            { slug: "claude-fable-5-1", name: "Claude Fable 5.1", isDefault: true },
            { slug: "claude-haiku-5-5", name: "Claude Haiku 5.5" },
          ],
        });
        assert.notProperty(providerById(providers, "claudeAgent"), "message");
      }).pipe(Effect.scoped),
    );

    it.effect("reports a signed-out Claude with the hint to run claude auth login", () =>
      Effect.gen(function* () {
        const bin = yield* makeTempDirectoryScoped("playstead-bin-");
        yield* writeFakeClaude({ directory: bin, version: "2.1.301", signedIn: false });
        const { registry } = yield* startRegistry([bin]);

        const providers = yield* registry.refresh("claudeAgent");

        assert.deepInclude(providerById(providers, "claudeAgent"), {
          installed: true,
          version: "2.1.301",
          status: "error",
          auth: { status: "unauthenticated" },
          message: "Claude Code is not authenticated. Run `claude auth login` and try again.",
        });
      }).pipe(Effect.scoped),
    );

    it.effect("offers only the Claude models an older version runs", () =>
      Effect.gen(function* () {
        const bin = yield* makeTempDirectoryScoped("playstead-bin-");
        yield* writeFakeClaude({ directory: bin, version: "2.1.280", signedIn: true });
        const { registry } = yield* startRegistry([bin]);

        const providers = yield* registry.refresh("claudeAgent");

        assert.deepInclude(providerById(providers, "claudeAgent"), {
          models: [
            { slug: "claude-opus-5-5", name: "Claude Opus 5.5" },
            { slug: "claude-fable-5-1", name: "Claude Fable 5.1", isDefault: true },
          ],
        });
      }).pipe(Effect.scoped),
    );

    it.effect("finds a provider installed after the server started when refreshed", () =>
      Effect.gen(function* () {
        const bin = yield* makeTempDirectoryScoped("playstead-bin-");
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
