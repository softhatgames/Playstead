import type { ProviderDriver } from "@playstead/provider-core/server/driver";
import { makeManagedServerProvider } from "@playstead/provider-core/server/managedProvider";
import { buildServerProvider, expandHomePath } from "@playstead/provider-core/server/snapshotProbe";
import { DEFAULT_BINARY_PATHS } from "@playstead/contracts/settings";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import type { ChildProcessSpawner } from "effect/process";

import { checkCodexProviderStatus } from "../CodexProvider.ts";

const DISPLAY_NAME = "Codex";

/**
 * Codex, following T3 Code's `CodexDriver`
 * (`apps/server/src/provider/Drivers/CodexDriver.ts` at 2577baf) without the
 * managed runtime, home layout or launch arguments.
 */
export const CodexDriver: ProviderDriver<
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
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
        }).pipe(Effect.flatMap((probe) => buildServerProvider({ ...stamp, probe }))),
      });
      return {
        instanceId: input.instanceId,
        driverKind: "codex",
        displayName: DISPLAY_NAME,
        snapshot,
      };
    }),
};
