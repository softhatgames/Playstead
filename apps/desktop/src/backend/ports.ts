// @effect-diagnostics nodeBuiltinImport:off -- Port probing needs plain Node sockets.
import * as NodeNet from "node:net";

import * as Effect from "effect/Effect";

/** The server listens on this computer only. */
export const BACKEND_HOST = "127.0.0.1";

const canListen = (port: number) =>
  Effect.callback<boolean>((resume) => {
    const probe = NodeNet.createServer();
    probe.once("error", () => resume(Effect.succeed(false)));
    probe.listen({ host: BACKEND_HOST, port }, () =>
      probe.close(() => resume(Effect.succeed(true))),
    );
  });

/**
 * The first free port from `preferred`, as T3 Code's desktop app scans from
 * its default backend port (`apps/desktop/src/app/DesktopApp.ts`).
 */
export const findAvailablePort = Effect.fn("findAvailablePort")(function* (preferred: number) {
  for (let port = preferred; port < preferred + 100; port++) {
    if (yield* canListen(port)) return port;
  }
  return yield* Effect.die(`No free port from ${preferred} to ${preferred + 99}.`);
});
