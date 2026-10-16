import { defineRule } from "@oxlint/plugins";

// Whole module names whose namespace is not the plain PascalCase of the name.
const moduleNamespaces: Record<string, string> = {
  "assert/strict": "NodeAssert",
  "fs/promises": "NodeFSP",
};

// Path segments spelled as acronyms.
const segmentNames: Record<string, string> = {
  fs: "FS",
  os: "OS",
  url: "URL",
  vm: "VM",
};

const pascalCase = (segment: string) =>
  segment
    .split(/[-_]/u)
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");

/** `node:child_process` → `NodeChildProcess`, `node:fs/promises` → `NodeFSP`. */
const namespaceFor = (moduleName: string): string =>
  moduleNamespaces[moduleName] ??
  `Node${moduleName
    .split("/")
    .map((segment) => segmentNames[segment] ?? pascalCase(segment))
    .join("")}`;

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Import each Node.js built-in as one namespace with its canonical name, so every file reads the same.",
    },
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        const source = node.source.value;
        if (typeof source !== "string" || !source.startsWith("node:")) return;

        const expected = namespaceFor(source.slice("node:".length));
        const [only, ...rest] = node.specifiers;
        const isExpectedNamespace =
          rest.length === 0 &&
          only?.type === "ImportNamespaceSpecifier" &&
          only.local.name === expected;
        if (isExpectedNamespace) return;

        context.report({
          node,
          message: `Import ${source} as a namespace named ${expected}.`,
        });
      },
    };
  },
});
