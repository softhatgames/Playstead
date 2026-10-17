import { DEFAULT_TEXT_GENERATION_MODELS } from "@playstead/contracts/settings";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { makeTestServerConfig } from "../testUtils/testServer.ts";
import * as Config from "../config.ts";
import * as Settings from "../serverSettings.ts";

it.layer(NodeServices.layer)((it) => {
  it.effect("text generation settings persist through provider changes and service restart", () =>
    Effect.gen(function* () {
      const config = yield* makeTestServerConfig();
      const build = () => Layer.build(Settings.layer.pipe(Layer.provide(Config.layer(config))));
      const context = yield* build();
      const service = yield* Settings.ServerSettingsService.pipe(Effect.provideContext(context));
      assert.deepStrictEqual(
        (yield* service.getSettings).textGenerationModelSelection,
        DEFAULT_TEXT_GENERATION_MODELS.codex,
      );
      assert.strictEqual((yield* service.getSettings).sidebarAutoSettleAfterDays, 3);
      yield* service.updateAutoSettle(null);
      const selected = {
        instanceId: "codex" as const,
        model: "gpt-6-luna",
        options: [{ id: "reasoningEffort", value: "medium" }],
      };
      yield* service.updateTextGeneration(selected);
      yield* service.updateProviderInstance({
        operation: "upsert",
        instanceId: "claudeAgent",
        instance: { driver: "claudeAgent", config: { binaryPath: "/some/claude" } },
      });
      const restarted = yield* Settings.ServerSettingsService.pipe(
        Effect.provideContext(yield* build()),
      );
      assert.isNull((yield* restarted.getSettings).sidebarAutoSettleAfterDays);
      assert.deepStrictEqual((yield* restarted.getSettings).textGenerationModelSelection, selected);
    }).pipe(Effect.scoped),
  );
});
