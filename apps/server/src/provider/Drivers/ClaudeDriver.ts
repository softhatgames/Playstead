import type { ProviderDriver } from "@playstead/provider-core/server/driver";
import { makeManagedServerProvider } from "@playstead/provider-core/server/managedProvider";
import { buildServerProvider, expandHomePath } from "@playstead/provider-core/server/snapshotProbe";
import { DEFAULT_BINARY_PATHS } from "@playstead/contracts/settings";
import * as Effect from "effect/Effect";
import type * as FileSystem from "effect/FileSystem";
import type { ChildProcessSpawner } from "effect/process";

import { checkClaudeProviderStatus } from "../ClaudeProvider.ts";

const DISPLAY_NAME = "Claude";

/**
 * Claude, following T3 Code's `ClaudeDriver`
 * (`apps/server/src/provider/Drivers/ClaudeDriver.ts` at 2577baf) without a
 * home path, launch arguments or usage readers. Claude runs with the server's
 * environment, as `makeClaudeEnvironment` gives it when no home path is set.
 */
export const ClaudeDriver: ProviderDriver<
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
> = {
  driverKind: "claudeAgent",
  displayName: DISPLAY_NAME,
  create: (input) =>
    Effect.gen(function* () {
      const binaryPath = expandHomePath(
        input.settings.binaryPath ?? DEFAULT_BINARY_PATHS.claudeAgent,
        input.homeDirectory,
      );
      const stamp = {
        instanceId: input.instanceId,
        driver: "claudeAgent",
        displayName: DISPLAY_NAME,
      } as const;
      const snapshot = yield* makeManagedServerProvider({
        initialSnapshot: yield* buildServerProvider({
          ...stamp,
          probe: {
            installed: false,
            version: null,
            status: "warning",
            message: "Claude provider status has not been checked in this session yet.",
          },
        }),
        checkProvider: checkClaudeProviderStatus({
          binaryPath,
          environment: input.environment,
          platform: input.platform,
          cwd: input.cwd,
        }).pipe(Effect.flatMap((probe) => buildServerProvider({ ...stamp, probe }))),
      });
      return {
        instanceId: input.instanceId,
        driverKind: "claudeAgent",
        displayName: DISPLAY_NAME,
        snapshot,
      };
    }),
};
