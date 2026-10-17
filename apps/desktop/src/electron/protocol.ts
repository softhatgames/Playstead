// @effect-diagnostics nodeBuiltinImport:off -- Electron's protocol handler serves files with plain Node.
// @effect-diagnostics globalFetch:off -- Electron's handler answers with web Responses.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { identity } from "@playstead/shared/identity";
import { net, protocol } from "electron";

/** The window's host under the URL scheme, as in T3 Code: `<scheme>://app/`. */
const DESKTOP_HOST = "app";

/**
 * Both schemes' privileges. Electron needs them before `ready`, so this runs
 * synchronously at startup (T3 Code's `registerDesktopSchemePrivilegesSync`,
 * `apps/desktop/src/electron/ElectronProtocol.ts`).
 */
export const registerSchemePrivileges = () =>
  protocol.registerSchemesAsPrivileged(
    [identity.urlScheme.production, identity.urlScheme.development].map((scheme) => ({
      scheme,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    })),
  );

const DROPPED_PROXY_HEADERS = new Set([
  "host",
  "origin",
  "referer",
  "connection",
  "content-length",
  "accept-encoding",
  "upgrade-insecure-requests",
]);

/** Development: every request goes to Vite, which serves the interface with hot reload. */
const proxyToDevServer = (request: Request, devUrl: string) => {
  const url = new URL(request.url);
  const headers = new Headers();
  for (const [name, value] of request.headers) {
    if (!DROPPED_PROXY_HEADERS.has(name) && !name.startsWith("sec-fetch-")) {
      headers.set(name, value);
    }
  }
  return net.fetch(new URL(`${url.pathname}${url.search}`, devUrl).toString(), {
    method: request.method,
    headers,
  });
};

/**
 * The file a request names under `root`, or `index.html` for a page, since
 * the interface routes itself. Nothing outside `root` is served.
 */
const resolveAssetPath = (
  root: string,
  requestUrl: string,
  acceptsHtml: boolean,
): string | undefined => {
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(requestUrl).pathname);
  } catch {
    return undefined;
  }
  if (pathname.includes("\0")) return undefined;
  const resolvedRoot = NodePath.resolve(root);
  const assetPath = NodePath.resolve(resolvedRoot, `.${pathname}`);
  if (assetPath !== resolvedRoot && !assetPath.startsWith(resolvedRoot + NodePath.sep)) {
    return undefined;
  }
  if (NodeFS.statSync(assetPath, { throwIfNoEntry: false })?.isFile()) return assetPath;
  if (NodePath.extname(assetPath) !== "" && !acceptsHtml) return undefined;
  return NodePath.join(resolvedRoot, "index.html");
};

/** Outside development: the interface's build, `apps/server/dist/client`. */
const serveAsset = (request: Request, assetDirectory: string) => {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response(null, { status: 405 });
  }
  const acceptsHtml = request.headers.get("accept")?.includes("text/html") ?? false;
  const assetPath = resolveAssetPath(assetDirectory, request.url, acceptsHtml);
  if (assetPath === undefined) return new Response(null, { status: 404 });
  return net.fetch(NodeURL.pathToFileURL(assetPath).toString());
};

/**
 * What the window's page may load and reach: its own files, and the local
 * server over HTTP and WebSocket (plus Vite's socket in development). A
 * trimmed `makeDesktopContentSecurityPolicy` from T3 Code, without its sign-in
 * and challenge sources.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "connect-src 'self' http://127.0.0.1:* ws://127.0.0.1:* ws://localhost:*",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "form-action 'self'",
].join("; ");

const withContentSecurityPolicy = async (response: Response | Promise<Response>) => {
  const resolved = await response;
  const headers = new Headers(resolved.headers);
  headers.set("content-security-policy", CONTENT_SECURITY_POLICY);
  return new Response(resolved.body, {
    status: resolved.status,
    statusText: resolved.statusText,
    headers,
  });
};

/** Serves the window's interface under the URL scheme. */
export const handleDesktopProtocol = (
  scheme: string,
  source: { readonly devUrl: string } | { readonly assetDirectory: string },
) =>
  protocol.handle(scheme, (request) => {
    if (new URL(request.url).host !== DESKTOP_HOST) return new Response(null, { status: 404 });
    return withContentSecurityPolicy(
      "devUrl" in source
        ? proxyToDevServer(request, source.devUrl)
        : serveAsset(request, source.assetDirectory),
    );
  });
