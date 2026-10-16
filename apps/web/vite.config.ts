import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import "vite-plus/test/config";
import { defineConfig } from "vite-plus";

import {
  DEV_PROXIED_ORIGIN_PRESERVING_PREFIXES,
  DEV_PROXIED_PATH_PREFIXES,
} from "@playstead/shared/devProxy";

// Set by the development runner (scripts/dev-runner.ts).
const webPort = Number(process.env.PLAYSTEAD_WEB_PORT ?? 5833);
const serverPort = Number(process.env.PLAYSTEAD_PORT?.trim());
const devProxyTarget =
  Number.isInteger(serverPort) && serverPort > 0 ? `http://localhost:${serverPort}/` : undefined;

export default defineConfig({
  plugins: [tanstackRouter({ autoCodeSplitting: true }), react(), tailwindcss()],
  resolve: {
    dedupe: ["react", "react-dom"],
  },
  server: {
    host: "localhost",
    port: webPort,
    strictPort: true,
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
