/**
 * The paths Vite passes to the server in development. Two places must agree on
 * them: the Vite proxy (apps/web/vite.config.ts) and the server's catch-all
 * (apps/server/src/http.ts), which answers them with 404 instead of sending the
 * browser back to Vite. A path only Vite knows gets index.html; a path only the
 * server knows loops through the proxy.
 */
export const DEV_PROXIED_PATH_PREFIXES = ["/api", "/oauth", "/.well-known", "/ws"] as const;

/**
 * Proxied with the page's own Host. The server accepts a browser's cookie on
 * `/ws` only when the page's Origin matches the Host it sees.
 */
export const DEV_PROXIED_ORIGIN_PRESERVING_PREFIXES: ReadonlySet<string> = new Set([
  "/oauth",
  "/.well-known",
  "/ws",
]);

export function isDevProxiedPath(pathname: string): boolean {
  return DEV_PROXIED_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
