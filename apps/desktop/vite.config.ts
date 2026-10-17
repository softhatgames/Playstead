import "vite-plus/test/config";
import { defineConfig, mergeConfig } from "vite-plus";

import baseConfig from "../../vite.config.ts";

const isElectron = (id: string) => id === "electron" || id.startsWith("electron/");

export default mergeConfig(
  baseConfig,
  defineConfig({
    run: {
      tasks: {
        // As T3 Code's `apps/desktop/vite.config.ts`: the desktop app needs the
        // built server, which carries the interface's build in `dist/client`.
        build: {
          command: "vp pack",
          dependsOn: ["@playstead/server#build"],
          cache: false,
        },
        // The window's interface comes from Vite with hot reload; a change to
        // the main process needs a restart.
        dev: {
          command: "vp pack && node scripts/dev-electron.ts",
          dependsOn: ["@playstead/server#build"],
          cache: false,
        },
      },
    },
    pack: [
      {
        // Everything but Electron itself goes into the bundle.
        format: "cjs",
        outDir: "dist-electron",
        dts: false,
        sourcemap: true,
        outExtensions: () => ({ js: ".cjs" }),
        outputOptions: { codeSplitting: false },
        entry: ["src/main.ts"],
        clean: true,
        deps: {
          alwaysBundle: (id: string) => !id.startsWith("node:") && !isElectron(id),
          neverBundle: isElectron,
          onlyBundle: false,
        },
      },
      {
        // A sandboxed preload must be one self-contained file.
        format: "cjs",
        outDir: "dist-electron",
        dts: false,
        sourcemap: true,
        outExtensions: () => ({ js: ".cjs" }),
        outputOptions: { codeSplitting: false },
        entry: ["src/preload.ts"],
        clean: false,
        deps: { neverBundle: isElectron },
      },
    ],
    test: {
      // The backend tests start the real server as a child process.
      fileParallelism: false,
    },
  }),
);
