// @effect-diagnostics nodeBuiltinImport:off -- The build copies the interface with plain Node.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import "vite-plus/test/config";
import { defineConfig, mergeConfig } from "vite-plus";

import baseConfig from "../../vite.config.ts";

const webDist = NodePath.join(import.meta.dirname, "..", "web", "dist");
const clientDist = NodePath.join(import.meta.dirname, "dist", "client");

export default mergeConfig(
  baseConfig,
  defineConfig({
    run: {
      tasks: {
        // T3 Code's `apps/server/scripts/cli.ts build`: the bundle, then the
        // interface's build in `dist/client`, which the server serves to
        // browsers and the desktop app serves to its window.
        build: {
          command: "vp pack",
          dependsOn: ["@playstead/web#build"],
          cache: false,
        },
      },
    },
    pack: {
      entry: ["src/bin.ts"],
      outDir: "dist",
      format: "esm",
      sourcemap: true,
      clean: true,
      deps: {
        // Workspace packages are TypeScript source; the rest stays in node_modules.
        alwaysBundle: (id: string) => id.startsWith("@playstead/"),
      },
      onSuccess: () => {
        if (!NodeFS.existsSync(webDist)) return;
        NodeFS.rmSync(clientDist, { recursive: true, force: true });
        NodeFS.cpSync(webDist, clientDist, { recursive: true });
      },
    },
    test: {
      // Server tests share SQLite files, child processes and temporary folders,
      // and running files side by side makes them flaky under load, as T3 Code
      // found. Each file runs on its own.
      fileParallelism: false,
      hookTimeout: 120_000,
      testTimeout: 120_000,
    },
  }),
);
