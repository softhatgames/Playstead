import type { ProviderDriver } from "@playstead/provider-core/server/driver";
import { makeManagedServerProvider } from "@playstead/provider-core/server/managedProvider";
import { buildServerProvider, expandHomePath } from "@playstead/provider-core/server/snapshotProbe";
import { DEFAULT_BINARY_PATHS } from "@playstead/contracts/settings";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import type * as Path from "effect/Path";
import type { ChildProcessSpawner } from "effect/process";

import {
  layerAppServerClientFactory,
  makeCodexAdapter,
} from "../../orchestration-v2/Adapters/CodexAdapterV2.ts";
import { makeCodexTextGeneration } from "../../textGeneration/CodexTextGeneration.ts";
import { checkCodexProviderStatus } from "../CodexProvider.ts";

const DISPLAY_NAME = "Codex";

/**
 * Codex, following T3 Code's `CodexDriver`
 * (`apps/server/src/provider/Drivers/CodexDriver.ts` at 2577baf) without the
 * managed runtime, home layout or launch arguments. Its orchestration adapter
 * runs threads over `codex app-server`, and its text generation writes
 * titles with `codex exec`, both with the same `codex`.
 */
export const CodexDriver: ProviderDriver<
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem | Path.Path
> = {
  driverKind: "codex",
  displayName: DISPLAY_NAME,
  create: (input) =>
    Effect.gen(function* () {
      const binaryPath = expandHomePath(
        input.settings.binaryPath ?? DEFAULT_BINARY_PATHS.codex,
        input.homeDirectory,
      );
      const stamp = {
        instanceId: input.instanceId,
        driver: "codex",
        displayName: DISPLAY_NAME,
      } as const;
      const snapshot = yield* makeManagedServerProvider({
        initialSnapshot: yield* buildServerProvider({
          ...stamp,
          probe: {
            installed: false,
            version: null,
            status: "warning",
            message: "Codex provider status has not been checked in this session yet.",
          },
        }),
        checkProvider: checkCodexProviderStatus({
          binaryPath,
          environment: input.environment,
          platform: input.platform,
          cwd: input.cwd,
        }).pipe(Effect.flatMap((status) => buildServerProvider({ ...stamp, ...status }))),
      });
      const orchestrationAdapter = yield* makeCodexAdapter({
        instanceId: input.instanceId,
        binaryPath,
        environment: input.environment,
        platform: input.platform,
        cwd: input.cwd,
      }).pipe(Effect.provide(layerAppServerClientFactory));
      const textGeneration = yield* makeCodexTextGeneration({
        binaryPath,
        environment: input.environment,
        platform: input.platform,
      });
      return {
        instanceId: input.instanceId,
        driverKind: "codex",
        displayName: DISPLAY_NAME,
        snapshot,
        orchestrationAdapter,
        textGeneration,
      };
    }),
};
