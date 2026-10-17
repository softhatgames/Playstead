import { definePlugin } from "@oxlint/plugins";

import namespaceNodeImports from "./rules/namespace-node-imports.ts";

/** Playstead's own lint rules, turned on in the root vite.config.ts. */
export default definePlugin({
  meta: {
    name: "playstead",
  },
  rules: {
    "namespace-node-imports": namespaceNodeImports,
  },
});
