import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";

import { resolveDesktopEnvironment } from "./DesktopEnvironment.ts";

const resolveWith = (env: Record<string, string>, argv: ReadonlyArray<string> = []) =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const homeDirectory = path.resolve(path.sep, "Users", "person");
    const appDataDirectory = path.join(homeDirectory, "Library", "Application Support");
    const desktopDir = path.resolve(path.sep, "work", "playstead", "apps", "desktop");
    return {
      path,
      homeDirectory,
      appDataDirectory,
      environment: resolveDesktopEnvironment(path, {
        env,
        homeDirectory,
        appDataDirectory,
        desktopDir,
        argv,
      }),
    };
  });

describe("desktop environment", () => {
  it.layer(NodeServices.layer)((it) => {
    it.effect("runs in development under the development identity, apart from T3 Code", () =>
      Effect.gen(function* () {
        const { environment, appDataDirectory, path } = yield* resolveWith({
          PLAYSTEAD_DEV_URL: "http://localhost:5834/",
          PLAYSTEAD_PORT: "14774",
          PLAYSTEAD_HOME: "/work/playstead/.playstead",
          T3CODE_HOME: "/Users/person/.t3",
          T3CODE_PORT: "13773",
        });

        assert.strictEqual(environment.displayName, "Playstead (Dev)");
        assert.strictEqual(environment.appId, "com.softhatgames.playstead.dev");
        assert.strictEqual(environment.urlScheme, "playstead-dev");
        assert.strictEqual(environment.windowUrl, "playstead-dev://app/");
        assert.strictEqual(environment.userDataPath, path.join(appDataDirectory, "playstead-dev"));
        assert.strictEqual(environment.backendPort, 14774);
        assert.strictEqual(environment.playsteadHome, path.resolve("/work/playstead/.playstead"));
      }),
    );

    it.effect("runs outside development under the product identity in ~/.playstead", () =>
      Effect.gen(function* () {
        const { environment, appDataDirectory, homeDirectory, path } = yield* resolveWith({});

        assert.strictEqual(environment.displayName, "Playstead");
        assert.strictEqual(environment.appId, "com.softhatgames.playstead");
        assert.strictEqual(environment.windowUrl, "playstead://app/");
        assert.strictEqual(environment.userDataPath, path.join(appDataDirectory, "playstead-v1"));
        assert.strictEqual(environment.backendPort, undefined);
        assert.strictEqual(environment.playsteadHome, path.join(homeDirectory, ".playstead"));
      }),
    );

    it.effect("keeps a smoke boot's Electron data in the folder it names", () =>
      Effect.gen(function* () {
        const { environment, path } = yield* resolveWith({}, [
          "--user-data-dir=/tmp/playstead-smoke/user-data",
        ]);

        assert.strictEqual(
          environment.userDataPath,
          path.resolve("/tmp/playstead-smoke/user-data"),
        );
      }),
    );
  });
});
