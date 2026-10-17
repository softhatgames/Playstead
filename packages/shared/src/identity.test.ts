import { assert, describe, it } from "@effect/vitest";

import { identity } from "./identity.ts";

// T3 Code's values at 2577baf, as docs/ARCHITECTURE.md lists them. Playstead
// runs beside the installed T3 Code, so sharing any of them would mix the two
// apps' data, windows or links. The `userdata` and `dev` areas keep T3 Code's
// names on purpose: they sit under the Playstead home, so they cannot collide.
const t3CodeValues = new Set([
  "T3 Code",
  "T3 Code (Beta)",
  "T3 Code (Dev)",
  "com.t3tools.t3code",
  "com.t3tools.t3code.dev",
  "t3code",
  "t3code-dev",
  "t3code://app/",
  ".t3",
  "T3CODE_HOME",
  "t3code-v2",
  "T3CODE_",
  "/.well-known/t3/environment",
]);

const allValues = (value: unknown): ReadonlyArray<string> =>
  typeof value === "string"
    ? [value]
    : Object.values(value as Record<string, unknown>).flatMap(allValues);

describe("identity", () => {
  it("names the product", () => {
    assert.strictEqual(identity.productName.production, "Playstead");
    assert.strictEqual(identity.productName.development, "Playstead (Dev)");
  });

  it("uses the softhatgames app ids", () => {
    assert.strictEqual(identity.appId.production, "com.softhatgames.playstead");
    assert.strictEqual(identity.appId.development, "com.softhatgames.playstead.dev");
  });

  it("serves the window from the URL scheme", () => {
    assert.strictEqual(identity.urlScheme.production, "playstead");
    assert.strictEqual(identity.urlScheme.development, "playstead-dev");
    assert.strictEqual(identity.windowUrl.production, "playstead://app/");
    assert.strictEqual(identity.windowUrl.development, "playstead-dev://app/");
  });

  it("keeps state in the Playstead home", () => {
    assert.strictEqual(identity.home.directoryName, ".playstead");
    assert.strictEqual(identity.home.variable, "PLAYSTEAD_HOME");
    assert.strictEqual(identity.home.stateDirectoryName.production, "userdata");
    assert.strictEqual(identity.home.stateDirectoryName.development, "dev");
    assert.strictEqual(identity.home.worktreeDirectoryName, ".playstead");
  });

  it("names Electron's user-data folders", () => {
    assert.strictEqual(identity.electronUserDataFolder.production, "playstead-v1");
    assert.strictEqual(identity.electronUserDataFolder.development, "playstead-dev");
  });

  it("prefixes environment variables and the environment descriptor", () => {
    assert.strictEqual(identity.environmentVariablePrefix, "PLAYSTEAD_");
    assert.strictEqual(identity.environmentDescriptorPath, "/.well-known/playstead/environment");
  });

  it("moves the home with a variable that carries the prefix", () => {
    assert.isTrue(identity.home.variable.startsWith(identity.environmentVariablePrefix));
  });

  it("shares no value with T3 Code", () => {
    const clashes = allValues(identity).filter((value) => t3CodeValues.has(value));
    assert.deepStrictEqual(clashes, []);
  });

  it("never names T3 Code", () => {
    const mentions = allValues(identity).filter((value) => /t3/i.test(value));
    assert.deepStrictEqual(mentions, []);
  });
});
