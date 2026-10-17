import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import "vite-plus/test/config";
import { defineConfig, type Plugin } from "vite-plus";

import {
  DEV_PROXIED_ORIGIN_PRESERVING_PREFIXES,
  DEV_PROXIED_PATH_PREFIXES,
} from "@playstead/shared/devProxy";
import { identity } from "@playstead/shared/identity";

const variable = (name: string) => process.env[`${identity.environmentVariablePrefix}${name}`];

// Set by the development runner (scripts/dev-runner.ts).
const webPort = Number(variable("WEB_PORT") ?? 5833);
const serverPort = Number(variable("PORT")?.trim());
const devProxyTarget =
  Number.isInteger(serverPort) && serverPort > 0 ? `http://localhost:${serverPort}/` : undefined;

/**
 * Fills index.html's empty `<title>` with the product name before the
 * interface loads: the development name from the dev server, as `branding.ts`
 * does with `import.meta.env.DEV`.
 */
const productNameTitle = (): Plugin => ({
  name: "playstead:product-name-title",
  transformIndexHtml: (html, context) =>
    html.replace(
      "<title></title>",
      `<title>${
        context.server === undefined
          ? identity.productName.production
          : identity.productName.development
      }</title>`,
    ),
});

export default defineConfig({
  plugins: [
    tanstackRouter({ autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    productNameTitle(),
  ],
  resolve: {
    dedupe: ["react", "react-dom"],
  },
  server: {
    host: "localhost",
    port: webPort,
    strictPort: true,
    // The desktop window's page is at `playstead-dev://app/`, which Vite's
    // client cannot open a socket to; it reaches Vite directly instead.
    hmr: { protocol: "ws", host: "localhost", clientPort: webPort },
    // In development the interface talks to the server through this proxy,
    // on the page's own origin. The server's catch-all answers the same list
    // with 404, so the two cannot drift.
    ...(devProxyTarget
      ? {
          proxy: Object.fromEntries(
            DEV_PROXIED_PATH_PREFIXES.map((prefix) => [
              prefix,
              {
                target: devProxyTarget,
                changeOrigin: !DEV_PROXIED_ORIGIN_PRESERVING_PREFIXES.has(prefix),
                ...(prefix === "/ws" ? { ws: true } : {}),
              },
            ]),
          ),
        }
      : {}),
  },
  // @tailwindcss/vite emits a CSS sourcemap only with devSourcemap on.
  css: {
    devSourcemap: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
