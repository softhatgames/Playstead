import { assert, describe, it } from "@effect/vitest";

import { isWindowsCommandNotFound, parseGenericCliVersion } from "./snapshotProbe.ts";

describe("isWindowsCommandNotFound", () => {
  it("treats cmd.exe's exit code 9009 as not installed, in any language", () => {
    assert.isTrue(isWindowsCommandNotFound("win32", 9009, "ÿþ garbled output"));
  });

  it("recognizes cmd.exe's English and Russian 'not recognized' messages", () => {
    assert.isTrue(
      isWindowsCommandNotFound(
        "win32",
        1,
        "'codex' is not recognized as an internal or external command,\r\noperable program or batch file.",
      ),
    );
    assert.isTrue(
      isWindowsCommandNotFound(
        "win32",
        1,
        '"codex" не является внутренней или внешней\r\nкомандой, исполняемой программой или пакетным файлом.',
      ),
    );
  });

  it("never applies outside Windows", () => {
    assert.isFalse(
      isWindowsCommandNotFound(
        "darwin",
        9009,
        "is not recognized as an internal or external command",
      ),
    );
  });

  it("keeps a provider that failed for another reason installed", () => {
    assert.isFalse(isWindowsCommandNotFound("win32", 1, "Error: something broke"));
  });
});

describe("parseGenericCliVersion", () => {
  it("reads Claude Code's version line", () => {
    assert.strictEqual(parseGenericCliVersion("2.1.301 (Claude Code)\n"), "2.1.301");
  });
});
