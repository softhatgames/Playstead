// @effect-diagnostics nodeBuiltinImport:off -- The defaults read the running process.
import * as NodeOS from "node:os";

import * as Context from "effect/Context";

/**
 * The host process's platform, environment and home folder, as references a
 * test can override, as T3 Code's `packages/shared/src/HostProcess.ts` does.
 */
export const Platform = Context.Reference<NodeJS.Platform>(
  "@playstead/shared/hostProcess/Platform",
  {
    defaultValue: () => process.platform,
  },
);

export const Environment = Context.Reference<Readonly<Record<string, string | undefined>>>(
  "@playstead/shared/hostProcess/Environment",
  { defaultValue: () => process.env },
);

export const HomeDirectory = Context.Reference<string>(
  "@playstead/shared/hostProcess/HomeDirectory",
  { defaultValue: () => NodeOS.homedir() },
);
