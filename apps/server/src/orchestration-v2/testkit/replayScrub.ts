// @effect-diagnostics nodeBuiltinImport:off -- The recorders read this machine's identity to scrub it.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";

import { REPLAY_WORKSPACE_PLACEHOLDER } from "@playstead/provider-testing/replayTranscript";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

/**
 * What both replay recorders (`apps/server/scripts/record-*-replay.ts`) do to
 * keep a recording free of this machine and its accounts: the replacements,
 * the scrub of every frame, the leak check and where the file goes. The test
 * beside it runs the same leak check over every committed recording.
 */

const REPLAY_HOME = "/tmp/playstead-replay-home";
const REPLAY_USER_HOME = "/home/replay-user";
const REPLAY_HOST = "replay-host";
const REPLAY_EMAIL = "user@example.com";
const ZERO_UUID = "00000000-0000-4000-8000-000000000000";

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** Anthropic and OpenAI keys, and JWTs such as Codex's ChatGPT tokens. */
const TOKEN =
  /\b(?:sk-ant-[A-Za-z0-9_-]{8,}|sk-[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/g;
const SECRET_KEYS = /token|secret|password|api[_-]?key|authorization|cookie|email/i;
/** Ids Codex sends at start-up that name this installation or account. */
const IDENTITY_KEYS = /^(installationId|chatgptAccountId|accountId|userId|workspaceId)$/;
/** A person's home folder on macOS, Linux or Windows, other than the replay's own. */
const HOME_FOLDER =
  /\/Users\/[^/"\\]+|\/home\/(?!replay-user\b)[^/"\\]+|[A-Za-z]:(?:\\\\|\\)Users(?:\\\\|\\)[^\\"]+/;

/** This machine's names, which a recording must not contain. */
export interface MachineIdentity {
  readonly home: string;
  readonly user: string;
  readonly host: string;
  readonly tmpdir: string;
}

export const readMachineIdentity = (): MachineIdentity => ({
  home: NodeOS.homedir(),
  user: NodeOS.userInfo().username,
  host: NodeOS.hostname(),
  tmpdir: NodeOS.tmpdir(),
});

const shortHost = (machine: MachineIdentity) => machine.host.split(".")[0] ?? machine.host;

export type Replacements = ReadonlyArray<readonly [string, string]>;

/**
 * What a recording's text replaces, longest first, so the folder goes before
 * the home that contains it: the scenario's folder becomes `<workspace>`, the
 * harness's Playstead home a fixed folder, and this machine's home, host and
 * user name fixed ones.
 */
export const recordingReplacements = (input: {
  readonly workspace: string;
  readonly playsteadHome: string;
  readonly machine: MachineIdentity;
}): Replacements => [
  [NodeFS.realpathSync(input.workspace), REPLAY_WORKSPACE_PLACEHOLDER],
  [input.workspace, REPLAY_WORKSPACE_PLACEHOLDER],
  [NodeFS.realpathSync(input.playsteadHome), REPLAY_HOME],
  [input.playsteadHome, REPLAY_HOME],
  [input.machine.home, REPLAY_USER_HOME],
  [input.machine.host, REPLAY_HOST],
  [shortHost(input.machine), REPLAY_HOST],
  [`/${input.machine.user}/`, "/replay-user/"],
];

/** The text with the replacements made, and e-mails and tokens hidden. */
export const scrubbedText = (value: string, replacements: Replacements) => {
  let text = value;
  for (const [from, to] of replacements) text = text.split(from).join(to);
  return text.replace(EMAIL, REPLAY_EMAIL).replace(TOKEN, "REDACTED");
};

/**
 * A frame with every string scrubbed. A string under a secret-looking key is
 * hidden whole, Codex's installation and account ids become a zero UUID, and
 * its plan type `unknown`.
 */
export const scrubbed = (value: unknown, replacements: Replacements): unknown => {
  if (typeof value === "string") return scrubbedText(value, replacements);
  if (Array.isArray(value)) return value.map((item) => scrubbed(item, replacements));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        typeof item !== "string"
          ? scrubbed(item, replacements)
          : IDENTITY_KEYS.test(key)
            ? ZERO_UUID
            : key === "planType"
              ? "unknown"
              : SECRET_KEYS.test(key)
                ? "REDACTED"
                : scrubbedText(item, replacements),
      ]),
    );
  }
  return value;
};

/**
 * What a recording's text still gives away: this machine's names and
 * temporary folder, the given folders, a person's home folder, an e-mail
 * other than the placeholder, or something shaped like a token. Names are
 * looked for as written and as escaped inside JSON strings (Windows paths).
 */
export const findLeaks = (
  text: string,
  machine: MachineIdentity,
  folders: ReadonlyArray<string> = [],
): ReadonlyArray<string> => {
  const names = [
    machine.home,
    `/${machine.user}/`,
    machine.host,
    shortHost(machine),
    machine.tmpdir,
    ...folders,
    "/var/folders",
    "/private/",
  ].filter(
    // A name inside a placeholder (Linux's `/tmp`, say) is not a leak.
    (name) => name.length >= 3 && !REPLAY_HOME.includes(name) && !REPLAY_USER_HOME.includes(name),
  );
  const named = names.filter(
    (name) => text.includes(name) || text.includes(JSON.stringify(name).slice(1, -1)),
  );
  const shapes = [
    HOME_FOLDER.exec(text)?.[0],
    text.replaceAll(REPLAY_EMAIL, "").match(EMAIL)?.[0],
    text.match(TOKEN)?.[0],
  ].filter((found) => found !== undefined);
  return [...new Set([...named, ...shapes])];
};

/** Where a scenario's recording is committed. */
const replayFixturePath = (scenario: string, provider: "claude" | "codex") =>
  Effect.map(Path.Path, (path) =>
    path.join(import.meta.dirname, "fixtures", `${scenario}.${provider}.ndjson`),
  );

/** Writes a scrubbed recording, refusing one that still gives anything away. */
export const writeRecording = (input: {
  readonly scenario: string;
  readonly provider: "claude" | "codex";
  readonly text: string;
  readonly machine: MachineIdentity;
  readonly workspace: string;
}) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const leaks = findLeaks(input.text, input.machine, [
      input.workspace,
      NodeFS.realpathSync(input.workspace),
    ]);
    if (leaks.length > 0) {
      return yield* Effect.die(
        `The scrubbed recording still names this machine or an account (${leaks.length} found).`,
      );
    }
    const out = yield* replayFixturePath(input.scenario, input.provider);
    yield* fs.writeFileString(out, input.text);
    return out;
  });
