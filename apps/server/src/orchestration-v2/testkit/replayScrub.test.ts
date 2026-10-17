import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { findLeaks, readMachineIdentity, scrubbed } from "./replayScrub.ts";

const machine = {
  home: "/Users/ana",
  user: "ana",
  host: "anas-mac.local",
  tmpdir: "/var/folders/xy/T",
};

describe("replay scrubbing", () => {
  it("hides accounts, tokens, Codex's ids and this machine's names in a frame", () => {
    const frame = scrubbed(
      {
        cwd: "/Users/ana/work/game",
        text: "Signed in as ana@example.org on anas-mac with sk-ant-api03-abcdefghijkl",
        installationId: "7d1c4b9e-2f3a-4c5d-8e6f-0a1b2c3d4e5f",
        planType: "pro",
        accessToken: "abc",
      },
      [
        ["/Users/ana", "/home/replay-user"],
        ["anas-mac", "replay-host"],
      ],
    );
    assert.deepStrictEqual(frame, {
      cwd: "/home/replay-user/work/game",
      text: "Signed in as user@example.com on replay-host with REDACTED",
      installationId: "00000000-0000-4000-8000-000000000000",
      planType: "unknown",
      accessToken: "REDACTED",
    });
  });

  it("finds what a recording still gives away", () => {
    const leaks = findLeaks(
      JSON.stringify({
        a: "/Users/ana/x",
        b: "anas-mac",
        c: "bob@example.org",
        d: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln",
        e: "C:\\Users\\bob\\game",
        f: "/home/replay-user and user@example.com are fine",
      }),
      machine,
    );
    assert.deepStrictEqual(leaks, [
      "/Users/ana",
      "/ana/",
      "anas-mac",
      "bob@example.org",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln",
    ]);
    assert.deepStrictEqual(findLeaks(JSON.stringify({ e: "C:\\Users\\bob\\game" }), machine), [
      "C:\\\\Users\\\\bob",
    ]);
  });

  it.layer(NodeServices.layer)((it) => {
    it.effect("leaves nothing in any committed recording", () =>
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const fixtures = path.join(import.meta.dirname, "fixtures");
        const recordings = (yield* fs.readDirectory(fixtures)).filter((name) =>
          name.endsWith(".ndjson"),
        );
        assert.isAbove(recordings.length, 0);
        const leaking = [];
        for (const name of recordings.toSorted()) {
          const text = yield* fs.readFileString(path.join(fixtures, name));
          if (findLeaks(text, readMachineIdentity()).length > 0) leaking.push(name);
        }
        assert.deepStrictEqual(leaking, []);
      }),
    );
  });
});
