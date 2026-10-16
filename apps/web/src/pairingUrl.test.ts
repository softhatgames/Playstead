import { assert, describe, it } from "@effect/vitest";

import { getPairingTokenFromUrl, stripPairingTokenFromUrl } from "./pairingUrl.ts";

describe("pairing link", () => {
  it("reads the token the server puts in the link's hash", () => {
    const link = new URL("http://localhost:5833/pair#token=3TGTGGT8XLBL");

    assert.strictEqual(getPairingTokenFromUrl(link), "3TGTGGT8XLBL");
  });

  it("reads a token in the query when the hash has none", () => {
    assert.strictEqual(
      getPairingTokenFromUrl(new URL("http://localhost:5833/pair?token=ABCDEF234567")),
      "ABCDEF234567",
    );
    assert.strictEqual(getPairingTokenFromUrl(new URL("http://localhost:5833/pair")), undefined);
  });

  it("leaves no token in the address once it is read", () => {
    const stripped = stripPairingTokenFromUrl(
      new URL("http://localhost:5833/pair?token=ABCDEF234567#token=3TGTGGT8XLBL"),
    );

    assert.strictEqual(stripped.toString(), "http://localhost:5833/pair");
  });
});
