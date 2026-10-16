import "vite-plus/test/config";
import { defineConfig } from "vite-plus";

const generatedAndVendored = [
  ".repos/**",
  "dist",
  "dist-electron",
  "node_modules",
  "pnpm-lock.yaml",
  "*.tsbuildinfo",
  "**/routeTree.gen.ts",
];

export default defineConfig({
  test: {
    environment: "node",
    exclude: [
      "**/.repos/**",
      "**/.playstead/**",
      "**/node_modules/**",
      "**/dist/**",
      "**/dist-electron/**",
      "**/.{idea,git,cache,output,temp}/**",
    ],
    hookTimeout: 60_000,
    testTimeout: 60_000,
  },
  staged: {
    "*": "vp fmt --no-error-on-unmatched-pattern",
  },
  fmt: {
    // Research notes quote code and output as it was observed.
    ignorePatterns: [
      ...generatedAndVendored,
      "docs/research/**",
      "dev/skills/**",
      "skills/**",
      ".agents/**",
    ],
    sortPackageJson: {},
  },
  lint: {
    ignorePatterns: [".repos", ...generatedAndVendored],
    plugins: ["eslint", "oxc", "unicorn", "typescript"],
    jsPlugins: ["./oxlint-plugin-playstead/index.ts"],
    categories: {
      correctness: "warn",
      suspicious: "warn",
      perf: "warn",
    },
    rules: {
      "unicorn/no-array-sort": "off",
      "unicorn/consistent-function-scoping": "off",
      "oxc/no-map-spread": "off",
      "eslint/no-shadow": "off",
      "eslint/no-await-in-loop": "off",
      "eslint/no-underscore-dangle": "off",
      "playstead/namespace-node-imports": "error",
    },
    options: {
      reportUnusedDisableDirectives: "error",
      typeAware: false,
      typeCheck: false,
    },
  },
});
