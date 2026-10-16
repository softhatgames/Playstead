import { getPairingTokenFromUrl, stripPairingTokenFromUrl } from "./pairingUrl.ts";

export type PairingResult =
  | { readonly _tag: "Paired" }
  | { readonly _tag: "MissingToken" }
  | { readonly _tag: "Rejected" };

/** What the exchange needs from the page: its address and a way to sign in. */
export interface PairingPage {
  readonly currentUrl: () => URL;
  readonly replaceUrl: (url: URL) => void;
  readonly signIn: (token: string) => Promise<"Paired" | "Rejected">;
}

/**
 * Trades the pairing link's one-time token for a session, then takes the
 * token out of the address so it is not left in history.
 *
 * The token is read once per link: a later run that finds the address
 * already stripped (React's StrictMode runs the pair page's effect twice)
 * gets the sign-in already under way instead of "no token".
 */
export const makePairingExchange = (page: PairingPage) => {
  let latest: Promise<PairingResult> | undefined;
  return (): Promise<PairingResult> => {
    const location = page.currentUrl();
    const token = getPairingTokenFromUrl(location);
    if (token === undefined && latest !== undefined) return latest;
    page.replaceUrl(stripPairingTokenFromUrl(location));
    latest =
      token === undefined
        ? Promise.resolve({ _tag: "MissingToken" })
        : page.signIn(token).then((answer) => ({ _tag: answer }));
    return latest;
  };
};
