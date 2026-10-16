// @effect-diagnostics nodeBuiltinImport:off -- An inherited descriptor is read with plain Node streams.
import * as NodeFS from "node:fs";
import * as NodeNet from "node:net";
import * as NodeReadline from "node:readline";
import type * as NodeStream from "node:stream";

import { DesktopBackendBootstrap } from "@playstead/contracts/desktopBootstrap";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

export class BootstrapEnvelopeError extends Schema.TaggedError<BootstrapEnvelopeError>()(
  "BootstrapEnvelopeError",
  {
    fd: Schema.Number,
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Could not read the desktop app's settings from file descriptor ${this.fd}: ${this.detail}`;
  }
}

const decodeEnvelope = Schema.decodeUnknownEffect(Schema.fromJsonString(DesktopBackendBootstrap));

const isMissingDescriptor = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error.code === "EBADF" || error.code === "ENOENT");

/**
 * A pipe the parent passed is reopened through its path on macOS and Linux,
 * as T3 Code's `apps/server/src/bootstrap.ts` does; reading the inherited
 * socket directly can fail with EAGAIN there. Windows has no such path and
 * reads the descriptor itself.
 */
const openDescriptorStream = (fd: number): NodeStream.Readable => {
  const fdPath =
    process.platform === "linux"
      ? `/proc/self/fd/${fd}`
      : process.platform === "win32"
        ? undefined
        : `/dev/fd/${fd}`;
  if (fdPath !== undefined) {
    try {
      return NodeFS.createReadStream("", {
        fd: NodeFS.openSync(fdPath, "r"),
        encoding: "utf8",
        autoClose: true,
      });
    } catch {
      // Fall through to the descriptor itself.
    }
  }
  try {
    return NodeFS.createReadStream("", { fd, encoding: "utf8", autoClose: true });
  } catch {
    const socket = new NodeNet.Socket({ fd, readable: true, writable: false });
    socket.setEncoding("utf8");
    return socket;
  }
};

const readFirstLine = (fd: number) =>
  Effect.callback<Option.Option<string>, BootstrapEnvelopeError>((resume) => {
    let stream: NodeStream.Readable;
    try {
      stream = openDescriptorStream(fd);
    } catch (cause) {
      resume(
        Effect.fail(new BootstrapEnvelopeError({ fd, detail: "it could not be opened", cause })),
      );
      return;
    }
    const lines = NodeReadline.createInterface({ input: stream, crlfDelay: Infinity });
    const cleanup = () => {
      lines.close();
      stream.destroy();
    };
    stream.once("error", (cause) =>
      resume(
        isMissingDescriptor(cause)
          ? Effect.succeedNone
          : Effect.fail(new BootstrapEnvelopeError({ fd, detail: "reading failed", cause })),
      ),
    );
    lines.once("line", (line) => resume(Effect.succeedSome(line)));
    lines.once("close", () => resume(Effect.succeedNone));
    return Effect.sync(cleanup);
  });

/**
 * The desktop app's settings, one JSON line on file descriptor `fd`. None when
 * the descriptor is not open, so a server started by hand still runs.
 */
export const readBootstrapEnvelope = Effect.fn("readBootstrapEnvelope")(function* (fd: number) {
  const open = yield* Effect.suspend(() => {
    try {
      NodeFS.fstatSync(fd);
      return Effect.succeed(true);
    } catch (cause) {
      return isMissingDescriptor(cause)
        ? Effect.succeed(false)
        : Effect.fail(new BootstrapEnvelopeError({ fd, detail: "it could not be checked", cause }));
    }
  });
  if (!open) return Option.none<DesktopBackendBootstrap>();
  const line = yield* readFirstLine(fd).pipe(
    Effect.timeoutOption("5 seconds"),
    Effect.map(Option.flatten),
  );
  if (Option.isNone(line)) return Option.none<DesktopBackendBootstrap>();
  return Option.some(
    yield* decodeEnvelope(line.value).pipe(
      Effect.mapError(
        (cause) => new BootstrapEnvelopeError({ fd, detail: "it is not valid", cause }),
      ),
    ),
  );
});
