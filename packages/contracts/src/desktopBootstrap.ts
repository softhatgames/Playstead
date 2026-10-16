import * as Schema from "effect/Schema";

import { TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * The settings the desktop app hands the server it starts. They travel as one
 * JSON line on a private file descriptor, not in the environment or the
 * arguments, because the bootstrap token signs the window in.
 *
 * T3 Code's `DesktopBackendBootstrap` also carries its mode, host, Tailscale,
 * telemetry and browser descriptors; Playstead's server has none of them.
 */
export const DesktopBackendBootstrap = Schema.Struct({
  port: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
  playsteadHome: TrimmedNonEmptyString,
  /** Set in development, where Vite serves the interface. */
  devUrl: Schema.optionalKey(TrimmedNonEmptyString),
  /** A secret the desktop app exchanges for the window's bearer token. */
  desktopBootstrapToken: TrimmedNonEmptyString,
});
export type DesktopBackendBootstrap = typeof DesktopBackendBootstrap.Type;
