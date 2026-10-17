import { assert, describe, it } from "@effect/vitest";

import { makePairingExchange } from "./pairingExchange.ts";

/** A page address the exchange reads and rewrites, and the tokens it signed in with. */
const fakePage = (href: string, answer: "Paired" | "Rejected" = "Paired") => {
  let address = new URL(href);
  const signIns: Array<string> = [];
  const exchange = makePairingExchange({
    currentUrl: () => address,
    replaceUrl: (url) => {
      address = url;
    },
    signIn: async (token) => {
      signIns.push(token);
      return answer;
    },
  });
  return { exchange, signIns, address: () => address.toString() };
};

describe("pairing exchange", () => {
  it("signs in with the link's token and takes it out of the address", async () => {
    const page = fakePage("http://localhost:5833/pair#token=3TGTGGT8XLBL");

    assert.deepStrictEqual(await page.exchange(), { _tag: "Paired" });
    assert.deepStrictEqual(page.signIns, ["3TGTGGT8XLBL"]);
    assert.strictEqual(page.address(), "http://localhost:5833/pair");
  });

  it("answers a second run on the same page with the first sign-in", async () => {
    // React's StrictMode runs the pair page's effect twice; the second run
    // sees the address after the first took the token out.
    const page = fakePage("http://localhost:5833/pair#token=3TGTGGT8XLBL");

    const first = page.exchange();
    const second = page.exchange();

    assert.deepStrictEqual(await second, { _tag: "Paired" });
    assert.deepStrictEqual(await first, { _tag: "Paired" });
    assert.deepStrictEqual(page.signIns, ["3TGTGGT8XLBL"]);
  });

  it("reports a link without a token, or one the server refused", async () => {
    assert.deepStrictEqual(await fakePage("http://localhost:5833/pair").exchange(), {
      _tag: "MissingToken",
    });
    assert.deepStrictEqual(
      await fakePage("http://localhost:5833/pair#token=USEDUSEDUSED", "Rejected").exchange(),
      { _tag: "Rejected" },
    );
  });
});
