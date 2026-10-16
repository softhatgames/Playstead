import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { resolveServerConfig } from "./config.ts";

const resolveWith = (env: Record<string, string>) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const homeDirectory = path.join(path.sep, "Users", "person");
    const config = yield* resolveServerConfig({
      cwd: homeDirectory,
      homeDirectory,
      findPort: Effect.succeed,
    }).pipe(Effect.provideService(ConfigProvider.ConfigProvider, ConfigProvider.fromEnv({ env })));
    return { config, homeDirectory, path };
  });

describe("server config", () => {
  it.layer(NodeServices.layer)((it) => {
    it.effect(
      "keeps development state under dev/ in ~/.playstead and reads no T3 Code variable",
      () =>
        Effect.gen(function* () {
          const { config, homeDirectory, path } = yield* resolveWith({
            PLAYSTEAD_DEV_URL: "http://localhost:5833/",
            T3CODE_HOME: "/Users/person/.t3",
            T3CODE_PORT: "13773",
          });

          assert.strictEqual(config.baseDir, path.join(homeDirectory, ".playstead"));
          assert.strictEqual(config.stateDir, path.join(homeDirectory, ".playstead", "dev"));
          assert.strictEqual(
            config.dbPath,
            path.join(homeDirectory, ".playstead", "dev", "state.sqlite"),
          );
          assert.strictEqual(config.port, 4773);
        }),
    );

    it.effect("keeps a worktree's development state in the home the runner names", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const worktreeHome = path.join(path.sep, "work", "playstead", ".playstead");
        const { config } = yield* resolveWith({
          PLAYSTEAD_HOME: worktreeHome,
          PLAYSTEAD_DEV_URL: "http://localhost:5833/",
          PLAYSTEAD_PORT: "14800",
        });

        assert.strictEqual(config.baseDir, worktreeHome);
        assert.strictEqual(config.stateDir, path.join(worktreeHome, "dev"));
        assert.strictEqual(config.port, 14800);
      }),
    );

    it.effect("keeps runtime state under userdata/ outside development", () =>
      Effect.gen(function* () {
        const { config, homeDirectory, path } = yield* resolveWith({});

        assert.strictEqual(config.stateDir, path.join(homeDirectory, ".playstead", "userdata"));
        assert.strictEqual(config.devUrl, undefined);
      }),
    );
  });
});
