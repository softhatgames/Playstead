#!/usr/bin/env node
// @effect-diagnostics preferSchemaOverJson:off -- It writes TypeScript source, quoting names with JSON.stringify.
/**
 * Generates `src/_generated/` from the JSON Schema that the installed Codex
 * writes about its own app-server protocol (`codex app-server
 * generate-json-schema`), so nothing is fetched and the schema matches the
 * Codex it came from. `pnpm --filter @playstead/effect-codex-app-server
 * generate [--codex <path>]`.
 *
 * Follows T3 Code's `packages/effect-codex-app-server/scripts/generate.ts` at
 * 2577baf, which downloads the same schema from openai/codex on GitHub: the
 * same normalizations for Effect's JSON Schema importer, the same
 * `@effect/openapi-generator`, and method maps for the typed client. It reads
 * the method lists from the schema's own request and notification unions
 * instead of parsing the TypeScript bindings.
 */
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { make as makeJsonSchemaGenerator } from "@effect/openapi-generator/JsonSchemaGenerator";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

type Json = Schema.Json;
type JsonObject = { readonly [key: string]: Json };

class GenerateError extends Schema.TaggedError<GenerateError>()("GenerateError", {
  detail: Schema.String,
}) {
  override get message() {
    return this.detail;
  }
}

const isObject = (value: Json | undefined): value is JsonObject =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Codex can add plans; a plan Playstead doesn't know must not fail `account/read`. As T3 Code. */
const DefinitionOverrides: Record<string, Json> = {
  PlanType: { type: "string" },
};

/** Responses whose names don't follow from their params' names. */
const ResponseNameOverrides: Record<string, string> = {
  "account/gatewayOAuth/cancel": "V2GatewayOAuthCancelResponse",
  "account/gatewayOAuth/login": "V2GatewayOAuthLoginResponse",
  "account/gatewayOAuth/read": "V2GatewayOAuthReadResponse",
  "account/logout": "V2LogoutAccountResponse",
  "account/rateLimits/read": "V2GetAccountRateLimitsResponse",
  "account/usage/read": "V2GetAccountTokenUsageResponse",
  "account/workspaceMessages/read": "V2GetWorkspaceMessagesResponse",
  "config/batchWrite": "V2ConfigWriteResponse",
  "config/value/write": "V2ConfigWriteResponse",
  "config/mcpServer/reload": "V2McpServerRefreshResponse",
  "externalAgentConfig/import/readHistories": "V2ExternalAgentConfigImportHistoriesReadResponse",
};

/** `#/definitions/X` is a root definition; `#/definitions/v2/X` is `V2X`. */
const definitionName = (ref: string): string => {
  const path = ref.replace(/^#\/definitions\//, "").split("/");
  return path.length === 2 ? `V2${path[1]}` : path[0]!;
};

/** Rewrites refs for the generator's components, and adapts the schema to Effect's importer. */
const normalize = (value: Json): Json => {
  if (Array.isArray(value)) return value.map(normalize);
  if (!isObject(value)) return value;
  const node: Record<string, Json> = {};
  for (const [key, child] of Object.entries(value)) {
    // Codex writes `default: null` on nullable fields; the importer can't type it.
    if (key === "$schema" || (key === "default" && child === null)) continue;
    node[key] =
      key === "$ref" && typeof child === "string"
        ? `#/components/schemas/${definitionName(child)}`
        : normalize(child);
  }
  // `type: ["string", "null"]` becomes an `anyOf`, which the importer reads as `NullOr`.
  if (Array.isArray(node.type) && node.type.includes("null") && node.type.length === 2) {
    const { type, ...rest } = node;
    const nonNull = (type as ReadonlyArray<Json>).find((entry) => entry !== "null")!;
    return { anyOf: [{ ...rest, type: nonNull }, { type: "null" }] };
  }
  const properties = node.properties;
  // Without `additionalProperties` the importer makes an open record; Codex's structs are closed.
  if (
    isObject(properties) &&
    Object.keys(properties).length > 0 &&
    !("additionalProperties" in node)
  ) {
    node.additionalProperties = false;
  }
  // The importer can't intersect shared fields with object alternatives, so
  // each alternative gets the shared fields.
  const alternativesKey = "anyOf" in node ? "anyOf" : "oneOf";
  const alternatives = node[alternativesKey];
  if (
    isObject(properties) &&
    Array.isArray(alternatives) &&
    alternatives.every((alternative) => isObject(alternative) && alternative.type === "object")
  ) {
    const {
      properties: _shared,
      required,
      type: _type,
      additionalProperties: _closed,
      ...rest
    } = node;
    const sharedRequired = Array.isArray(required) ? required : [];
    return {
      ...rest,
      [alternativesKey]: alternatives.map((alternative) => {
        const branch = alternative as JsonObject;
        const branchRequired = Array.isArray(branch.required) ? branch.required : [];
        return {
          ...branch,
          properties: { ...properties, ...(isObject(branch.properties) ? branch.properties : {}) },
          required: [...new Set([...sharedRequired, ...branchRequired])],
        };
      }),
    };
  }
  return node;
};

interface MethodEntry {
  readonly method: string;
  /** The params definition, or `undefined` when the message has none. */
  readonly params: string | undefined;
}

/** The methods in one of Codex's message unions, such as `ClientRequest`. */
const methodEntries = (union: Json | undefined, unionName: string): ReadonlyArray<MethodEntry> => {
  if (!isObject(union) || !Array.isArray(union.oneOf)) {
    throw new Error(`${unionName} is not a oneOf union`);
  }
  return union.oneOf.map((variant) => {
    const properties = isObject(variant) && isObject(variant.properties) ? variant.properties : {};
    const method =
      isObject(properties.method) && Array.isArray(properties.method.enum)
        ? properties.method.enum[0]
        : undefined;
    if (typeof method !== "string") throw new Error(`${unionName} has a variant without a method`);
    const params = properties.params;
    return {
      method,
      params:
        isObject(params) && typeof params.$ref === "string"
          ? definitionName(params.$ref)
          : undefined,
    };
  });
};

const pascalCaseMethod = (method: string) =>
  method
    .split(/[/_-]|(?=[A-Z])/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join("");

const responseName = (entry: MethodEntry, names: ReadonlySet<string>): string => {
  const candidates = [
    ResponseNameOverrides[entry.method],
    entry.params?.replace(/Params$/, "Response"),
    `V2${pascalCaseMethod(entry.method)}Response`,
    `${pascalCaseMethod(entry.method)}Response`,
  ];
  const found = candidates.find((name) => name !== undefined && names.has(name));
  if (found === undefined) throw new Error(`No response schema for ${entry.method}`);
  return found;
};

const schemaReference = (name: string | undefined) =>
  name === undefined ? "undefined" : `CodexSchema.${name}`;

const renderMethods = (
  entries: ReadonlyArray<MethodEntry>,
  prefix: string,
  methodType: string,
  schemas: ReadonlyArray<{
    readonly suffix: string;
    readonly name: (entry: MethodEntry) => string | undefined;
  }>,
) =>
  [
    `export type ${methodType} =`,
    ...entries.map((entry) => `  | ${JSON.stringify(entry.method)}`),
    ";",
    "",
    ...schemas.flatMap(({ suffix, name }) => [
      `export const ${prefix}_${suffix.toUpperCase()} = {`,
      ...entries.map(
        (entry) => `  ${JSON.stringify(entry.method)}: ${schemaReference(name(entry))},`,
      ),
      "} as const;",
      "",
    ]),
  ].join("\n");

const run = (command: string, args: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const child = yield* spawner.spawn(ChildProcess.make(command, args, { stderr: "inherit" }));
    const output = yield* child.stdout.pipe(Stream.decodeText(), Stream.mkString);
    const code = yield* child.exitCode;
    if (code !== 0) {
      return yield* new GenerateError({
        detail: `${command} ${args.join(" ")} exited with ${code}`,
      });
    }
    return output;
  }).pipe(Effect.scoped);

const decodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Json));

const generate = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const argv = process.argv.slice(2);
  const codexFlag = argv.indexOf("--codex");
  const codex = codexFlag === -1 ? "codex" : argv[codexFlag + 1]!;

  const version = (yield* run(codex, ["--version"])).trim();
  const schemaDirectory = yield* fs.makeTempDirectoryScoped({ prefix: "codex-schema-" });
  yield* run(codex, ["app-server", "generate-json-schema", "--out", schemaDirectory]);
  const bundle = yield* fs
    .readFileString(path.join(schemaDirectory, "codex_app_server_protocol.schemas.json"))
    .pipe(Effect.flatMap(decodeJson));
  if (!isObject(bundle) || !isObject(bundle.definitions) || !isObject(bundle.definitions.v2)) {
    return yield* new GenerateError({ detail: "Codex's schema bundle has no v2 definitions" });
  }
  const { v2, ...root } = bundle.definitions;

  const definitions: Record<string, Json> = {};
  for (const [namespace, group] of [
    ["", root],
    ["V2", v2],
  ] as const) {
    for (const [name, schema] of Object.entries(group)) {
      definitions[`${namespace}${name}`] = normalize(DefinitionOverrides[name] ?? schema);
    }
  }

  const generator = makeJsonSchemaGenerator();
  const names = Object.keys(definitions).toSorted((left, right) => left.localeCompare(right));
  for (const name of names) generator.addSchema(name, definitions[name] as never);
  const output = generator.generate("openapi-3.1", definitions as never, false);

  // The generator prints referenced definitions and then each named schema
  // again; keep the first of each.
  const declarations = new Map<string, string>();
  const lines = output.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^export type ([A-Za-z0-9_]+) = /.exec(lines[index]!);
    const runtime = lines[index + 1];
    if (match === null || runtime === undefined || !runtime.startsWith("export const ")) continue;
    if (!declarations.has(match[1]!)) declarations.set(match[1]!, `${lines[index]}\n${runtime}`);
    index += 1;
  }
  const generatedNames = new Set(declarations.keys());

  const clientRequests = methodEntries(root.ClientRequest, "ClientRequest");
  const clientNotifications = methodEntries(root.ClientNotification, "ClientNotification");
  const serverRequests = methodEntries(root.ServerRequest, "ServerRequest");
  const serverNotifications = methodEntries(root.ServerNotification, "ServerNotification");
  const params = (entry: MethodEntry) => entry.params;
  const response = (entry: MethodEntry) => responseName(entry, generatedNames);

  const header = [
    "// Generated by scripts/generate.ts. Do not edit.",
    `// From \`codex app-server generate-json-schema\` of ${version}.`,
    "",
  ];
  const schemaFile = [
    ...header,
    'import * as Schema from "effect/Schema";',
    "",
    ...declarations.values(),
    "",
  ];
  const metaFile = [
    ...header,
    'import * as CodexSchema from "./schema.gen.ts";',
    "",
    `export const CODEX_SCHEMA_VERSION = ${JSON.stringify(version)};`,
    "",
    renderMethods(clientRequests, "CLIENT_REQUEST", "ClientRequestMethod", [
      { suffix: "params", name: params },
      { suffix: "responses", name: response },
    ]),
    renderMethods(clientNotifications, "CLIENT_NOTIFICATION", "ClientNotificationMethod", [
      { suffix: "params", name: params },
    ]),
    renderMethods(serverRequests, "SERVER_REQUEST", "ServerRequestMethod", [
      { suffix: "params", name: params },
      { suffix: "responses", name: response },
    ]),
    renderMethods(serverNotifications, "SERVER_NOTIFICATION", "ServerNotificationMethod", [
      { suffix: "params", name: params },
    ]),
  ];

  const generatedDirectory = path.join(import.meta.dirname, "..", "src", "_generated");
  yield* fs.makeDirectory(generatedDirectory, { recursive: true });
  yield* fs.writeFileString(path.join(generatedDirectory, "schema.gen.ts"), schemaFile.join("\n"));
  yield* fs.writeFileString(path.join(generatedDirectory, "meta.gen.ts"), metaFile.join("\n"));
  yield* run("pnpm", ["exec", "vp", "fmt", generatedDirectory]);
  yield* Effect.log(`Generated the Codex app-server schema from ${version}`);
});

generate.pipe(Effect.scoped, Effect.provide(NodeServices.layer), NodeRuntime.runMain);
