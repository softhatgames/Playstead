# Effect 4 Schema, and Effect in the host

- **Question:** Can Effect 4 Schema replace Zod 4.6.7 in `packages/protocol` and its consumers, and which Effect 4 modules suit the Node host (HTTP and WebSocket, RPC, SQLite, child processes, tests)?
- **Date:** 2026-10-14. All sources were accessed on this date.
- **Versions examined:**
  - `effect@4.0.4` from npm (published 2026-10-13), matching Git tag [`effect@4.0.4`][tag] (`e17ecdb`).
  - `@effect/platform-node`, `@effect/platform-node-shared`, `@effect/sql-sqlite-node` and `@effect/vitest`, all 4.0.4.
  - TypeScript 6.0.3, Node 24.15.0, Vite 8.3.4, Vitest 5.0.4 and pnpm 12.11.2. Zod 4.6.7 was used only for comparison.
- **Documentation:** the repository [README][readme], [MIGRATION.md][migration], [Schema migration guide][mig-schema], [import rename map][mig-map], [Schema guide (`SCHEMA.md`)][schema-md], the AI guides under `ai-docs/` and the 4.0.0–4.0.4 release notes ([4.0.0][rel-400], [4.0.2][rel-402], [4.0.3][rel-403], [4.0.4][rel-404]). On effect.website: [installation][web-install], [importing][web-import], the [v4 API reference][web-api], the [4.0 release post][blog-40] and [first week][blog-week].
- **Source:** the packed npm tarballs and repository source at the tag.
- **Local evidence:** a throwaway project under `/tmp`, deleted afterwards. It type-checked and ran the code in this note, bundled browser entries with Vite 8 and ran `@effect/vitest`.

Labels: **Documented** (official docs or release notes), **Source** (code or package manifest at 4.0.4), **Observed** (local run), **Inference** (my reasoning), **Unconfirmed**.

## Summary for Playstead

- **One package, stable Schema.** Import `Schema` from `effect` (or `effect/Schema`). `@effect/schema` is deprecated on npm as "merged into the main effect package". The `Schema` module is tagged `@stability stable`, and Effect 4.x is an LTS line with at least three years of fixes ([readme], Source).
- **Plain decoding.** No runtime setup is needed. `Schema.decodeUnknownSync(S)(input)` throws a `Schema.SchemaError`, which is a real `Error` with a readable multi-line `message`. The non-throwing forms are `decodeUnknownResult`, `decodeUnknownOption` and `is` (Observed).
- **JSON in one step.** `Schema.fromJsonString(S)` parses and validates a JSON string, and `Schema.encodeSync` with the same schema produces one. Malformed JSON fails as a `SchemaError` (Observed).
- **Unknown fields are stripped by default.** The only alternative is `onExcessProperty: 'error'`. There is no `'preserve'` (Source, Observed). That suits Codex messages, where newer fields must be ignored.
- **Fits the toolchain.** Everything here type-checks under TypeScript 6.0.3 with Playstead's flags, even with `skipLibCheck: false`. The package is ESM-only and has no runtime dependencies (Observed, Source).
- **Browser cost.** The current protocol bundles to about 26.6 KiB gzip with Effect Schema, against 22.8 KiB with Zod (Observed, Vite 8).
- **Very new release.** 4.0.0 shipped on 2026-10-01 and four patch releases followed in 13 days. 4.0.2 narrowed which APIs carry the stability promise. Patches have also changed JSON Schema output. Pin exact versions (Documented).
- **Host integrations are all `unstable`.** That covers `effect/http`, `effect/socket`, `effect/rpc`, `effect/sql`, `effect/process` and every `@effect/*` package. They may break in minor releases. The core runtime (`Effect`, `Layer`, `Scope`, `Stream`, `Fiber`, `ManagedRuntime`, `Schema`) is stable (Source).
- **SQLite without an addon.** `@effect/sql-sqlite-node@4.0.4` uses Node's built-in `node:sqlite` (Source, Observed).
- **The website's Schema guide is v3.** For v4, use the repository's `SCHEMA.md` and the v4 API reference.

`packages/protocol/src/index.ts` rewritten with Effect 4 Schema (Observed: type-checked and run):

```ts
import { Schema } from 'effect';

export const protocolVersion = 1;

export const HostId = Schema.String.check(Schema.isUUID()).pipe(
  Schema.brand('HostId'),
);

export const HostStatus = Schema.Struct({
  protocolVersion: Schema.Literal(protocolVersion),
  hostId: HostId,
  phase: Schema.Literal('foundation'),
  capabilities: Schema.Struct({
    agentSessions: Schema.Boolean,
    remoteAccess: Schema.Boolean,
    gameRuntime: Schema.Boolean,
  }),
});

export const HostEvent = Schema.Union([
  Schema.Struct({ type: Schema.tag('host.status'), status: HostStatus }),
]).pipe(Schema.toTaggedUnion('type'));

export type HostStatus = typeof HostStatus.Type;
export type HostEvent = typeof HostEvent.Type;

// Both throw Schema.SchemaError, an Error with a readable message.
export const decodeHostEvent = Schema.decodeUnknownSync(
  Schema.fromJsonString(HostEvent),
);
export const encodeHostEvent = Schema.encodeSync(
  Schema.fromJsonString(HostEvent),
);
```

The consumers change as follows:

- `hostStatusSchema.parse(x)` becomes `Schema.decodeUnknownSync(HostStatus)(x)`.
- In `useHost.ts`, `hostEventSchema.parse(JSON.parse(data))` becomes `decodeHostEvent(data)`.
- The host can send `encodeHostEvent(event)`.

## 1. Package, import path and release status

- **Import path (Documented, Source).**
  - Use `import { Schema } from "effect"` or `import * as Schema from "effect/Schema"`. `SchemaAST`, `SchemaIssue`, `SchemaParser`, `SchemaGetter`, `SchemaTransformation`, `SchemaRepresentation`, `JsonSchema` and `StandardSchema` are sibling modules ([mig-map]).
  - The lower-case `effect/schema` subpath is different. It holds `Model`, `VariantSchema` and the JIT and AOT compilers, and all of it is unstable (Source: `dist/schema/index.d.ts`).
- **`@effect/schema` (Source).** npm marks it deprecated: "this package has been merged into the main effect package". Its last version is 0.75.5.
- **Repository (Documented).** Effect 4 lives on `Effect-TS/effect` `main`, and v3 moved to the `v3` branch. The development repository `Effect-TS/effect-smol` is archived and says "Effect V4 has moved" ([smol]).
- **Release status (Documented).**
  - The 4.0.0 notes call it "the first stable release of Effect v4" ([rel-400]). npm `latest` is 4.0.4. The `beta` and `rc` tags still point at prereleases.
  - The LTS terms promise at least three years of bug and security fixes, then one year of bug fixes and two years of security fixes after 5.0 ([readme], [blog-40]).
- **Compatibility policy (Documented).**
  - `@stability stable` exports, and exports with no tag, "follow strict semver".
  - `unstable` exports "may receive breaking changes in minor releases".
  - `experimental` exports may break "across patch versions" ([migration]).
  - All `effect` and `@effect/*` packages share one version and must move together.
- **Schema's own stability (Source).** `Schema`, `SchemaAST`, `SchemaIssue`, `SchemaParser`, `JsonSchema` and `StandardSchema` are tagged stable. Inside `Schema`, only the network-, cookie- and URL-parameter schemas (for example `Ipv4Address`, `Cookie`, `UrlParams`) are unstable, and the DNS and host schemas are experimental.

## 2. Decoding and encoding without the Effect runtime

- **Throwing (Source, Observed).**
  - `Schema.decodeUnknownSync(schema, options?)(input, options?)` returns the decoded value or throws `SchemaError`. `decodeSync` is the same function with input typed as `Encoded`.
  - `SchemaError` extends `Error`, has `_tag: "SchemaError"` and carries the issue tree in `.issue`. `Schema.isSchemaError(u)` narrows to it.
  - Its `message` is the default formatter's output, for example `Expected 1\n  at ["protocolVersion"]`. `JSON.stringify` gives `{_tag, message}`.
- **Non-throwing (Source, Observed).**
  - `decodeUnknownResult` returns `Result<A, SchemaError>`; check it with `Result.isFailure(r)` and read `r.failure`.
  - `decodeUnknownOption` returns `Option<A>`.
  - `decodeUnknownExit` returns an `Exit` and still runs synchronously. `decodeUnknownPromise` returns a promise.
  - `Schema.is(schema)(u)` is a type guard.
  - `Schema.asserts(schema, input)` narrows in place. On failure it throws a plain `Error("Schema validation failed")` with the issue in `cause`.
  - Only schema failures become `Failure` or `None`. Defects still throw ([schema-src-decode]).
- **Formatting (Documented, Observed).**
  - `SchemaIssue.makeFormatterStandardSchemaV1()(error.issue).issues` gives `[{ path, message }]`. `SchemaIssue.makeFormatterDefault()` gives a string.
  - Pass `{ errors: 'all' }` to collect every issue; the default stops at the first.
  - `{ reportInput: true }` puts rejected values into messages. The guide warns that this can disclose secrets ([schema-md#formatters]).
- **Encoding (Source, Observed).**
  - `Schema.encodeSync(schema)(value)` and `encodeUnknownSync` mirror decoding, and `encodeResult` and `encodeOption` exist too.
  - `Schema.fromJsonString(S)` is a codec between a JSON string and `S`. Bad JSON fails with "Expected a valid JSON string". `Schema.UnknownFromJsonString` parses without validating.
  - `Schema.toCodecJson(S)` derives a JSON-safe codec for non-JSON types such as `Date` or `Option` ([schema-md#fromjsonstring], [schema-md#json-canonical-codec]).
- **Gotcha (Observed).** The migration guide's formatter example looks for the issue in `error.cause` after `Schema.decodeUnknownSync` ([mig-schema#parseresult-formatters]). In 4.0.4, `SchemaError` keeps it in `error.issue`, and `cause` holds an issue only for `asserts` and the `SchemaParser.*Sync` variants.

## 3. Modelling

- **Structs (Documented, Observed).**
  - `Schema.Struct({...})` fields are readonly and required.
  - `Schema.optionalKey(S)` gives `a?: T`, which is exact. Under `exactOptionalPropertyTypes` it rejects an explicit `undefined`, both in types and at runtime.
  - `Schema.optional(S)` gives `a?: T | undefined`. `Schema.NullOr(S)` adds `null` ([schema-md#optional-fields]).
- **Literals (Documented, Observed).**
  - `Schema.Literal(1)` rejects `"1"`, and `Schema.Literal('foundation')` works the same way for strings.
  - Several values use `Schema.Literals([...])`, and `null` uses `Schema.Null`.
- **UUIDs and brands (Documented, Source).**
  - `Schema.UUID` no longer exists (Observed: type error). Use `Schema.String.check(Schema.isUUID())`.
  - Since 4.0.0, `Schema.brand('X')` is type-only and takes a single brand ([rel-400]).
- **Discriminated unions on `type` (Documented, Observed).**
  - Define each member with `type: Schema.tag('...')`, put them in `Schema.Union([...])` and add `.pipe(Schema.toTaggedUnion('type'))`.
  - The result offers `.cases`, `.guards`, `.isAnyOf` and `.match({...})`. `TaggedStruct`, `TaggedUnion` and `TaggedClass` all use `_tag`.
  - Union members are tried in order, and the first match wins. `{ mode: 'oneOf' }` makes the union exclusive ([schema-md#tagged-unions]).
  - An unknown tag fails with `Expected { readonly "type": "host.status", ... }` (Observed).
- **Records, arrays and integers (Documented).**
  - `Schema.Record(Key, Value)`, `Schema.Array(S)`, `Schema.Int` and `Schema.Number.check(Schema.isInt())` are available. `isInt` means `Number.isSafeInteger`.
  - Ranges use `Schema.isBetween({ minimum, maximum })`, `isInt32` or `isUint32`.
- **Recursive types (Documented, Observed).** Use `Schema.suspend((): Schema.Codec<T> => T)` with an explicit `Schema.Codec<T>` (or `Codec<T, Encoded>`) annotation ([schema-md#recursive-schemas]).
- **Class schemas (Documented, Observed).**
  - `Schema.Class` and `TaggedClass` decode to class instances with methods. `JSON.stringify` and `encodeSync` give plain objects.
  - `Schema.Opaque` gives a distinct type without a runtime class ([schema-md#classes-and-opaque-types]).
  - **Inference:** prefer plain `Struct` for wire messages. Values stay plain data for React state and comparisons, and the guide reserves classes for behaviour.
- **Types (Documented, Observed).** `typeof S.Type` and `typeof S.Encoded` give the decoded and encoded types. `Schema.Schema.Type<typeof S>` and `Schema.Codec.Encoded<typeof S>` do the same.

## 4. Unknown fields

- **Default (Source, Observed).**
  - `ParseOptions.onExcessProperty` is `"ignore" | "error"` and defaults to `"ignore"`, which "strips unspecified properties from the output". It applies to nested structs as well ([ast-parse]).
  - `Schema.is` returns `true` for objects with extra keys.
  - `'preserve'` is a type error in 4.0.4, though `HttpApi` documentation still mentions it.
- **Strict mode (Documented, Observed).** `{ onExcessProperty: 'error' }` fails with `Expected no excess property at ["extra"]`. Pass it when creating the decoder or on each call.
- **Keeping extra keys (Documented).** Model them with `Schema.StructWithRest(struct, [Schema.Record(...)])` ([schema-md#handling-unexpected-keys]).
- **Codex (Inference).**
  - The default suits Codex: newer fields are dropped rather than rejected.
  - Two consequences follow. The host cannot forward fields it has not modelled. A new notification `method` fails a closed union unless a catch-all member comes last.

## 5. JSON Schema and Standard Schema

- **Export (Documented, Observed).**
  - `Schema.toJsonSchemaDocument(S, options?)` returns `{ dialect: 'draft-2020-12', schema, definitions }`. The guide's examples still show the key as `source`.
  - It emits `additionalProperties: true` unless `{ onExcessProperty: 'error' }` is passed. `JsonSchema.toDocumentDraft07` converts the result to Draft-07 ([schema-md#exporting-json-schema]).
  - The guide calls the output "preliminary validation": the Effect decoder remains the authority.
  - Patch releases have changed the output: integer bounds changed in 4.0.3 and collapsed bounds in 4.0.4 ([rel-403], [rel-404]).
- **Import (Documented).**
  - `SchemaRepresentation.fromJsonSchemaDocument` imports a subset of Draft 2020-12 as a runtime schema. Patterns are rejected unless `patterns: 'apply'` is set ([schema-md#importing-json-schema]).
  - **Inference:** this could check, or generate from, Codex's generated JSON Schema, but import is best-effort.
- **Standard Schema (Source, Observed).**
  - Schemas carry no `~standard` property. Use `Schema.toStandardSchemaV1(S)` (vendor `effect`), which reported every issue in the probe.
  - `toStandardJSONSchemaV1` exists, and its documentation calls it experimental.

## 6. Bundle size and tree-shaking

- **Guidance (Documented).**
  - "A minimal Effect program bundles to 7.1 kB (minified + gzipped)" ([migration]).
  - Rolldown, which Vite 8 uses, handles named imports without tree-shaking problems ([web-import]).
  - `sideEffects` lists only the opt-in JIT `enable` module (Source).
- **Measured (Observed).** Vite 8.3.4 library builds of the current protocol plus one decode, minified, with gzip at level 9:

  | Entry                                                    | Minified  | Gzip     |
  | -------------------------------------------------------- | --------- | -------- |
  | Zod 4.6.7 (`z.object`, `z.uuid`, `discriminatedUnion`)   | 90.3 KiB  | 22.8 KiB |
  | Effect Schema, `import { Schema } from 'effect'`         | 96.2 KiB  | 26.6 KiB |
  | Effect Schema, `import * as Schema from 'effect/Schema'` | 94.1 KiB  | 26.0 KiB |
  | Effect Schema plus `RpcClient` over a browser WebSocket  | 181.1 KiB | 49.5 KiB |

- **Performance (Documented).** The guide's benchmark table puts Effect Schema near Zod 4.6.2 for parsing. Schema creation is slower than Valibot ([schema-md#runtime-performance]).

## 7. Compatibility

- **TypeScript (Documented, Observed).**
  - The README requires TypeScript 5.9 or newer with `strict`, and recommends TypeScript 7. The repository builds with `typescript ^7.0.2` and uses `exactOptionalPropertyTypes` and `verbatimModuleSyntax` itself ([readme], [repo-pkg]).
  - TypeScript 6 is not named, but 6.0.3 type-checked every probe with Playstead's flags and `skipLibCheck: false`.
- **ESM only (Source).** The package is `"type": "module"` and its `exports` map has no `require` condition.
- **Node (Documented, Observed).**
  - The README gives Node 18 as the minimum. The website's installation page says Node 22.18 or newer for running `.ts` files directly ([web-install]).
  - The probes ran on 24.15.0.
- **Vite 8 (Observed).** Builds succeed, and the repository itself uses `vite ^8.3.4` ([repo-pkg]).

## 8. Gotchas from the v3→v4 migration guide

- **Variadic arguments became arrays.** Use `Union([A, B])`, `Literals(['a', 'b'])` and `Tuple([...])`. `Record({ key, value })` becomes `Record(key, value)` ([mig-schema#summary-table]).
- **Renames.**
  - `parseJson` → `fromJsonString` and `decodeUnknownEither` → `decodeUnknownExit` (`decodeUnknownResult` is new).
  - `asserts(S)(x)` → `asserts(S, x)`, and `standardSchemaV1` → `toStandardSchemaV1`.
  - `validate*` has been removed.
  - Filters are now `.check(Schema.isX())`, and `positive`, `negative` and similar were removed.
- **`Schema.Date` changed silently.** It now expects a `Date` instance, so ISO strings need `Schema.DateFromString`. "Existing code can still type-check" while rejecting old input ([mig-schema#date-encoded-contract]).
- **Record keys.** Refined key schemas ignore non-matching keys and do not validate them ([mig-schema#record]).
- **Website docs.** effect.website/docs/schema/\* still documents v3, under a v4 banner ([web-v3-schema]).
- **Stale example.** The guide's "Primitives" example imports `Getter` and `Parser` from `effect/schema`, which 4.0.4 does not export (Source).

## Effect in the host

### Reading the API

Read these before searching type declarations. The first two exist once `pnpm install` has run; Claude Code sessions run it when `node_modules` is missing.

- `apps/host/node_modules/effect/AGENTS.md`: Effect's own coding rules, such as decoding with Schema instead of parsing by hand.
- `apps/host/node_modules/effect/ai-docs/src/index.md`: worked examples for testing, SQL, the HTTP server, child processes and more. It has none for RPC or sockets.
- For RPC and sockets, T3 Code's server in `apps/server/src/ws.ts` and its client in `packages/client-runtime/src/rpc/` (`protocol.ts`, `session.ts`). Clone [T3 Code](https://github.com/pingdotgg/t3code) to a temporary folder to read them.

### Module stability

- **Stability by area (Source: the first `@stability` tag of each module at 4.0.4).**

  | Area                  | Modules                                                                                                        | Stability                            |
  | --------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
  | Runtime               | `Effect`, `Layer`, `Scope`, `Stream`, `Sink`, `Fiber`, `Queue`, `PubSub`, `Schedule`, `Context`                | stable                               |
  | Runtime bridge        | `ManagedRuntime`                                                                                               | stable                               |
  | Validation            | `Schema`                                                                                                       | stable                               |
  | Test clock            | `effect/testing` `TestClock`                                                                                   | stable                               |
  | HTTP                  | `effect/http` (`HttpServer`, `HttpRouter`, `HttpStaticServer`, `HttpServerRequest`), `effect/http-api`         | unstable                             |
  | WebSocket and sockets | `effect/socket` (`Socket`, `SocketServer`)                                                                     | unstable                             |
  | RPC                   | `effect/rpc`                                                                                                   | unstable                             |
  | SQL                   | `effect/sql`                                                                                                   | unstable                             |
  | Processes             | `effect/process` (`ChildProcess`, `ChildProcessSpawner`)                                                       | unstable                             |
  | Platform services     | `FileSystem`, `Path`, `Stdio`, `PlatformError`, `encoding/Ndjson`                                              | unstable                             |
  | Separate packages     | `@effect/platform-node` (including `NodeRuntime`, `NodeServices`), `@effect/sql-sqlite-node`, `@effect/vitest` | unstable (all non-`effect` packages) |

- **No `effect/unstable/...` paths in 4.0.x (Documented).**
  - Betas and release candidates used `effect/unstable/*`. 4.0.0 moved these modules to `effect/<area>` without compatibility exports, and "moving these modules does not stabilize their APIs" ([migration]).
  - 4.0.2 tagged every export explicitly ([rel-402]).
  - The maintainers say some modules meant to be unstable shipped untagged, and therefore implicitly stable, in 4.0.0. They acknowledge that "narrowing a promise after a release is a breaking change in itself" ([blog-week]).
  - Effect's language service can warn on unstable use. `allowedUnstableApis` allows specific modules or exports.
- **The promise for unstable modules (Documented).** They may break in a minor release but not in a patch, and they still receive LTS fixes ([readme]).
  - **Inference:** with exact pins, every 4.x minor upgrade needs a deliberate review of host code.

### HTTP and WebSocket server

- **(a) Keep Fastify 5 (Documented, Inference).**
  - The official integration guide builds one `ManagedRuntime.make(AppLayer, { memoMap })` and calls `runtime.runPromise(...)` from handlers. It notes that "the same bridge pattern works for Express, Fastify, Koa" and disposes the runtime on shutdown ([ai-runtime]).
  - **Inference:** for WebSockets, use `runtime.runFork(connection)` per socket, interrupt the fiber on `close` and call `runtime.dispose()` from Fastify's `onClose`.
  - The `onRequest` Host and Origin hook and the `app.inject` and `listen({ port: 0 })` tests stay as they are. Only stable Effect modules are involved.
- **(b) Effect's server (Source, Observed).**
  - Use `NodeHttpServer.layer(createServer, { port, host })` from `@effect/platform-node`, with `HttpRouter.add(method, path, handler)` and `HttpRouter.serve(routes, { middleware })`.
  - Static files come from `HttpStaticServer.layer` or `HttpStaticServer.make`. It handles index files, an SPA fallback, ranges and 304 responses.
  - WebSocket upgrade goes through `(yield* HttpServerRequest.HttpServerRequest).upgrade`, which gives a `Socket`. Node upgrades use the `ws` package. `ws` is pure JavaScript, and its native helpers are optional peers ([node-http]).
  - **Observed:** a health route and a WebSocket push worked on Node 24.15. Writing before acquiring `socket.reader` hung, because "acquiring `reader` establishes the connection" and writes made before then wait ([socket]).
  - **Tests:** `NodeHttpServer.layerTest` serves on port 0 and supplies an `HttpClient`. `HttpRouter.toWebHandler(layer)` gives an in-memory `Request` → `Response` handler, comparable to `inject`.
  - **Inference:** Host and Origin checks would move into `HttpRouter.middleware` or the `serve` `middleware` option. All of this is unstable.

### RPC

- **Capabilities (Source).**
  - `effect/rpc` provides `Rpc.make(tag, { payload, success, error, stream: true })`, `RpcGroup.make` and `RpcServer.layerProtocolWebsocket` or `toHttpEffectWebsocket`.
  - On the client, `RpcClient.layerProtocolSocket()` combines with `Socket.layerWebSocket(url)` and `Socket.layerWebSocketConstructorGlobal`.
  - Serialisations: `layerJson`, `layerNdjson`, `layerJsonRpc` and `layerSchemaBinary`.
  - The client pings every 5 s and retries socket errors. "A ping timeout fails in-flight calls": nothing is replayed after a reconnect ([rpc-client]). All of it is unstable.
- **Fit (Inference).** Streaming RPCs suit an event subscription. Sequence numbers, resuming from a cursor and idempotent command keys would still be Playstead's own payload fields.
- **Browser cost (Observed).**
  - Schema plus `RpcClient` over WebSocket is 49.5 KiB gzip, against 26.6 KiB for Schema alone.
  - The client also needs the Effect runtime (`Effect.runFork`) in the browser. **Inference:** that conflicts with keeping the web client plain React.

### SQLite

- **`@effect/sql-sqlite-node@4.0.4` (Documented, Source, Observed).**
  - It is "built on the built-in `node:sqlite` module" (`DatabaseSync`, `backup`) and requires Node 22.16 or newer. It has no dependencies and so no native addon ([sqlite-readme], [sqlite-client]).
  - It serialises access through one connection, enables WAL by default and waits up to five seconds on a busy database. Its documentation warns that "busy waits block the Node.js event loop". Streaming queries are not supported. `SqliteMigrator` is included. Everything is unstable.
  - **Observed:** `SqliteClient.layer({ filename: ':memory:' })` created, inserted and selected rows on Node 24.15.
- **Other clients (Documented, Source).**
  - The other v4 SQLite clients are `sql-sqlite-wasm` (peer `@effect/wa-sqlite`), `-bun`, `-do`, `-react-native` and `sql-libsql` ([readme]).
  - None uses `better-sqlite3`. The v3-era `@effect/sql-sqlite-node@0.x` depended on it.
- **Playstead (Inference).** `node:sqlite` became a release candidate in Node 24.15, the pinned runtime ([node-sqlite]); the bundled `@types/node` still labels it experimental. Either way, the storage module keeps the replaceable boundary.

### Child processes

- **Official API (Documented, Source, Observed).**
  - Build a command with `ChildProcess.make(cmd, args, { cwd, env, extendEnv })` from `effect/process`. Run it through `ChildProcessSpawner.ChildProcessSpawner`, provided by `NodeServices.layer` ([ai-proc]).
  - `spawner.spawn(cmd)` is scoped and returns a handle with:
    - `pid`
    - `stdin: Sink<void, Uint8Array>`
    - `stdout`, `stderr` and `all`, each a `Stream<Uint8Array>`
    - `exitCode`
    - `isRunning`
    - `kill({ killSignal, forceKillAfter })` ([cp-spawner])
  - **Observed:** JSONL went to stdin via `Stream.encodeText` and `Stream.run(handle.stdin)`, came back through `handle.stdout.pipe(Stream.decodeText(), Stream.splitLines)`, and the process stopped after `kill`.
- **Termination (Source).**
  - Closing the scope kills the process. On POSIX it signals the process group (`detached` defaults to `true`) and waits up to one second, or escalates to `SIGKILL` after `forceKillAfter`.
  - On Windows, "`taskkill` terminates the tree while the leader is running … Descendants that outlive the leader are left running" ([spawner]).
  - Both modules are unstable.
- **Stable-only alternative (Inference).**
  - Wrap `node:child_process.spawn` in `Effect.acquireRelease` and read `Stream.fromAsyncIterable(child.stdout)` with `Stream.decodeText` and `Stream.splitLines`, all of which are stable.
  - Playstead would then own process-group and Windows tree termination. `NodeStream.fromReadable` exists but is unstable.

### Testing

- **`@effect/vitest@4.0.4` (Documented, Source, Observed).**
  - Its peers are `vitest >=5.0.0 <6.0.0` and `effect ^4.0.4`. The README says Vitest 5 supports Node `^22.12.0 || ^24.0.0 || >=26.0.0` and Vite 6.4 or later ([vitest-readme]).
  - It provides `it.effect`, `it.live`, `it.effect.prop` and `layer(L)('name', (it) => ...)`, with `TestClock.adjust` from `effect/testing` ([ai-test]).
  - **Observed:** a `TestClock` test and a layer test passed under Vitest 5.0.4. The package is unstable, while `TestClock` is stable.
- **Networked tests use `it.live` (Observed).** `it.effect` runs on the test clock, so an RPC client over a real socket waits forever for time that never passes.
- **Build the client's protocol layer in the test's scope (Observed).** Providing `RpcClient.layerProtocolSocket()` straight to `RpcClient.make` closes the socket once `make` returns, and the first call hangs. Build it with `yield* Layer.build(protocol)` inside a scoped test, as `apps/host/test/host.test.ts` does.

### Versions to pin

- **Packages (Source).** Every package is at 4.0.4, and npm `latest` points to that version.

  | Package                        | Published (UTC)  | Dependencies                             | Peers                                    |
  | ------------------------------ | ---------------- | ---------------------------------------- | ---------------------------------------- |
  | `effect`                       | 2026-10-13 05:25 | none                                     | none                                     |
  | `@effect/platform-node`        | 2026-10-13 04:31 | `undici ^8.11.2`, `platform-node-shared` | `effect ^4.0.4`, `redis >=5.0.0 <7.0.0`  |
  | `@effect/platform-node-shared` | 2026-10-13 04:32 | `ws ^8.22.0`, `@types/ws ^8.18.2`        | `effect ^4.0.4`                          |
  | `@effect/sql-sqlite-node`      | 2026-10-13 04:32 | none                                     | `effect ^4.0.4`                          |
  | `@effect/vitest`               | 2026-10-13 04:31 | none                                     | `effect ^4.0.4`, `vitest >=5.0.0 <6.0.0` |

- **`redis` peer (Source, Observed).** `redis` is not marked optional. pnpm 12.11.2 installed `redis@6.3.0` and five `@redis/*` packages with `@effect/platform-node`, although only `NodeRedis` uses them.
- **Release age (Observed, Documented).**
  - From the repository root, `pnpm config get minimumReleaseAge` prints `undefined`, so no value is configured. `pnpm-workspace.yaml` only lists exclusions, for Electron and Fastify.
  - pnpm's default is 1440 minutes since v11. That default is non-strict: if no version is old enough, pnpm falls back rather than failing ([pnpm-mra]).
  - 4.0.4 was about 31 hours old at 13:04 UTC, and a pnpm 12 install of it gave no warning.

### Options for items 2–5

| Need               | Option                                                                    | Stability                                                                         | Native addon                       | Notes                                                                                         |
| ------------------ | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------- |
| HTTP and WebSocket | Fastify 5 with a `ManagedRuntime` bridge                                  | Effect parts stable                                                               | No                                 | Keeps the Host and Origin hook, `inject` and port-0 tests; documented bridge                  |
| HTTP and WebSocket | `NodeHttpServer`, `HttpRouter`, `HttpStaticServer`, `Socket`              | unstable                                                                          | No (`ws`; native helpers optional) | One runtime; pulls in the `redis` peer; tests need rewriting; acquire `reader` before writing |
| Client protocol    | Plain WebSocket messages with shared Schema                               | stable                                                                            | No                                 | Client stays plain React; sequencing and idempotency are Playstead's design                   |
| Client protocol    | `effect/rpc` over WebSocket                                               | unstable                                                                          | No                                 | About 23 KiB more gzip and the Effect runtime in the browser; no replay after reconnect       |
| SQLite             | `@effect/sql-sqlite-node`                                                 | unstable                                                                          | No (`node:sqlite`)                 | Node 22.16+; one synchronous connection; WAL; migrator                                        |
| SQLite             | `node:sqlite` behind Playstead's own Effect service                       | stable Effect APIs; `node:sqlite` release candidate in Node 24.15 ([node-sqlite]) | No                                 | Smallest surface; Playstead writes the transaction and migration helpers                      |
| Child processes    | `effect/process` with `NodeServices.layer`                                | unstable                                                                          | No                                 | Scoped process-group kill, `forceKillAfter`, Windows `taskkill` tree; JSONL observed          |
| Child processes    | `node:child_process` with `acquireRelease` and `Stream.fromAsyncIterable` | stable                                                                            | No                                 | Playstead must implement group and tree termination, including on Windows                     |

### T3 Code's choices (reference, non-authoritative)

[pingdotgg/t3code][t3-main] at commit `7ac952c` (main, 2026-10-14) solves the same problem with Effect 4. It is a reference for patterns, not guidance from Effect; counts are of import statements in `apps/server`, `apps/web` and `packages` (Observed).

- **Versions.** The catalogue pins `effect`, `@effect/platform-node`, `@effect/platform-node-shared`, `@effect/vitest` and `@effect/openapi-generator` at exactly 4.0.4 (`pnpm-workspace.yaml`); `@effect/vitest` carries a local patch.
- **HTTP and WebSocket.** No Fastify. `apps/server/src/server.ts` builds the server with `NodeHttpServer.layer` over `node:http` and `HttpRouter` from `effect/http`.
- **Client protocol.** Effect RPC over WebSocket. `apps/server/src/ws.ts` uses `RpcServer.makeProtocolWithHttpEffectWebsocket` with an `RpcGroup`; the browser connects through `RpcClient`, `RpcSerialization` and `effect/socket/Socket` in `packages/client-runtime`, and the web app uses `@effect/atom-react` for state.
- **SQLite.** `effect/sql`'s `SqlClient` and `Migrator`, through T3 Code's own port of `@effect/sql-sqlite-node` onto `node:sqlite` (`packages/shared/src/nodeSqliteClient.ts`). Its persistence layer includes a sequenced event store and command receipts, the same shape as [decision 0010](https://github.com/softhatgames/playstead-v0/blob/v0/docs/adr/0010-host-conversation-record.md).
- **Processes.** `effect/process` (`ChildProcess`, `ChildProcessSpawner`) with `NodeServices`, including for the Codex App Server client in `packages/effect-codex-app-server`.
- **Codex schemas.** Generated as Effect Schema from the Codex App Server JSON Schema with `@effect/openapi-generator`'s `JsonSchemaGenerator`, pinned to an upstream commit (`packages/effect-codex-app-server/scripts/generate.ts`).
- **Stability.** Every integration module above is in the unstable tier described in this section. T3 Code accepts that with exact pins.

## Limits and unconfirmed points

- **Not run.**
  - Windows behaviour.
  - Fastify combined with `ManagedRuntime`.
  - A full `RpcServer` round trip.
  - Effect's server running behind the Vite development proxy.
- **Bundle figures** come from a library build of one entry, not Playstead's application build. Zod's smaller `zod/mini` was not measured.
- **TypeScript 6** support is Observed, not Documented: the README names only 5.9 or newer, and TypeScript 7.
- **Website docs.** The v4 site has only getting-started pages and the API reference, so Schema behaviour here relies on `SCHEMA.md` and source, which disagree in places (`dialect` versus `source`, `error.cause`).
- **Release cadence.** No 4.1 release exists yet, so how often unstable APIs break across minor releases is **Unconfirmed**.
- **Codex schema import.** Whether `SchemaRepresentation.fromJsonSchemaDocument` can import Codex's generated schema without unsupported keywords is **Unconfirmed**.

[tag]: https://github.com/Effect-TS/effect/tree/e17ecdbe902aa7108f775c8ab9c0ddf9f38801ab
[readme]: https://github.com/Effect-TS/effect/blob/e17ecdbe902aa7108f775c8ab9c0ddf9f38801ab/README.md
[migration]: https://github.com/Effect-TS/effect/blob/e17ecdbe902aa7108f775c8ab9c0ddf9f38801ab/MIGRATION.md
[mig-schema]: https://github.com/Effect-TS/effect/blob/e17ecdbe902aa7108f775c8ab9c0ddf9f38801ab/migration/schema.md
[mig-schema#summary-table]: https://github.com/Effect-TS/effect/blob/e17ecdbe902aa7108f775c8ab9c0ddf9f38801ab/migration/schema.md#summary-table
[mig-schema#parseresult-formatters]: https://github.com/Effect-TS/effect/blob/e17ecdbe902aa7108f775c8ab9c0ddf9f38801ab/migration/schema.md#parseresult-formatters
[mig-schema#date-encoded-contract]: https://github.com/Effect-TS/effect/blob/e17ecdbe902aa7108f775c8ab9c0ddf9f38801ab/migration/schema.md#date-encoded-contract
[mig-schema#record]: https://github.com/Effect-TS/effect/blob/e17ecdbe902aa7108f775c8ab9c0ddf9f38801ab/migration/schema.md#record
[mig-map]: https://github.com/Effect-TS/effect/blob/e17ecdbe902aa7108f775c8ab9c0ddf9f38801ab/migration/v3-to-v4.md
[schema-md]: https://github.com/Effect-TS/effect/blob/e17ecdbe902aa7108f775c8ab9c0ddf9f38801ab/packages/effect/SCHEMA.md
[schema-md#formatters]: https://github.com/Effect-TS/effect/blob/e17ecdbe902aa7108f775c8ab9c0ddf9f38801ab/packages/effect/SCHEMA.md#formatters
[schema-md#fromjsonstring]: https://github.com/Effect-TS/effect/blob/e17ecdbe902aa7108f775c8ab9c0ddf9f38801ab/packages/effect/SCHEMA.md#fromjsonstring
[schema-md#json-canonical-codec]: https://github.com/Effect-TS/effect/blob/e17ecdbe902aa7108f775c8ab9c0ddf9f38801ab/packages/effect/SCHEMA.md#json-canonical-codec
[schema-md#optional-fields]: https://github.com/Effect-TS/effect/blob/e17ecdbe902aa7108f775c8ab9c0ddf9f38801ab/packages/effect/SCHEMA.md#optional-fields
[schema-md#tagged-unions]: https://github.com/Effect-TS/effect/blob/e17ecdbe902aa7108f775c8ab9c0ddf9f38801ab/packages/effect/SCHEMA.md#tagged-unions
[schema-md#recursive-schemas]: https://github.com/Effect-TS/effect/blob/e17ecdbe902aa7108f775c8ab9c0ddf9f38801ab/packages/effect/SCHEMA.md#recursive-schemas
[schema-md#classes-and-opaque-types]: https://github.com/Effect-TS/effect/blob/e17ecdbe902aa7108f775c8ab9c0ddf9f38801ab/packages/effect/SCHEMA.md#classes-and-opaque-types
[schema-md#handling-unexpected-keys]: https://github.com/Effect-TS/effect/blob/e17ecdbe902aa7108f775c8ab9c0ddf9f38801ab/packages/effect/SCHEMA.md#handling-unexpected-keys
[schema-md#exporting-json-schema]: https://github.com/Effect-TS/effect/blob/e17ecdbe902aa7108f775c8ab9c0ddf9f38801ab/packages/effect/SCHEMA.md#exporting-json-schema
[schema-md#importing-json-schema]: https://github.com/Effect-TS/effect/blob/e17ecdbe902aa7108f775c8ab9c0ddf9f38801ab/packages/effect/SCHEMA.md#importing-json-schema
[schema-md#runtime-performance]: https://github.com/Effect-TS/effect/blob/e17ecdbe902aa7108f775c8ab9c0ddf9f38801ab/packages/effect/SCHEMA.md#runtime-performance
[schema-src-decode]: https://github.com/Effect-TS/effect/blob/e17ecdbe902aa7108f775c8ab9c0ddf9f38801ab/packages/effect/src/Schema.ts#L1207-L1905
[ast-parse]: https://github.com/Effect-TS/effect/blob/e17ecdbe902aa7108f775c8ab9c0ddf9f38801ab/packages/effect/src/SchemaAST.ts#L479-L539
[repo-pkg]: https://github.com/Effect-TS/effect/blob/e17ecdbe902aa7108f775c8ab9c0ddf9f38801ab/package.json
[rel-400]: https://github.com/Effect-TS/effect/releases/tag/effect%404.0.0
[rel-402]: https://github.com/Effect-TS/effect/releases/tag/effect%404.0.2
[rel-403]: https://github.com/Effect-TS/effect/releases/tag/effect%404.0.3
[rel-404]: https://github.com/Effect-TS/effect/releases/tag/effect%404.0.4
[smol]: https://github.com/Effect-TS/effect-smol
[web-install]: https://effect.website/docs/v4/getting-started/installation
[web-import]: https://effect.website/docs/v4/getting-started/importing-effect
[web-api]: https://effect.website/docs/v4/api/effect/Schema
[web-v3-schema]: https://effect.website/docs/schema/introduction/
[blog-40]: https://effect.website/blog/releases/effect/40
[blog-week]: https://effect.website/blog/effect-4-first-week
[ai-runtime]: https://github.com/Effect-TS/effect/blob/e17ecdbe902aa7108f775c8ab9c0ddf9f38801ab/ai-docs/src/04_integration/10_managed-runtime.ts
[ai-proc]: https://github.com/Effect-TS/effect/blob/e17ecdbe902aa7108f775c8ab9c0ddf9f38801ab/ai-docs/src/60_child-process/10_working-with-child-processes.ts
[ai-test]: https://github.com/Effect-TS/effect/blob/e17ecdbe902aa7108f775c8ab9c0ddf9f38801ab/ai-docs/src/09_testing/10_effect-tests.ts
[node-http]: https://github.com/Effect-TS/effect/blob/e17ecdbe902aa7108f775c8ab9c0ddf9f38801ab/packages/platform/node/src/NodeHttpServer.ts
[socket]: https://github.com/Effect-TS/effect/blob/e17ecdbe902aa7108f775c8ab9c0ddf9f38801ab/packages/effect/src/socket/Socket.ts#L63-L84
[rpc-client]: https://github.com/Effect-TS/effect/blob/e17ecdbe902aa7108f775c8ab9c0ddf9f38801ab/packages/effect/src/rpc/RpcClient.ts#L1033-L1060
[sqlite-readme]: https://github.com/Effect-TS/effect/blob/e17ecdbe902aa7108f775c8ab9c0ddf9f38801ab/packages/sql/sqlite-node/README.md
[sqlite-client]: https://github.com/Effect-TS/effect/blob/e17ecdbe902aa7108f775c8ab9c0ddf9f38801ab/packages/sql/sqlite-node/src/SqliteClient.ts#L1-L16
[cp-spawner]: https://github.com/Effect-TS/effect/blob/e17ecdbe902aa7108f775c8ab9c0ddf9f38801ab/packages/effect/src/process/ChildProcessSpawner.ts#L86-L136
[spawner]: https://github.com/Effect-TS/effect/blob/e17ecdbe902aa7108f775c8ab9c0ddf9f38801ab/packages/platform/node-shared/src/NodeChildProcessSpawner.ts#L1-L30
[vitest-readme]: https://github.com/Effect-TS/effect/blob/e17ecdbe902aa7108f775c8ab9c0ddf9f38801ab/packages/vitest/README.md
[pnpm-mra]: https://pnpm.io/settings/dependency-resolution#minimumreleaseage
[arch]: ../ARCHITECTURE.md#implemented-foundation
[t3-main]: https://github.com/pingdotgg/t3code/tree/7ac952c
[node-sqlite]: https://nodejs.org/docs/latest-v24.x/api/sqlite.html
