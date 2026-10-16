const PAIRING_TOKEN_PARAM = "token";

const readHashParams = (url: URL) => new URLSearchParams(url.hash.replace(/^#/, ""));

/**
 * The one-time token in a pairing link. The server puts it in the hash, which
 * never reaches a server log; a token in the query is read too.
 */
export const getPairingTokenFromUrl = (url: URL): string | undefined => {
  const fromHash = readHashParams(url).get(PAIRING_TOKEN_PARAM)?.trim() ?? "";
  if (fromHash.length > 0) return fromHash;
  const fromQuery = url.searchParams.get(PAIRING_TOKEN_PARAM)?.trim() ?? "";
  return fromQuery.length > 0 ? fromQuery : undefined;
};

/** The same address without the token, for the history entry left behind. */
export const stripPairingTokenFromUrl = (url: URL): URL => {
  const next = new URL(url.toString());
  const hashParams = readHashParams(next);
  hashParams.delete(PAIRING_TOKEN_PARAM);
  next.hash = hashParams.toString();
  next.searchParams.delete(PAIRING_TOKEN_PARAM);
  return next;
};
