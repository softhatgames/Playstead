import "vite-plus/test/config";
import { defineConfig, mergeConfig } from "vite-plus";

import baseConfig from "../../vite.config.ts";

export default mergeConfig(
  baseConfig,
  defineConfig({
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
