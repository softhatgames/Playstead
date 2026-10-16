# Codex App Server for a host-backed conversation

- **Question:** Can Playstead's host run real Codex conversations through Codex App Server, and what do versioning, transport, authentication, persistence, events, approvals, sandboxing and resource controls mean for the first host-backed conversation?
- **Date:** 2026-10-14. All sources were accessed on this date.
- **Versions examined:**
  - Local `codex-cli 0.162.1` (standalone install at `~/.local/bin/codex`, ChatGPT login).
  - Latest stable upstream is also [`rust-v0.162.1`][rel] (published 2026-10-09).
  - Latest prerelease is `rust-v0.163.0-alpha.11` (2026-10-14); it was not examined.
  - The official docs carry no version or update date and appear to track `main`; differences from 0.162.1 are noted.
- **Official docs:** [App Server][as] (`developers.openai.com/codex/app-server` returns 308 to this URL; Markdown at [`app-server.md`][as-md]), [Codex SDK][sdk], [MCP server removal][mcp], [Authentication][auth], [Agent approvals & security][sec], [Sandbox][sbx], [Auto-review][ar], [Configuration reference][cfg], [Environment variables][env], [AGENTS.md][agents], [Build skills][skills].
- **Sign in with ChatGPT:** [Codex app-server][siwc-as], [Preview limitations][siwc-lim], [Overview][siwc-ov], [Token reference][siwc-tok], [Quickstart][siwc-qs], [Cookbook][siwc-cb].
- **Source code:** openai/codex pinned to tag [`rust-v0.162.1`][tag].
- **Local evidence:**
  - The stable JSON Schema and TypeScript bindings generated from 0.162.1 (`/tmp/playstead-codex-schema`).
  - An experimental variant made with `codex app-server generate-json-schema --experimental`.
  - CLI `--help` output and a read-only stdio smoke test.
- **Reference only:** [pingdotgg/t3code][t3] at commit `7d5a429` (main, 2026-10-14). This is not authoritative.

Labels used below: **Documented** (official docs), **Source** (code at the tag), **Schema** (bindings generated from 0.162.1), **Observed** (local smoke test), **Inference** (my reasoning) and **Unconfirmed** (not established).

## Summary for Playstead

- **Integration surface.** App Server is OpenAI's documented surface for building a client with authentication, history, approvals and streamed events. The Codex SDK is aimed at automation and CI, and MCP server mode has been removed ([as], [sdk], [mcp]). However, the docs call the `app-server` command "experimental" and "not supported for production workloads" ([mcp], [as]). The CLI labels it `[experimental]`.
- **Pin one exact Codex version.** Releases are frequent: twelve minor versions between 0.150.1 (2026-08-27) and 0.162.1. Methods are removed outright; for example, `thread/rollback` now returns unknown-method ([readme]). Generate bindings from the pinned binary, and check the version in the `initialize` `userAgent`.
- **Stay on the stable surface.** Experimental methods and fields need `capabilities.experimentalApi`; without it they are rejected with `-32600 "<descriptor> requires experimentalApi capability"` ([as], Observed). Several fields Playstead might want are experimental in 0.162.1: permission profiles, granular approvals, `availableDecisions`, `process/*` and `historyMode` (Schema, [shared]).
- **Transport and stdio lifetime.** Stdio is JSONL, and messages omit `"jsonrpc":"2.0"` (Observed). Stdio is single-client. When the host closes stdin, app-server shuts every thread down within a bounded time and exits, forcing exit after 45 s ([lib-close], [tp-shut], [stdio]). In stdio mode an in-flight turn cannot outlive the app-server process.
- **Threads survive a restart once used; turns do not.** Threads persist as JSONL rollouts under `CODEX_HOME/sessions` plus SQLite state ([as], [rollout-lib], [sqlite]), written only once a thread runs a turn: a thread that never did cannot be resumed (Observed, §10). After a restart, `thread/resume` with the saved id continues the conversation; OpenAI's Sign in with ChatGPT guide prescribes exactly this restart-and-resume pattern ([siwc-as]). Ephemeral threads are not written to disk.
- **History is reconstructable, but not as an event log.** Codex persists turn boundaries, completed items and token counts. It does not persist deltas, `item/started`, approval requests, warnings or errors. Command output and MCP results are truncated to 64 KiB ([policy]). Notifications carry no sequence numbers and cannot be replayed. Playstead must journal the events it needs and reconcile them with `thread/turns/list` and `thread/items/list` after a reconnect.
- **Approval requests and decisions.** Approvals arrive as server-initiated JSON-RPC requests carrying `threadId`, `turnId` and `itemId` ([as]).
  - Command decisions: `accept`, `acceptForSession`, `acceptWithExecpolicyAmendment`, `applyNetworkPolicyAmendment`, `decline` (the turn continues) and `cancel` (the turn is interrupted).
  - File-change decisions: `accept`, `acceptForSession`, `decline`, `cancel` (Schema, [beh-cmd]).
  - `serverRequest/resolved` confirms that a request was answered or cleared.
- **Pending approvals and disconnects.** The server applies no timeout: the turn waits until the client answers. A JSON-RPC error reply counts as a denial. An interrupt or turn transition clears pending requests ([beh-cmd], [out-abort]). In stdio mode a disconnect ends the process. In socket mode the thread keeps running, and pending requests are re-sent to a connection that resumes the thread ([tl-replay], [out-replay]).
- **Policy values on the wire in 0.162.1.**
  - `approvalPolicy`: `untrusted`, `on-request`, `never`, or experimental `granular`. There is no `on-failure`.
  - `sandbox`: `read-only`, `workspace-write`, `danger-full-access`.
  - `sandboxPolicy` objects also allow `externalSandbox` ([shared], Schema).
  - The product docs call `untrusted` retired for `config.toml` ([sec]).
- **Sandbox enforcement.** The OS enforces the sandbox on spawned commands: Seatbelt on macOS, `bwrap` plus seccomp on Linux. `.git`, `.codex`, `.agents` and `.aws` under writable roots stay read-only ([sec]). `thread/shellCommand`, `process/*` and `dangerFullAccess` bypass the sandbox ([as]). Instructions, including `AGENTS.md`, are guidance to the model and are not enforcement.
- **Authentication and terms.** App Server reuses the CLI login in `CODEX_HOME`; the smoke test found the existing ChatGPT login (Observed). The docs say app-server authentication "has never been permitted for commercial or hosted services". Local or open-source apps "can continue using it", but OpenAI recommends migrating to Sign in with ChatGPT ([as]). The Sign in with ChatGPT route for app-server needs the app's own OAuth and an `env_key` provider. Access tokens last one hour, so app-server must be restarted with a new token between turns ([siwc-as], [siwc-tok]).
- **Resource controls.** The client can enforce only `turn/interrupt` and approval decisions. Rate limits (`account/rateLimits/read` and `/updated`), token usage (`thread/tokenUsage/updated`) and account usage (`account/usage/read`) are observable only ([as]). There is no documented per-turn timeout or turn cap. Thread goals have a `tokenBudget`, but whether the budget is enforced is **unconfirmed**.
- **`CODEX_HOME` is shared state.** The user's default `CODEX_HOME` also holds the VS Code extension's threads, global `AGENTS.md`, skills and config (Observed: `thread/list` returned `vscode` threads). Cross-process writer locks stop two processes writing the same thread ([writer]). Choose a `CODEX_HOME` deliberately; §10 covers what a separate home does and does not isolate.
- **Docs differ from 0.162.1.** Examples include `"unlessTrusted"`, `sandbox: "workspaceWrite"`, `ReadOnlyAccess`, `perCwdExtraUserRoots`, `autoResolutionMs` and PascalCase error codes. Treat the bindings generated from the pinned binary as the contract (see §1).

## 1. Status, support and versioning

- **Recommended surface (Documented).**
  - App-server is "the interface Codex uses to power rich clients (for example, the Codex VS Code extension). Use it when you want a deep integration inside your own product: authentication, conversation history, approvals, and streamed agent events" ([as]).
  - For "automating jobs or running Codex in CI, use the Codex SDK instead" ([as], [sdk]).
  - `codex mcp-server` has been removed, and existing integrations should move to app server ([mcp]).
  - The Python SDK drives app-server and bundles a pinned CLI runtime ([sdk]).
  - The TypeScript SDK `@openai/codex-sdk@0.162.1` spawns `codex exec --experimental-json` rather than app-server ([tsexec]). It depends on exactly `@openai/codex@0.162.1` (npm registry).
- **Stability (Documented).**
  - "The app-server command is experimental and isn't supported for production workloads" ([mcp]).
  - WebSocket transport is "experimental and unsupported" ([as]).
  - Local `codex app-server --help` prints `[experimental]`.
  - The docs make no compatibility promise for the stable surface beyond the `experimentalApi` gate ([as]). `plugin/*` methods are marked "under development; don't call from production clients".
- **Stable versus experimental (Documented, Source, Observed).**
  - Omitting `capabilities.experimentalApi` keeps a connection on the stable surface ([as#experimental-api-opt-in]). Gating is enforced per request in [mp-init].
  - The experimental build adds 65 client methods and one server request (`currentTime/read`) over the stable schema. They include `process/*`, `thread/backgroundTerminals/*`, `thread/settings/update`, `collaborationMode/list` and `userVerification/*` (Schema diff).
  - Experimental fields include `ThreadStartParams.permissions`, `historyMode`, `dynamicTools` and `environments`, plus `CommandExecutionRequestApprovalParams.availableDecisions` and `additionalPermissions`.
  - Responses were not filtered: a `thread/list` response on a stable connection still included experimental `Thread` fields such as `canAcceptDirectInput` and `extra` (Observed). Clients should therefore ignore unknown fields.
- **v1 and v2 (Schema).** In 0.162.1, `initialize` is the only client method left in the v1 namespace, and every other client method is v2. Two deprecated v1 server requests remain, `execCommandApproval` and `applyPatchApproval`, which apply only to "legacy APIs (SendUserTurn, SendUserMessage)". Those legacy client methods are absent from `ClientRequest`. `codex-rs/docs/protocol_v1.md` describes the core submission/event queues, not the app-server API.
- **Pinning.**
  - Generated schemas are "specific to the Codex version you ran" ([as#message-schema]).
  - Pinning options:
    - npm `@openai/codex@0.162.1`, which ships per-platform binaries as optional dependencies (`npm view`).
    - The standalone installer. The local `codex` is a symlink into `~/.codex/packages/standalone/current`, which `codex update` replaces.
    - A host-managed copy.
  - **Inference:** Playstead should launch an explicit binary path, check `initialize.userAgent` (Observed: `playstead_research/0.162.1 (Mac OS 26.6.2; arm64) …`), and regenerate bindings whenever the version changes.
  - Managed daemons can update themselves automatically ([daemon]).
- **Release cadence (Source).**
  - Stable releases ran from 0.150.1 (2026-08-27) to 0.162.1 (2026-10-09); prereleases are published daily.
  - 0.162.1 fixed a startup failure caused by mismatched features between a running background server and the CLI ([rel]).
  - The 0.162.1 app-server README is a set of change notes rather than a full reference ([readme]).

## 2. Transport and lifecycle

- **Wire format.**
  - Documented: JSON-RPC 2.0 "with the `"jsonrpc":"2.0"` header omitted on the wire" ([as#protocol]).
  - Observed: no message carried `jsonrpc`.
  - `JSONRPCRequest` has an optional W3C `trace` field (Schema).
- **Transports (Documented, `--help`).**
  - `--listen stdio://` is the default (JSONL).
  - `ws://IP:PORT` sends one message per text frame and offers optional `--ws-auth capability-token|signed-bearer-token`, plus `/readyz` and `/healthz`.
  - `unix://` or `unix://PATH` is WebSocket over a Unix socket; `off` disables listening ([as#protocol]).
- **`daemon` and `proxy`.**
  - `codex app-server daemon start|restart|stop|update|version|bootstrap|enable-remote-control|disable-remote-control` manages one pidfile-backed app-server per `CODEX_HOME`, on the default control socket.
  - The daemon serves remote clients (desktop, mobile, SSH) and the TUI's "shared background server". It is "experimental", its lifecycle contract "may change", and it can update itself automatically, which "may interrupt running work" ([daemon]).
  - `proxy` pipes stdio bytes to the running daemon's control socket (`--help`).
  - `codex agents` browses sessions on that shared daemon (`--help`).
- **Handshake (Documented, Schema).**
  - `initialize` takes `{clientInfo: {name, title?, version}, capabilities?}`. Capabilities: `experimentalApi`, `optOutNotificationMethods` (exact names), `requestAttestation`, `mcpServerOpenaiFormElicitation`, `extensions`, `explicitGatewayOauth`.
  - The response is `{userAgent, codexHome, platformFamily, platformOs}`. The client then sends the `initialized` notification ([as#initialization]).
  - `clientInfo.name` identifies the client in OpenAI's Compliance Logs Platform ([as]). The Sign in with ChatGPT guide says it should match the app's `agent_name_hint` ([siwc-as]).
- **Errors before or after initialisation (Observed).**
  - A request before `initialize` returns `-32600 "Not initialized"`.
  - A second `initialize` returns `-32600 "Already initialized"`.
  - A method Codex does not know returns `-32600`, not JSON-RPC's `-32601`, with the message ``Invalid request: unknown variant `<method>`, expected one of `initialize`, …`` listing every method it knows (0.162.1 on macOS, 2026-10-15, unsigned throwaway home). Playstead reads either code as an incompatible Codex version.
  - The server sent `remoteControl/status/changed` and `account/updated` without being asked.
- **Backpressure (Documented, Source).**
  - When the bounded ingress queue is full, requests are rejected with `-32001 "Server overloaded; retry later."`, and clients should retry with exponential backoff and jitter ([as#protocol]).
  - The docs describe this for WebSocket only. Stdio uses the same `forward_incoming_message` path with a 128-message channel ([transport-mod]).
  - While the server drains for shutdown, new turns are refused with `-32600 "Server is draining; retry after reconnecting"` ([err]).
- **Client disconnect and process exit (Source).**
  - **Stdio** is "single client mode". On stdin EOF the processor loop exits ([lib-close]). It closes the connection, drains connection RPCs (30 s), then calls `shutdown_threads`, which gives threads up to 10 s ([lib-shut], [tp-shut]). A watchdog calls `exit(1)` after 45 s ([stdio]).
  - Observed: an idle server exited with code 0 within 0.02 s of stdin closing.
  - **Socket transports** handle a disconnect by removing that connection's subscriptions ([tp-close]); running threads continue. With no subscribers, a thread unloads after 30 minutes without activity and emits `thread/closed` ([as#unsubscribe-from-a-loaded-thread]).
  - SIGTERM or SIGHUP on a non-stdio server starts a graceful drain: new turns are refused and the server waits for running turns. A second forceable signal forces shutdown ([lib-drain]).
- **Surviving a restart.**
  - Threads: yes. They are persisted and resumed by id ([as#start-or-resume-a-thread], [siwc-as], [siwc-lim]: "Local thread history and `thread/resume` still work").
  - Turns: no, under stdio.
  - Managed daemon restarts snapshot loaded thread ids and interrupted turns, then restore them after restart. The source says "only local execution with thread-owned configuration can continue automatically" ([recovery]). This is experimental daemon behaviour.
  - How a turn cut off by `SIGKILL` appears on cold resume is **unconfirmed**. History reconstruction marks a turn `interrupted` only when a `TurnAborted` event was recorded ([history]).

## 3. Authentication

- **Methods (Documented, Schema).**
  - `account/read {refreshToken?}` returns `{account: apiKey | chatgpt{email, planType} | amazonBedrock, requiresOpenaiAuth}`.
  - `account/login/start` accepts `apiKey`, `chatgpt` (browser; app-server hosts the localhost callback), `chatgptDeviceCode`, experimental `chatgptAuthTokens` and the Bedrock variants.
  - Related methods and notifications: `account/login/cancel`, `account/logout`, `account/login/completed {loginId, success, error}`, `account/updated {authMode, planType}` and the server request `account/chatgptAuthTokens/refresh`, which has a ~10 s timeout ([as#auth-endpoints]).
  - In the 0.162.1 schema, `chatgptAuthTokens` is marked "[UNSTABLE] FOR OPENAI INTERNAL USE ONLY - DO NOT USE", while the docs present it as experimental for host apps.
- **Reuse of the CLI login (Observed, Documented).**
  - With no login call, `account/read` returned `type: "chatgpt"` with a plan type, and `initialize` reported the default `CODEX_HOME`.
  - The CLI and IDE extension share cached credentials, stored in `CODEX_HOME/auth.json` or the OS keyring ([auth#login-caching]).
  - `cli_auth_credentials_store = file | keyring | auto | ephemeral` selects the store, and admins can enforce it ([auth#credential-storage], [cfg]).
  - `CODEX_HOME` "must already exist" if set ([env]).
- **Terms for third-party apps (Documented, verbatim in substance).** The app-server auth section states:
  - "If you've built a local or open-source application using Codex app-server authentication, you can continue using it, though we recommend migrating to Sign in with ChatGPT".
  - "App-server authentication has never been permitted for commercial or hosted services" ([as#auth-endpoints]).
  - Sign in with ChatGPT plan usage "is available for open-source tools and personal projects that run locally"; paid or remotely hosted apps must join a waitlist ([siwc-cb], [siwc-ov]).
  - API-key login bills at API rates; the docs recommend API keys for programmatic CI use and warn against exposing Codex execution in untrusted or public environments ([auth]).
- **Sign in with ChatGPT through app-server (Documented).**
  - The app runs its own OAuth with PKCE and a stable `ext_agent_host_id`.
  - It starts app-server with a custom provider: `model_provider=…`, `base_url="https://api.openai.com/v1"`, `env_key="ACCESS_TOKEN"`, `wire_api="responses"`, `requires_openai_auth=false`, `supports_websockets=false`.
  - It passes the access token in the child's environment. "No separate Codex sign-in is required" ([siwc-as]).
  - On renewal it restarts app-server with the new token and calls `thread/resume` ([siwc-as], [siwc-lim]). Access tokens last one hour; refresh tokens last 30 days and rotate ([siwc-tok]).
  - Hosted Responses tools such as `tool_search` are unsupported on this route ([siwc-lim]).
  - With this provider configuration, `model/list` can return a bundled catalogue that is "not an entitlement check" ([siwc-as]).
- **Inference for Playstead.**
  - Playstead is public and MIT-licensed (checked with `gh repo view`), and its host binds to the local computer (README). That places it in the "local or open-source" category, where existing app-server authentication may continue, but OpenAI recommends Sign in with ChatGPT.
  - Managed hosted execution, a later goal in `docs/PRODUCT.md`, would fall under "commercial or hosted" and needs a different path.
  - Under Sign in with ChatGPT, a one-hour token forces a restart between turns, and because stdio turns die with the process, Playstead should schedule renewal at turn boundaries.

## 4. Threads and persistence

- **`thread/start` (Schema).**
  - Stable parameters: `cwd`, `model`, `modelProvider`, `serviceTier`, `approvalPolicy`, `approvalsReviewer`, `sandbox` (`SandboxMode`), `config` (overrides), `baseInstructions`, `developerInstructions`, `ephemeral`, `serviceName`, `threadSource`, `sessionStartSource`, and deprecated `personality`.
  - The response returns the effective `approvalPolicy`, `approvalsReviewer`, `sandbox` (as `SandboxPolicy`), `cwd`, `model`, `reasoningEffort` and `instructionSources`, and `thread/started` is emitted.
  - `permissions` (profiles), `dynamicTools` and `historyMode` are experimental ([as#start-or-resume-a-thread]).
  - Thread and turn ids are UUIDv7. `thread.sessionId` names the root of the session tree.
- **Resume, fork and read (Documented).**
  - `thread/resume {threadId, excludeTurns?, …overrides}` loads a stored thread and subscribes the connection. Full-history responses are deprecated for paginated threads, so use `excludeTurns: true`. The response includes `turnsBackwardsCursor` and `itemsBackwardsCursor`.
  - Resuming with a different model emits a warning and a one-time model-switch instruction ([as#start-or-resume-a-thread]).
  - A thread that is still unloading rejects resume with "thread … is closing; retry" ([tp-close]).
  - `thread/fork {threadId, lastTurnId?, ephemeral?}` copies history into a new id. It rejects an in-progress `lastTurnId`.
  - `thread/read` returns metadata and runtime `status` (`notLoaded | idle | systemError | active{waitingOnApproval|waitingOnUserInput}`) without loading the thread.
  - `thread/turns/list` (newest-first; `itemsView: notLoaded|summary|full`) and `thread/items/list` (oldest-first; supports an item-anchor cursor) page history without resuming ([as#list-thread-turns], [as#list-thread-items]).
- **Listing and lifecycle (Documented).**
  - `thread/list` filters on `cwd`, `sourceKinds`, `archived`, `searchTerm` and more. Its default `sourceKinds` are only `cli` and `vscode` ([as#list-threads-with-pagination--filters]).
  - `thread/loaded/list` lists the threads loaded in memory.
  - `thread/unsubscribe` returns `unsubscribed | notSubscribed | notLoaded`.
  - `thread/archive` and `thread/unarchive` move the rollout file; `thread/delete` is permanent.
  - `thread/revert` removes a turn and all later turns from history but does not change files ([as#revert-thread-history]).
- **Storage (Source, Observed).**
  - Rollouts live at `CODEX_HOME/sessions/YYYY/MM/DD/rollout-<timestamp>-<thread id>.jsonl`, and archived ones under `archived_sessions` ([rollout-lib], `recorder.rs`).
  - SQLite files `state_5.sqlite` and `thread_history_1.sqlite`, among others, sit in `CODEX_HOME` or `CODEX_SQLITE_HOME` ([sqlite], [env]).
  - New persistent local threads default to `historyMode: paginated` ([as]). Observed: listed threads were `paginated`.
  - "An unused thread is not guaranteed to survive restart" ([readme]).
- **What is persisted (Source).**
  - Persisted: `TurnStarted`, `TurnComplete`, `TurnAborted`, `TokenCount`, settings and goal changes, and `ItemCompleted` items ([policy]).
  - Transient: `ItemStarted`, every delta, approval and user-input requests, `Error`, `Warning`, `StreamError`, `TurnDiff` and `PlanUpdate`.
  - Persisted command output and MCP results are truncated in the middle to 64 KiB.
  - **Inference:** completed turns and items are reconstructable. Streaming text, the approval dialogue and errors that were not turned into a turn `error` are not.
- **Concurrency (Source).** Each `CODEX_HOME` has per-thread cross-process writer locks. A second writer fails with "thread … already has an active writer" ([writer]). **Inference:** Playstead cannot resume a thread that the user's VS Code extension or daemon has loaded.

## 5. Turns and events

- **`turn/start` (Schema, Documented).**
  - Takes `{threadId, input: UserInput[]}`. Input types: `text`, `image{url|fileId}`, `localImage{path}`, `audio`, `localAudio`, `skill{name,path}`, `mention`.
  - Optional overrides persist for later turns: `cwd`, `model`, `effort`, `summary`, `approvalPolicy`, `approvalsReviewer`, `sandboxPolicy`, `serviceTier`.
  - Other optional fields: `outputSchema` (this turn only), `toolOutput`, `clientUserMessageId`, `parentTurnId` and `rootTurnId`.
  - The response is `{turn: {id, status: "inProgress", items: [], error: null}}` ([as#start-a-turn]).
  - **Source:** on a thread whose turn is already active, `turn/start` steers that turn instead of starting a new one ([turnproc]).
- **`turn/steer` and `turn/interrupt` (Documented).**
  - `turn/steer {threadId, input, expectedTurnId}` appends to the active turn. It fails with no active turn or on a mismatch, and is rejected for review and compaction turns (`activeTurnNotSteerable`).
  - `turn/interrupt {threadId, turnId}` returns `{}`, and the turn ends `status: "interrupted"` ([as#interrupt-a-turn]).
- **Turn notifications (Documented, Schema).**
  - `turn/started`.
  - `turn/completed {threadId, turn}` with `status` set to `completed`, `interrupted` or `failed`. Only `completed` means success ([siwc-as]).
  - `error {error: {message, codexErrorInfo?, additionalDetails?}, willRetry, threadId, turnId}` precedes `failed`.
  - `turn/diff/updated`, `turn/plan/updated` and `thread/tokenUsage/updated {threadId, turnId, tokenUsage: {total, last, modelContextWindow}}`.
  - Also `model/rerouted`, `warning`, `deprecationNotice`, `thread/status/changed` and `serverRequest/resolved` ([as#events]).
- **Items (Documented, Schema).**
  - `item/started {item, threadId, turnId, startedAtMs}` and `item/completed {…, completedAtMs}` carry the full item. `item/completed` is "the authoritative state", and `item.id` matches the delta `itemId` ([as#items]).
  - Item types in 0.162.1: `userMessage`, `hookPrompt`, `agentMessage`, `functionCallOutput`, `plan`, `reasoning`, `commandExecution`, `fileChange`, `mcpToolCall`, `dynamicToolCall`, `collabAgentToolCall`, `subAgentActivity`, `webSearch`, `imageView`, `sleep`, `imageGeneration`, `enteredReviewMode`, `exitedReviewMode`, `contextCompaction`.
  - Statuses: command and file items are `inProgress|completed|failed|declined`; MCP items are `inProgress|completed|failed`.
- **Deltas (Documented).** `item/agentMessage/delta`, `item/reasoning/summaryTextDelta`, `item/reasoning/summaryPartAdded`, `item/reasoning/textDelta`, `item/plan/delta` and `item/commandExecution/outputDelta`. `item/fileChange/outputDelta` is no longer emitted ([as#item-deltas]).
- **Error codes (Schema).** `codexErrorInfo` values are camelCase in 0.162.1, for example `contextWindowExceeded`, `usageLimitExceeded`, `rateLimitExceeded`, `sessionBudgetExceeded`, `unauthorized`, `sandboxError` and `tooManyDenials`. The docs list them in PascalCase ([as#errors]).
- **Ordering and replay.** Notifications carry no sequence number; items have only ms timestamps (Schema). Nothing replays missed notifications.
  - On `thread/resume` of a loaded thread, the server sends a token-usage snapshot, the goal snapshot and any pending server requests ([tl-replay]).
  - `thread/turns/list` returns its anchor turn again "so you can catch updates" ([as#list-thread-turns]).
  - `optOutNotificationMethods` can suppress notifications per connection ([as#notification-opt-out]).

## 6. Approvals, permissions and sandbox

- **Server requests in 0.162.1 (Schema).** `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/permissions/requestApproval`, `item/tool/requestUserInput` (experimental), `mcpServer/elicitation/request`, `item/tool/call` (dynamic tools, experimental), `account/chatgptAuthTokens/refresh`, `attestation/generate`, and the deprecated `execCommandApproval` and `applyPatchApproval`.
- **Command approval.**
  - The sequence is `item/started`, then the request `{threadId, turnId, itemId, approvalId?, command?, cwd?, commandActions?, reason?, networkApprovalContext{host, protocol}?, proposedExecpolicyAmendment?, proposedNetworkPolicyAmendments?, environmentId?, startedAtMs}`, then the reply `{decision}`, then `serverRequest/resolved {threadId, requestId}`, then `item/completed` ([as#command-execution-approvals], Schema).
  - Decision effects ([beh-cmd]):
    - `accept`: approved.
    - `acceptForSession`: approved, and the session approval cache is updated.
    - `{acceptWithExecpolicyAmendment: {execpolicy_amendment: string[]}}`: approved, and future matching commands are allowed.
    - `{applyNetworkPolicyAmendment: {network_policy_amendment}}`: persistent host allow or deny.
    - `decline`: denied; "the agent will continue the turn"; item `declined`.
    - `cancel`: denied, and "the turn will also be immediately interrupted".
- **File change approval.**
  - The request is `{threadId, turnId, itemId, reason?, grantRoot?}`. `grantRoot` is "[UNSTABLE] … unclear if this is honored today".
  - Decisions are `accept | acceptForSession | decline | cancel`, with the same continue-or-interrupt semantics ([beh-file], Schema).
- **Permission requests.**
  - The built-in `request_permissions` tool asks for network or filesystem access. The reply `{permissions: <granted subset>, scope?: "turn"|"session", strictAutoReview?}` grants only what it lists ([as#permission-requests], Schema).
  - `item/permissions/requestApproval` is part of the stable 0.162.1 schema. Granular approval's `request_permissions` flag defaults to false.
- **User input and elicitation.**
  - `item/tool/requestUserInput {questions[], isBlocking, autoResolutionMs?(deprecated)}` returns `{answers: {id: {answers: string[]}}}`.
  - MCP elicitation replies `{action: accept|decline|cancel, content?}` ([as#mcp-server-elicitation-requests]).
  - App tool calls with side effects may require approval through `tool/requestUserInput` ([as#mcp-tool-call-approvals-apps]).
- **No answer, or a disconnect (Source).**
  - The handler awaits the client's reply with no timeout ([beh-cmd]), and the thread shows `active{waitingOnApproval}` ([as#track-thread-status-changes]).
  - A JSON-RPC error reply or an unparseable reply maps to a denial ("approval request failed"), and the item becomes `failed`.
  - When the turn changes state (interrupt, completion, new turn), pending requests are cancelled with reason `turnTransition` and `serverRequest/resolved` is emitted ([out-abort], [as#toolrequestuserinput]).
  - A closed connection does not cancel its approvals ([out-close]). Under stdio the process then shuts down. Under a socket transport the request stays pending and is re-sent to the next connection that resumes the thread ([tl-replay]).
  - **Inference:** Playstead's host should own the single long-lived connection and persist pending approvals itself.
- **Approval policies.**
  - 0.162.1 wire values: `untrusted` (`UnlessTrusted`), `on-request`, `never`, `{granular: {sandbox_approval, rules, mcp_elicitations, skill_approval?, request_permissions?}}`, where granular is experimental ([shared]). There is no `on-failure`.
  - The config reference says `untrusted` "is unsupported" and `on-failure` "is deprecated". The stricter rule now comes from `trust_level = "untrusted"` on a project ([cfg], [sec#migrate-from-the-retired-untrusted-approval-policy]).
  - How app-server handles an explicit `untrusted` value is **unconfirmed**.
  - The CLI's `-a` help describes `on-request` as "The model decides when to ask the user for approval".
- **Reviewer.**
  - `approvalsReviewer: user | auto_review | guardian_subagent (legacy)` routes eligible approvals to a reviewer agent (Schema description of `ApprovalsReviewer`). Requests that stay inside the sandbox are not reviewed.
  - Denials go back to the agent. A circuit breaker interrupts the turn after 3 consecutive denials, or 10 denials within the last 50 reviews.
  - Auto-review "is not a deterministic security guarantee" ([ar]).
  - App-server exposes `item/autoApprovalReview/started|completed`, `guardianWarning` and `thread/approveGuardianDeniedAction` (Schema).
- **Sandbox policy.**
  - `SandboxMode`: `read-only | workspace-write | danger-full-access`, kebab-case on `thread/start`.
  - `SandboxPolicy`, used by `turn/start` and `command/exec`:
    - `{type: dangerFullAccess}`
    - `{type: readOnly, networkAccess?}`
    - `{type: workspaceWrite, writableRoots?, networkAccess?, excludeTmpdirEnvVar?, excludeSlashTmp?}`
    - `{type: externalSandbox, networkAccess: restricted|enabled}`, which skips Codex's own sandbox when the host already sandboxes the process ([as#command-execution], Schema).
  - The docs' `access` and `readOnlyAccess` (restricted read roots) are absent from the 0.162.1 schema. Named permission profiles (`permissions`, `permissionProfile/list`) are a beta, experimental-only feature ([as]).
- **What the OS enforces (Documented).**
  - Spawned commands, including `git`, package managers and tests, run inside the sandbox ([sbx]).
  - macOS uses `sandbox-exec` with a Seatbelt profile. Linux uses `bwrap` plus seccomp; Windows uses MXC or a legacy sandbox.
  - Network is off by default under `workspace-write`. `.git` (including the target of a gitdir pointer), `.agents`, `.codex` and `.aws` stay read-only inside writable roots ([sec#os-level-sandbox], [sec#protected-paths-in-writable-roots]).
  - Containers may block `bwrap`. Test the policy with `codex sandbox macos|linux` ([sec]).
- **Outside the sandbox (Documented).** These run outside the sandbox: `thread/shellCommand` ("full access", client-initiated); experimental `process/spawn`; `command/exec` with `dangerFullAccess`; and Codex's own HTTP traffic, which follows the separate application network policy ([as], [readme]).
- **Not enforced by the OS.**
  - `AGENTS.md`, `developerInstructions` and `baseInstructions` are prompt content.
  - Asking for escalation under `on-request` is the model's decision; the sandbox still blocks anything not approved.
  - Whether MCP server processes and built-in file edits are confined by the OS sandbox or only by Codex's own checks is **unconfirmed**.
  - Asynchronous safety monitoring can pause tasks ([sec#safety-monitoring-and-paused-tasks]).

## 7. Resource controls

- **The client can enforce:**
  - `turn/interrupt`.
  - Declining or cancelling approvals.
  - `thread/unsubscribe` and `thread/archive`.
  - Per-turn `model`, `effort`, `sandboxPolicy` and `outputSchema`.
  - `timeoutMs` on `thread/shellCommand` (default one hour) and on `command/exec` ([as]).
  - Killing the process (Inference).
- **The client can only observe (Documented, Observed).**
  - `account/rateLimits/read` returns `rateLimits` and `rateLimitsByLimitId` with `usedPercent`, `windowDurationMins`, `resetsAt`, `rateLimitReachedType` and `ordinaryUsageAllowed`; `account/rateLimits/updated` is pushed. Observed: one `codex` bucket with a weekly primary window.
  - `account/usage/read` (ChatGPT-backed auth only).
  - `thread/tokenUsage/updated`.
  - `turn/completed` errors such as `usageLimitExceeded` ([as#6-rate-limits-chatgpt], [as#7-token-usage-chatgpt]).
- **Budgets.**
  - `thread/goal/set` accepts `tokenBudget`, and `ThreadGoalStatus` includes `budgetLimited` and `usageLimited` (Schema, [as#manage-a-thread-goal]).
  - `features.rollout_budget.*` is "under development" ([cfg]).
  - Whether either stops a running turn is **unconfirmed**.
  - No documented max-turns setting or per-turn wall-clock limit exists; `model_providers.<id>.stream_idle_timeout_ms` covers stream idleness only ([cfg]).

## 8. Instructions and skills (brief)

- **`AGENTS.md`.**
  - Discovery: the global `CODEX_HOME/AGENTS.override.md` or `AGENTS.md`, then each directory from the project root down to `cwd`, concatenated root-first. The total is capped at `project_doc_max_bytes` (default 32 KiB). Fallback names come from `project_doc_fallback_filenames` ([agents]).
  - App-server reports the files it loaded as `instructionSources` on start, resume and fork ([as#start-or-resume-a-thread]).
- **Skills.**
  - Repository skills come from `.agents/skills` in each directory from `cwd` up to the repository root. Other locations: `$HOME/.agents/skills`, `/etc/codex/skills` and the bundled system skills ([skills]).
  - Methods: `skills/list {cwds?, forceReload?}`, `skills/extraRoots/set {extraRoots}` (process-level, not persisted), `skills/config/write` and the `skills/changed` notification.
  - To invoke a skill explicitly, send a `skill` input item with `$name` text ([as#skills]).
  - The documented `perCwdExtraUserRoots` is not in the 0.162.1 schema.

## 9. Reference implementation (non-authoritative)

The following summarises how [pingdotgg/t3code][t3] at `7d5a429` drives app server. It records what one open-source client does; it is not guidance from OpenAI.

- **Process.**
  - Runs `codex app-server` over stdio with `CODEX_HOME` from its settings: one process per provider instance, shared by its threads ([CodexAdapterV2.ts][t3-adapter], session capabilities near L236-L242).
  - Sessions are released after 30 minutes idle. At process exit, all pending requests fail.
  - There is no automatic restart; the next command opens a new session ([t3-sm]).
- **Handshake.** Sends `clientInfo.name "T3 Code"`, `experimentalApi: true` and an opt-out for `turn/diff/updated`. It treats "Already initialized" as success.
- **Versions.** A compatibility manifest marks Codex ≥ 0.156.0 as supported. The managed Codex is pinned to 0.156.1, and bindings are generated from a pinned upstream commit with hand patches.
- **Mode mapping.**
  - Approval required: `untrusted` with `readOnly`.
  - Auto-accept edits: `on-request` with `workspaceWrite`.
  - Auto: adds `approvalsReviewer: auto_review`.
  - Full access: `never` with `dangerFullAccess`.
  - These are sent on every `turn/start`.
- **Resume.** Stores the Codex thread id and calls `thread/resume {excludeTurns: true}`, ignoring the returned history. If resume fails, it starts a new thread with an injected summary. It declares `pendingRequestsSurviveRestart: false` and `approvalCallbacksAreLiveOnly: true`, and marks pending approvals expired or cancelled when a session stops ([t3-adapter]).
- **Auth.** Uses the existing CLI login through `account/read`, and never calls `account/login/start`. Its managed mode runs its own OAuth (`chatgpt.tokens.use.direct`) and launches Codex with the `env_key=ACCESS_TOKEN` provider that the Sign in with ChatGPT guide describes ([t3-managed]).
- **Gaps.** It has no handler for `serverRequest/resolved`. It persists its own domain events rather than relying on Codex history.
- **Windows sandbox (checked again at `7ac952c`, 2026-10-14).** `windowsSandbox/readiness` and `windowsSandbox/setupStart` appear only in its generated schema; nothing calls them. It sends the sandbox policy on every `turn/start` and does not compare it with the policy Codex applied. By default it uses the `CODEX_HOME` from its settings, so a sandbox already set up for that home applies. Its managed runtime uses its own home, which per §11 starts without a sandbox.

## 10. Isolating a Playstead Codex home

The experiments used fresh directories under `/tmp` as `CODEX_HOME`. The `cwds` were an empty `/tmp` directory and this repository. Only `initialize`, `account/read`, `config/read`, `skills/list` and a cancelled `account/login/start` were sent. No login was completed and no thread was started.

### What a fresh home removes, and what still loads

- **Removed (Observed, Source).** Everything kept in the user's `~/.codex`: `config.toml` (MCP servers, `notify`, plugins, features and `[projects]` trust), `rules/*.rules`, hooks, the global `AGENTS.md`, installed plugins, `$CODEX_HOME/skills` and credentials. Rules are read from each layer's own folder ([exec-rules]). In a fresh home, `account/read` returned `account: null`, and `config/read` showed an empty user layer with no MCP servers and no `notify`.
- **User skills in `$HOME/.agents/skills` still load (Observed, Source).** That root comes from `$HOME`, through `dirs::home_dir()`, not from `CODEX_HOME` ([skill-roots]). In a fresh home, `skills/list` returned all 54 of this machine's user skills and 5 system skills.
  - **Per-skill opt-out.** A `[[skills.config]]` entry selects one skill by `path` (its exact `SKILL.md`) or by `name`, with `enabled = false` ([skills#enable-or-disable-local-codex-skills], [skills-cfg]). There is no directory or scope selector, so a skill added later is not covered. A `name` rule also disables a repo skill with the same name (Observed: `grilling` was disabled in both scopes). `skills/config/write` saves the same rule to `CODEX_HOME/config.toml` ([skills-write]).
  - **Whole catalogue.** `skills.include_instructions = false` removes the automatic skills catalogue from model context for every scope ([skills-cfg]; not in the config reference).
  - **`HOME` override.** Setting `HOME` to a Playstead directory for the app-server process removed every user skill (Observed). The personal plugin marketplace, `$HOME/.agents/plugins`, also follows `HOME` ([marketplace-home]). **Inference:** every command the agent runs inherits that `HOME`, which breaks Git identity and credential helpers, SSH, `gh`, package-manager caches and editor settings. `shell_environment_policy.set.HOME` might restore the real value for commands ([cfg]); this is **unconfirmed**.
- **System skills (Observed, Source).** At startup app-server writes five bundled skills into `CODEX_HOME/skills/.system`. With `-c skills.bundled.enabled=false`, they disappeared from `skills/list` and the directory was not written ([skills-cfg]; the key is not in the config reference).
- **Admin layers always apply (Source).** These stay active whatever `CODEX_HOME` is: `/etc/codex/config.toml`, `/etc/codex/requirements.toml`, the legacy `/etc/codex/managed_config.toml`, `/etc/codex/skills` and `/etc/codex/rules`, forced macOS managed preferences in the `com.openai.codex` domain (`config_toml_base64`, `requirements_toml_base64`), and cloud requirements for enterprise accounts ([layers], [mdm]). App-server has no flag to skip them. This machine has none of them (Observed): `config/read` listed only the user layer and an empty system layer.
- **Project files (Source, Documented, Observed).**
  - **Skills.** `.agents/skills` directories from `cwd` up to the project root load whether or not the project is trusted, and so does `.codex/skills`, because skill discovery also walks disabled layers ([skill-roots]). Observed: this repository's 27 skills were listed with no trust entry.
  - **Config, hooks and rules.** Project `.codex/config.toml`, hooks and rules load only when the project is trusted ([cfg-adv], [trust-gate]).
  - **`AGENTS.md`.** Project `AGENTS.md` loads unless the project is explicitly `untrusted` ([agents-load]). `project_doc_max_bytes = 0` stops it, and `project_root_markers = []` limits it to `cwd`.
  - **Caveat (Source).** `thread/start` with a `cwd`, and a sandbox that can write there such as `workspace-write`, trusts the project automatically when it has no trust entry ([auto-trust]). It writes `[projects."<git root>"] trust_level = "trusted"` into `CODEX_HOME/config.toml` and reloads config, which turns on the project's `.codex/` layers. Writing `trust_level = "untrusted"` beforehand prevents this. However, it also skips the project's `AGENTS.md`. Unless the client sends an explicit `approvalPolicy`, commands then need approval unless a rule allows them ([sec#migrate-from-the-retired-untrusted-approval-policy]).
  - **What Playstead checks (Source, checked 2026-10-14).**
    - The project root is the nearest folder, from `cwd` up, with a `.git` file or a `.git` folder holding `HEAD` (default `project_root_markers`); without one it is `cwd` ([discover-root]). Project layers are the `.codex` folders from `cwd` up to that root ([project-layers]).
    - A trusted layer contributes `config.toml` (settings, including `[hooks]`), `hooks.json` ([hooks-discovery]) and `rules/*.rules` ([exec-rules]). In a linked worktree, hooks come from the main checkout's matching `.codex` folder ([worktree-hooks]).
    - `config/value/write` accepts a quoted key segment with backslash escapes, so `projects."<path>".trust_level` names one project ([config-key-path]).
- **Account features follow the login, not the home (Documented, Observed).** `features.apps` (ChatGPT connectors) and `features.remote_plugin` are on by default ([cfg]), and the ChatGPT login requests `api.connectors.read api.connectors.invoke` (Observed). `-c features.apps=false` turns connectors off.
- **Environment variables (Source, Documented).**
  - **Credentials.** Stdio app-server ignores `CODEX_API_KEY` and does not use `OPENAI_API_KEY` for sign-in ([as-auth-mgr]). It does honour `CODEX_ACCESS_TOKEN`, which takes precedence over the stored login ([env-auth], [env]).
  - **Other variables.** `CODEX_SQLITE_HOME` moves SQLite state. `OPENAI_ORGANIZATION` and `OPENAI_PROJECT` become request headers. `CODEX_CA_CERTIFICATE`, `SSL_CERT_FILE` and `RUST_LOG` also apply ([env]).
  - **Spawned commands.** By default, spawned commands inherit the whole environment, including variable names containing `KEY`, `SECRET` or `TOKEN`; `shell_environment_policy.ignore_default_excludes` defaults to true ([cfg]). **Inference:** Playstead should start app-server with an explicit, scrubbed environment.
  - **`~/.config`.** A search of the source found no `~/.config` reads outside the opt-in migration of external agent configuration.

### Credentials in a custom home

- **`file`, the default (Source, Documented).** The packaged default is `cli_auth_credentials_store = "file"` ([defaults]). The credentials go in `CODEX_HOME/auth.json`, which is created with mode `0600` ([auth-file]).
- **`keyring` on macOS (Source).** The auth JSON is stored as a generic password ([auth-key], [store-types]). Service: `Codex Auth`. Account: `cli|` plus the first 16 hex digits of the SHA-256 of the canonical `CODEX_HOME` path.
  - Each home therefore gets its own entry. Because the path is canonicalised, `/tmp/x` and `/private/tmp/x` share one. For example, `/private/tmp/pcodex-home-A` maps to `cli|834dd21f6da5ff27`. A successful save to the keyring deletes that home's `auth.json`.
  - This applies unless `features.secret_auth_storage` is on, which by default it is only on Windows ([secret-auth]). With that feature, auth goes to the encrypted file `CODEX_HOME/secrets/codex_auth.age`. Its key is stored under service `codex` and account `secrets|<same hash>` ([secrets-key]).
- **Platform stores (Source).** `codex-keyring-store` selects the operating system's store at build time ([keyring-cargo]):
  - macOS: Keychain (`apple-native`).
  - Windows: Credential Manager (`windows-native`). `secret_auth_storage` is a stable feature enabled by default only on Windows, described as "Store CLI auth in the encrypted local secrets backend when keyring storage is selected" ([secret-auth]). With `keyring` on Windows, the credentials are therefore an encrypted file under `CODEX_HOME/secrets/`, and Credential Manager holds its key.
  - Linux: Secret Service over D-Bus, with kernel keyutils persistence (`linux-native-async-persistent`). A machine without a running Secret Service has no store, and `keyring` mode fails rather than falling back.
  - None of these was exercised; the Windows and Linux behaviour is from source only.
- **`auto` and `ephemeral` (Source).** `auto` reads the keyring and falls back to `auth.json` when the keyring is empty or fails. It saves to the keyring and falls back to the file on error ([auth-auto]). `ephemeral` keeps auth in process memory under the same key.
- **Observed.** With `-c cli_auth_credentials_store=keyring` in a fresh home, app-server started cleanly and `account/read` returned `account: null`. Writing to the keyring was not exercised.
- **When the setting is read (Source).** The store is read once, when the auth manager is built at startup ([as-auth-mgr]). Set it in `config.toml` or with `-c`, not per thread.

### Signing in through app-server

- **Browser flow (Observed).** `account/login/start {type: "chatgpt"}` returned `{type, loginId, authUrl}`, and app-server did not open a browser itself ([acct-login]). The `authUrl` points to `https://auth.openai.com/oauth/authorize`, has `redirect_uri=http://127.0.0.1:1455/auth/callback` and `originator` set to `clientInfo.name`, and requests the scope `openid profile email offline_access api.connectors.read api.connectors.invoke`. The docs show `chatgpt.com/...` and `localhost:<port>` instead ([as#auth-endpoints]).
- **Port conflicts (Source, Observed).** The callback binds `127.0.0.1:1455` ([login-bind]). If the port is busy, app-server sends an unauthenticated `GET /cancel` to it, which ends whichever Codex login server holds the port, whether it belongs to the CLI or to another app-server. It then retries 10 times at 200 ms intervals, and falls back to port `1457` if `1455` is still busy. Observed: a second `login/start` in the same process cancelled the first, which completed with `"Login server error: Login cancelled"`. **Inference:** a `codex login` started later would cancel a pending Playstead login in the same way.
- **Cancelling (Observed).** `account/login/cancel` returned `{status: "canceled"}`, or `notFound` for a stale id. It was followed by `account/login/completed {success: false, error: "Login server error: Login was not completed"}`.
- **Success (Source).** Tokens are saved through the configured store and keyring backend ([login-persist]). App-server then reloads auth and sends `account/login/completed {success: true}` followed by `account/updated {authMode, planType}` ([acct-notify]). The browser flow times out after 10 minutes.
- **How a browser sign-in ends (Source, checked 2026-10-14).** `account/login/completed` carries one of these `error` strings ([acct-login], [login-server]):
  - `Login timed out` after 10 minutes.
  - `Login server error: Login cancelled` when something sends `GET /cancel` to the callback port, as another Codex sign-in does.
  - `Login server error: Login was not completed` after `account/login/cancel`, or when a newer `account/login/start` replaces the attempt.
  - `Login server error: Sign-in completed but credentials could not be saved locally.` when saving to the configured store fails. With `keyring` there is no file fallback.
  - `Login server error: Sign-in failed: <description>` when the OAuth callback carries an error.
- **Playstead's launch settings (Observed, 2026-10-14, 0.162.1 on macOS 26.6.2).** In a fresh home, app-server started with `-c cli_auth_credentials_store="keyring"`, `-c features.apps=false`, `-c features.remote_plugin=false` and `-c shell_environment_policy.ignore_default_excludes=false`, and `config/read` reported all four. `initialize` with `clientInfo.name: "playstead"` returned a `userAgent` beginning `playstead/0.162.1`. Signed out, `account/read` returned `account: null`, and `account/rateLimits/read` failed with `-32600 "codex account authentication required to read rate limits"`. No sign-in was completed.
- **Device code (Documented, Source; not exercised).** `{type: "chatgptDeviceCode"}` returns `{loginId, verificationUrl: "https://auth.openai.com/codex/device", userCode}` ([as#auth-endpoints]). The server polls for up to 15 minutes ([device]). Device code sign-in is in beta, and it must first be enabled in the user's ChatGPT security settings or by a workspace admin ([auth#preferred-device-code-authentication-beta]). **Inference:** with no localhost callback, the code can be entered on any device, which makes this the route for a later phone flow.

### Configuring a fresh home

- **Create the directory first (Observed, Source).** `CODEX_HOME` must already exist as a directory. With a missing path, app-server exits with status 1 and the message `CODEX_HOME points to "…", but that path does not exist` ([home-dir]). The path is canonicalised; `initialize` reported `/private/tmp/...` for a `/tmp/...` home.
- **Files written at startup (Observed).** The SQLite databases `state_5`, `logs_2`, `goals_1`, `memories_1` and `queue_1`, plus `installation_id`, `tmp/arg0`, a curated-plugin sync under `.tmp/`, and `skills/.system`. Under the default umask, files were created with mode `0644` and directories with `0755`. **Inference:** Playstead should create the home itself with mode `0700`. No `config.toml`, `auth.json` or `sessions/` appeared. Rollout files appear once a thread is used ([rollout-lib]).
- **A thread that never ran a turn does not survive a restart (Observed, 0.162.1 on macOS, 2026-10-14).** In a fresh home without sign-in, `thread/start` answered a `thread.path` under `sessions/`, but no file was written there, whether the process was then killed or closed by ending its input. In a new process, `thread/resume {threadId, excludeTurns: true}` failed with JSON-RPC error `-32600`, `no rollout found for thread id <id>`. Playstead therefore starts a new thread in place of one no turn can have reached, and records it. Probe: `unused-thread-resume`.
- **No config file is required (Observed, Schema).** App-server started and answered with defaults. Per thread, `thread/start` accepts `cwd`, `model`, `approvalPolicy`, `sandbox`, `developerInstructions` and a `config` map of dotted keys (Schema). For the whole process, `-c key=value` at launch worked (Observed with `cli_auth_credentials_store` and `skills.*`).
- **Checking a config key.** A key a Codex binary reads appears in it as text. `grep -ao 'model_reasoning_effort' "$(command -v codex)"` prints the key if the installed binary knows it; an npm install puts a launcher script on `PATH`, so point the command at its native binary instead. This shows the key is known, not what it does.
- **App-server writes into the home itself (Source).** Automatic project trust, `skills/config/write`, `config/value/write` and `config/batchWrite` all edit `config.toml` ([as]). An `acceptWithExecpolicyAmendment` decision writes `CODEX_HOME/rules/default.rules` ([exec-rules]).
- **Inference.** Playstead could write a small `config.toml`, so that a manual `CODEX_HOME=… codex login` behaves the same as app-server. It would contain `cli_auth_credentials_store`; optionally `skills.bundled.enabled = false`, `[[skills.config]]` rules and `features.apps = false`; and explicit `[projects]` trust entries, so that trust is Playstead's decision rather than a side effect of `thread/start`. Approval policy and sandbox can stay per thread.

## 11. Codex on Windows

Nothing in this section was exercised; no Windows machine was available. Every Windows statement comes from the docs, the source at the tag or the schema.

### Support and sandbox selection

- **Native Windows is supported (Documented, npm).**
  - Codex runs natively in PowerShell. The docs say to "use the native Windows sandbox by default" and to choose WSL2 only for Linux-native tooling ([win-sbx]). WSL1 has been unsupported since 0.115 ([win-wsl]).
  - Windows 11 is "Recommended". A fully updated Windows 10 1809 or later is "Best effort", because Codex needs ConPTY ([win-sbx#windows-version-matrix]).
  - `@openai/codex@0.162.1` ships `win32-x64` and `win32-arm64` packages (`npm view`). Each holds `bin/codex.exe` and, in `codex-resources/`, `codex-command-runner.exe` and `codex-windows-sandbox-setup.exe`. Codex finds the helpers relative to `codex.exe`, so the layout must be kept ([pkg-layout], [helper-path]).
- **`[windows] sandbox` selects one of three implementations (Documented, Source).**
  - `mxc` uses Microsoft Execution Containers, built on AppContainer ([mxc-avail]). It needs no administrator rights, extra accounts or firewall rules, but it does need Windows 11 24H2 (build 26100.9278) or 25H2 (build 26200.9278) with the capability rolled out. An explicit `mxc` fails where it is unavailable. `features.prefer_mxc` (under development, off by default in the CLI) uses MXC where available and otherwise keeps the legacy mode ([win-sbx#mxc-compatibility], [win-features], [prefer-mxc]).
  - `elevated` setup launches `codex-windows-sandbox-setup.exe` with the `runas` verb, so **the user must approve a UAC prompt**; declining fails setup ([setup-uac]). Setup creates the local users `CodexSandboxOffline` and `CodexSandboxOnline`, firewall rules, ACLs and logon rights. Commands then run as those users, not as administrator ([setup-consts], [win-sbx#configure-a-legacy-fallback]).
  - `unelevated` runs commands with a restricted token derived from the current user, plus ACLs. It needs no administrator rights, but its network isolation is weaker and it cannot deny reads ([win-sbx#configure-a-legacy-fallback]).
- **No selection means no sandbox, so Codex asks instead (Source).**
  - A fresh `CODEX_HOME` has no `windows.sandbox` and `prefer_mxc` is off, so the level is `Disabled` ([win-level]).
  - `workspace-write` is then downgraded to `read-only` at config load, and the `thread/start` response reports the downgrade ([eff-mode]).
  - Every command that no rule allows prompts under `on-request` and is forbidden under `never` ([ep-win]). File edits prompt too ([patch-win]). **Inference:** an approved command runs with no sandbox.
- **Setup methods (Schema, Source).** Both are on the stable surface ([ws-proto]).
  - `windowsSandbox/readiness` takes no parameters and returns `{status: ready | notConfigured | updateRequired}` ([wsp-ready], [setup-done]). It is in the README but not in the docs ([as-readme-win]).
    - `notConfigured`: nothing is selected, or the host is not Windows.
    - `ready`: always for `unelevated` and `mxc`. For `elevated`, only when `CODEX_HOME/.sandbox/setup_marker.json` and the stored sandbox users match the current setup version; otherwise `updateRequired`.
  - `windowsSandbox/setupStart {mode: elevated | unelevated, cwd?}` checks managed requirements, replies `{started: true}` and runs setup in the background. It then sends `windowsSandbox/setupCompleted {mode, success, error}` to that connection only ([wsp-setup], [as#windows-sandbox-setup-windowssandboxsetupstart]).
    - Without `cwd`, no workspace roots are granted. On success, it writes `windows.sandbox` to `CODEX_HOME/config.toml` ([ws-persist]). There is no MXC setup mode.
  - `windows/worldWritableWarning` is in the schema, but nothing in 0.162.1 sends it.
- **Setup state is per `CODEX_HOME` (Source).**
  - `CODEX_HOME` holds the setup marker and log (`.sandbox/`), copies of the helpers (`.sandbox-bin/`) and the sandbox users' DPAPI-protected passwords (`.sandbox-secrets/`) ([setup-dirs], [sbx-users]). The accounts themselves are machine-wide, so a Playstead home needs its own setup even when the user's Codex is already set up.
  - When `elevated` is selected but setup is out of date, the first sandboxed command runs setup itself and raises UAC mid-turn ([auto-setup]).

### What the Windows sandbox enforces

- **Writes (Source).**
  - Writable roots get ACL allow entries. `CODEX_HOME` and its `.sandbox*` folders are never writable ([sens-write]).
  - `.git`, `.codex`, `.agents` and `.aws` get deny-write entries **only if they exist** when the command starts ([allow-deny], [ws-acl]). **Inference:** a command can create a missing `.codex` or `.agents` and write into it.
  - The allow entries stay on the working folder afterwards. A search for `revoke_ace` finds only deny-read entries being removed.
- **Reads (Source, Documented).**
  - Under `elevated`, the sandbox users can read only what setup grants: `C:\Windows`, Program Files, ProgramData, the working folder, the writable roots, and each top-level entry of the user profile except `.ssh`, `.aws`, `.gnupg`, `.config`, `.docker`, `.kube`, `.npm` and similar ([read-roots]).
  - Under `unelevated`, reads are the user's own.
- **Network off and loopback (Source, Documented).**
  - **`elevated`:** firewall rules for the offline user block non-loopback traffic, loopback UDP, and loopback TCP except Codex's proxy ports ([fw]). **A sandboxed command cannot reach a server on `127.0.0.1`**, such as a game's dev server, unless `allow_local_binding` is set.
  - **`unelevated`:** the block is only environment settings ([no-net-env]): `HTTP(S)_PROXY=http://127.0.0.1:9`, `NO_PROXY=localhost,127.0.0.1,::1`, `NPM_CONFIG_OFFLINE`, and failing `ssh` and `scp` stubs in `%USERPROFILE%\.sbx-denybin`. A program that ignores them reaches any host, including loopback.
  - **`mxc`:** the docs say it "permits connections to and from services on host loopback", and that "remaining child processes stop when the foreground command exits", which ends detached dev servers ([win-sbx#mxc-compatibility]).

### Commands, paths, credentials and processes

- **Shell (Source).**
  - Commands always run in PowerShell, and no config key changes the shell ([shell-detect]). Codex uses `pwsh` 7 from `PATH` or `C:\Program Files\PowerShell\7`, then Windows PowerShell 5.1, then `cmd.exe`.
  - Each script is prefixed with a UTF-8 output setting ([ps-utf8]). `-NoProfile` is added only when `allow_login_shell = false`, so the user's profile runs by default ([shell-login]).
  - Codex passes no `-ExecutionPolicy`. The docs tell users to set `RemoteSigned` if `npm.ps1` is blocked ([win-app#powershell-execution-policy-blocks-commands]).
- **`commandExecution` items (Source).**
  - `command` is the whole argv joined with POSIX quoting, with secrets redacted, for example `'C:\Program Files\PowerShell\7\pwsh.exe' -Command '…'` ([item-cmd]). Approval requests carry the same string unredacted ([beh-cmd-str]).
  - `commandActions` unwraps PowerShell, but only a lone `Get-Content` is recognised as `read`; everything else is `unknown` ([ps-actions]).
- **Approvals (Source).**
  - 0.162.1 has no list of known-safe commands on any platform.
  - A Windows list of dangerous commands always prompts, or is forbidden under `never` ([win-danger]). It covers URL launches through `Start-Process`, `rundll32` or `mshta`, and `Remove-Item -Force` and `del /f`.
- **Paths (Source).**
  - Paths travel as native strings such as `C:\work\game`. Parsing strips the `\\?\` and `\\.\` prefixes and resolves `.` and `..`, but neither canonicalises nor folds case ([abs-path]).
  - `thread/start` `cwd` keeps the caller's spelling; a relative `cwd` resolves against app-server's own folder ([req-cwd]). `initialize.codexHome` is canonicalised ([home-dir]).
  - Project trust keys and the sandbox's path keys are lower-cased ([trust-key], [path-key]), but `WritableRoot` and protected-name checks are case-sensitive ([writable-root]). **Inference:** to compare a working folder with the host data folder, resolve both on disk and compare whole path components case-insensitively.
- **Credentials (Source).**
  - The default store is `file`. On Windows `auth.json` gets no ACL of its own, whereas Unix gets mode `0600` ([auth-file]).
  - Under `keyring`, `secret_auth_storage` is on by default and writes the age-encrypted `CODEX_HOME\secrets\codex_auth.age`. Credential Manager holds only a 44-character key ([secret-auth], [secrets-key]).
  - The keyring crate rejects Credential Manager blobs over 2,560 bytes ([keyring-win]). **Inference:** this limit is why tokens go to the encrypted file.
  - `keyring` fails instead of falling back; `auto` falls back to `auth.json` ([auth-auto]). Account names hash the canonical home path, so moving the home orphans them.
- **Login callback (Source, Inference).**
  - Nothing is Windows-specific. The callback binds `127.0.0.1:1455`, falling back to `1457`, and app-server opens no browser ([login-bind], [acct-login]).
  - **Inference:** a listener on loopback only should not trigger a Windows Defender Firewall prompt.
  - A bind error other than "address in use", such as a port in a Hyper-V excluded range, has no fallback. Device code sign-in needs no port.
- **Process lifetime (Source).**
  - Closing stdin shuts the server down as on Unix, but the SIGTERM handler and the 45 s forced-exit watchdog are Unix-only ([stdio-unix], [stdio]). The Windows server listens only for Ctrl+C ([lib-signal]), and stdio mode ignores even that ([lib-stdio-signal]).
  - Unsandboxed and `unelevated` commands run in job objects that kill their members on close ([job]). A command that exits normally leaves its descendants running, and they outlive app-server ([job-preserve]).
  - `elevated` commands run under `codex-command-runner.exe`, which kills its job when its pipe from app-server closes ([runner-eof]).
  - The npm launcher `codex.js` forwards signals with `child.kill()`, which on Windows is `TerminateProcess` ([codex-js]). Codex itself kills child trees with `taskkill /T /F` ([taskkill]).
  - **Inference:** spawn `codex.exe app-server` directly, with `windowsHide`. To stop it, close stdin, wait up to a host deadline of about 45 s, then run `taskkill /PID <pid> /T /F`.

### Effect on Playstead's defaults

- **`workspace-write` with network off.**
  - It needs a selected sandbox, and `elevated` must also be set up. Otherwise it becomes `read-only` and every command prompts.
  - `elevated` also blocks `127.0.0.1`. Under `unelevated`, network off is advisory only.
- **`on-request` and `approvalsReviewer: user`.** The only Windows-specific handling found is the prompting when there is no sandbox and the PowerShell list of dangerous commands (Source).
- **Skills.**
  - `$HOME/.agents/skills` comes from `dirs::home_dir()`. On Windows this calls `SHGetKnownFolderPath(FOLDERID_Profile)` and ignores `HOME` and `USERPROFILE` ([skill-home], [dirs-home]).
  - **Inference:** the `HOME` override in §10 cannot hide user skills on Windows. Use `[[skills.config]]` or `skills.include_instructions = false` instead.
- **Automatic project trust** writes a canonical, lower-cased key, for example `[projects.'c:\users\…\game']` ([trust-key]).
- **`shell_environment_policy`.**
  - The default excludes ignore case.
  - `inherit = "core"` keeps a Windows list that includes `PATH`, `PATHEXT`, `COMSPEC`, `SYSTEMROOT`, `USERPROFILE`, `APPDATA`, `LOCALAPPDATA` and `TEMP` ([env-win]).
  - **Inference:** a scrubbed app-server environment must keep these variables, or PowerShell breaks.

## Limits and unconfirmed points

A point that needs no sign-in or model call can be settled with a probe: `pnpm probe:codex <probe>` runs one from `dev/codex-probe/probes` against the installed Codex, found through `PLAYSTEAD_CODEX_BINARY` or `PATH`, in a throwaway home and prints what it found, with the version, platform and date to record here.

- Not exercised: turns, approvals, interrupts, resume after a kill, socket transports, the daemon and Sign in with ChatGPT. The smoke test covered only the handshake, `account/read`, `model/list`, `thread/list`, `thread/loaded/list`, `account/rateLimits/read` and the experimental gate. §10 added `config/read`, `skills/list`, and an `account/login/start` that was cancelled, all against temporary homes. Every statement about turn-time behaviour comes from docs or source.
- **Unconfirmed:** how a turn interrupted by `SIGKILL` or a crash appears after a cold `thread/resume`, and whether it can be continued.
- **Unconfirmed, played by v0's stand-in:** that a cold `thread/resume {threadId, cwd, sandbox, approvalPolicy, approvalsReviewer, excludeTurns: true}` of a thread that ran a turn answers the applied settings as `thread/start` does, and that `turn/start` then continues the thread. Also unconfirmed: that a turn cut off before anything completed, such as by `SIGKILL` mid-reply, leaves a rollout that resumes. The stand-in stores a thread once it runs a turn, and refuses to resume one that never did with the observed error (§10). Other resume failures, such as the writer-lock error ([writer]), are played only through `resumeError`.
- **Unconfirmed:** whether app-server accepts `approvalPolicy: "untrusted"` at runtime, given that the config docs call it retired.
- **Unconfirmed:** whether `tokenBudget` or `rollout_budget` stop work, and whether any server-side turn timeout exists.
- **Unconfirmed:** whether the OS sandbox confines MCP server processes and built-in file edits.
- **Unconfirmed:** whether threads started by Playstead appear in other Codex clients. They are probably source `appServer`, which the default `thread/list` filter excludes (Inference).
- **Unconfirmed (§10):** a keyring write in a non-default `CODEX_HOME`, and whether macOS asks for keychain access when the Codex binary changes. No login was completed.
- **Unconfirmed (§10):** whether a skill switched off with `skills/config/write` leaves the catalogue of a thread that is already running.
- **Unconfirmed (§10):** whether `thread/start` `config` overrides such as `skills.config` or `skills.include_instructions` change that thread's skills catalogue. Only the process-wide `-c` route was observed, through `skills/list`.
- **Unconfirmed:** whether `thread/start` `config: {model_reasoning_effort}` sets a new thread's effort, as the host relies on it. `model_reasoning_effort` is a top-level key in the 0.162.1 binary's `ConfigToml` (Observed, with `strings`), and the response's `reasoningEffort` shows what Codex applied. Each turn also sends its effort on `turn/start`. Also unconfirmed: what `effort: null` on `turn/start` does after an earlier turn set one.
- **Unconfirmed (§10):** whether overriding `HOME` for app-server and restoring it with `shell_environment_policy.set.HOME` keeps spawned tools and keychain access working.
- **Unconfirmed (§10):** that a CLI `codex login` and a Playstead login cancel each other across processes. This was observed only within one app-server. The device code flow was not run.
- **Unconfirmed (§11):** all Windows behaviour, because nothing was run on Windows. This includes:
  - that a fresh home downgrades `workspace-write` to `read-only` and asks for approval on every command;
  - that `windowsSandbox/setupStart` can raise UAC from an app-server that has no console window;
  - that `elevated` setup succeeds for a Playstead home alongside an existing Codex setup;
  - whether MXC is available on the founder's laptop.
- **Unconfirmed (§11), played by v0's stand-in:** that `windowsSandbox/setupStart` raises one UAC prompt and reports a declined prompt as `setupCompleted` with `success: false`; that readiness becomes `ready` after a successful `elevated` setup; and that setup started without `cwd`, as Playstead starts it, lets later `workspace-write` threads write in any working folder, since Codex grants write access per command ([allow-deny]). The stand-in also downgrades threads to read-only until the sandbox is ready, as §11 reads the source. Codex's exact error text for a declined prompt is unknown.
- **Limit (§11):** readiness is also `ready` for an `unelevated` or MXC selection (Source). Only Playstead's `elevated` setup writes `windows.sandbox` in its Codex home, so the host does not check which sandbox is selected; a hand edit of that `config.toml` would go unnoticed.
- **Unconfirmed (§11):** how long `codex.exe` takes to exit after stdin closes, given that Windows has no forced-exit watchdog. Also unconfirmed: whether killing the npm launcher orphans `codex.exe`, and how Codex renders Windows paths in `command`.
- **Unconfirmed (§11):** whether a Windows Defender Firewall prompt appears for the login callback, and whether ChatGPT tokens exceed the Credential Manager size limit in direct keyring mode.
- **Unconfirmed:** OpenAI terms beyond the app-server and Sign in with ChatGPT pages. No separate legal terms were reviewed. "Local or open-source" versus "commercial or hosted" is OpenAI's wording, and applying it to Playstead is my inference.
- **Doc drift (Inference).** The docs show `approvalPolicy: "unlessTrusted"` and `sandbox: "workspaceWrite"`, but the 0.162.1 serde definitions accept only `untrusted` and `workspace-write` ([shared]). The docs also describe `ReadOnlyAccess`, `perCwdExtraUserRoots`, `availableDecisions` as generally available, and PascalCase `codexErrorInfo`, none of which matches 0.162.1. These were not sent to the server.
- The schema was generated without `--experimental` unless stated otherwise. Line anchors point at tag `rust-v0.162.1`. Docs pages carry no version and may change without notice.

[as]: https://learn.chatgpt.com/docs/app-server
[as-md]: https://learn.chatgpt.com/docs/app-server.md
[as#experimental-api-opt-in]: https://learn.chatgpt.com/docs/app-server#experimental-api-opt-in
[as#message-schema]: https://learn.chatgpt.com/docs/app-server#message-schema
[as#protocol]: https://learn.chatgpt.com/docs/app-server#protocol
[as#initialization]: https://learn.chatgpt.com/docs/app-server#initialization
[as#start-or-resume-a-thread]: https://learn.chatgpt.com/docs/app-server#start-or-resume-a-thread
[as#unsubscribe-from-a-loaded-thread]: https://learn.chatgpt.com/docs/app-server#unsubscribe-from-a-loaded-thread
[as#list-thread-turns]: https://learn.chatgpt.com/docs/app-server#list-thread-turns
[as#list-thread-items]: https://learn.chatgpt.com/docs/app-server#list-thread-items
[as#list-threads-with-pagination--filters]: https://learn.chatgpt.com/docs/app-server#list-threads-with-pagination--filters
[as#revert-thread-history]: https://learn.chatgpt.com/docs/app-server#revert-thread-history
[as#start-a-turn]: https://learn.chatgpt.com/docs/app-server#start-a-turn
[as#interrupt-a-turn]: https://learn.chatgpt.com/docs/app-server#interrupt-a-turn
[as#events]: https://learn.chatgpt.com/docs/app-server#events
[as#items]: https://learn.chatgpt.com/docs/app-server#items
[as#item-deltas]: https://learn.chatgpt.com/docs/app-server#item-deltas
[as#errors]: https://learn.chatgpt.com/docs/app-server#errors
[as#notification-opt-out]: https://learn.chatgpt.com/docs/app-server#notification-opt-out
[as#command-execution-approvals]: https://learn.chatgpt.com/docs/app-server#command-execution-approvals
[as#permission-requests]: https://learn.chatgpt.com/docs/app-server#permission-requests
[as#mcp-server-elicitation-requests]: https://learn.chatgpt.com/docs/app-server#mcp-server-elicitation-requests
[as#mcp-tool-call-approvals-apps]: https://learn.chatgpt.com/docs/app-server#mcp-tool-call-approvals-apps
[as#toolrequestuserinput]: https://learn.chatgpt.com/docs/app-server#toolrequestuserinput
[as#track-thread-status-changes]: https://learn.chatgpt.com/docs/app-server#track-thread-status-changes
[as#command-execution]: https://learn.chatgpt.com/docs/app-server#command-execution
[as#manage-a-thread-goal]: https://learn.chatgpt.com/docs/app-server#manage-a-thread-goal
[as#skills]: https://learn.chatgpt.com/docs/app-server#skills
[as#auth-endpoints]: https://learn.chatgpt.com/docs/app-server#auth-endpoints
[as#6-rate-limits-chatgpt]: https://learn.chatgpt.com/docs/app-server#6-rate-limits-chatgpt
[as#7-token-usage-chatgpt]: https://learn.chatgpt.com/docs/app-server#7-token-usage-chatgpt
[sdk]: https://learn.chatgpt.com/docs/codex-sdk
[mcp]: https://learn.chatgpt.com/docs/mcp-server
[auth]: https://learn.chatgpt.com/docs/auth
[auth#login-caching]: https://learn.chatgpt.com/docs/auth#login-caching
[auth#credential-storage]: https://learn.chatgpt.com/docs/auth#credential-storage
[sec]: https://learn.chatgpt.com/docs/agent-approvals-security
[sec#migrate-from-the-retired-untrusted-approval-policy]: https://learn.chatgpt.com/docs/agent-approvals-security#migrate-from-the-retired-untrusted-approval-policy
[sec#os-level-sandbox]: https://learn.chatgpt.com/docs/agent-approvals-security#os-level-sandbox
[sec#protected-paths-in-writable-roots]: https://learn.chatgpt.com/docs/agent-approvals-security#protected-paths-in-writable-roots
[sec#safety-monitoring-and-paused-tasks]: https://learn.chatgpt.com/docs/agent-approvals-security#safety-monitoring-and-paused-tasks
[sbx]: https://learn.chatgpt.com/docs/sandboxing
[ar]: https://learn.chatgpt.com/docs/sandboxing/auto-review
[cfg]: https://learn.chatgpt.com/docs/config-file/config-reference
[env]: https://learn.chatgpt.com/docs/config-file/environment-variables
[agents]: https://learn.chatgpt.com/docs/agent-configuration/agents-md
[skills]: https://learn.chatgpt.com/docs/build-skills
[siwc-as]: https://developers.openai.com/siwc/token-sharing-open-source/codex-app-server
[siwc-lim]: https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
[siwc-ov]: https://developers.openai.com/siwc/token-sharing-open-source
[siwc-tok]: https://developers.openai.com/siwc/token-sharing-open-source/token-reference
[siwc-qs]: https://developers.openai.com/siwc/quickstart
[siwc-cb]: https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt
[rel]: https://github.com/openai/codex/releases/tag/rust-v0.162.1
[tag]: https://github.com/openai/codex/tree/rust-v0.162.1
[readme]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server/README.md
[daemon]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server-daemon/README.md
[stdio]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server-transport/src/transport/stdio.rs#L125-L180
[transport-mod]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server-transport/src/transport/mod.rs#L228-L266
[lib-drain]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server/src/lib.rs#L247-L300
[lib-close]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server/src/lib.rs#L1163-L1186
[lib-shut]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server/src/lib.rs#L1330-L1341
[mp-init]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server/src/message_processor.rs#L967-L983
[err]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server/src/error_code.rs
[tp-shut]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server/src/request_processors/thread_processor.rs#L1283-L1294
[tp-close]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server/src/request_processors/thread_processor.rs#L3588-L3660
[tl-replay]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server/src/request_processors/thread_lifecycle.rs#L803-L836
[out-abort]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server/src/outgoing_message.rs#L215-L229
[out-close]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server/src/outgoing_message.rs#L275-L280
[out-replay]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server/src/outgoing_message.rs#L446-L466
[beh-file]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server/src/bespoke_event_handling.rs#L1916-L1955
[beh-cmd]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server/src/bespoke_event_handling.rs#L1970-L2050
[turnproc]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server/src/request_processors/turn_processor.rs#L652-L692
[recovery]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server-transport/src/daemon_recovery.rs
[shared]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server-protocol/src/protocol/v2/shared.rs#L201-L339
[history]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server-protocol/src/protocol/thread_history.rs#L1257-L1292
[rollout-lib]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/rollout/src/lib.rs#L86-L87
[policy]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/rollout/src/policy.rs#L127-L220
[writer]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/rollout/src/writer_lock.rs#L1-L70
[sqlite]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/state/src/sqlite.rs#L34-L39
[tsexec]: https://github.com/openai/codex/blob/rust-v0.162.1/sdk/typescript/src/exec.ts#L50-L95
[cfg-adv]: https://learn.chatgpt.com/docs/config-file/config-advanced#project-config-files-codexconfigtoml
[skills#enable-or-disable-local-codex-skills]: https://learn.chatgpt.com/docs/build-skills#enable-or-disable-local-codex-skills
[auth#preferred-device-code-authentication-beta]: https://learn.chatgpt.com/docs/auth#preferred-device-code-authentication-beta
[home-dir]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/utils/home-dir/src/lib.rs#L13-L62
[defaults]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/config/defaults.toml#L1-L13
[layers]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/config/src/loader/mod.rs#L113-L135
[trust-gate]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/config/src/loader/mod.rs#L1093-L1110
[discover-root]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/config/src/loader/mod.rs#L1505-L1541
[project-layers]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/config/src/loader/mod.rs#L1653-L1700
[worktree-hooks]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/config/src/loader/mod.rs#L1113-L1123
[hooks-discovery]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/hooks/src/engine/discovery.rs#L339-L345
[config-key-path]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server/src/config_manager_service.rs#L506-L550
[mdm]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/config/src/loader/macos.rs#L179-L194
[skill-roots]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/ext/skills/src/host_roots.rs#L73-L185
[skills-cfg]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/config/src/skills_config.rs#L21-L132
[skills-write]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server/src/request_processors/catalog_processor.rs#L686-L710
[marketplace-home]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/core-plugins/src/marketplace.rs#L307-L315
[agents-load]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/core/src/agents_md.rs#L58-L72
[auto-trust]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server/src/request_processors/thread_processor.rs#L1350-L1414
[exec-rules]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/core/src/exec_policy.rs#L662-L683
[env-auth]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/login/src/auth/manager.rs#L1500-L1557
[as-auth-mgr]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server/src/lib.rs#L546-L590
[auth-file]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/login/src/auth/storage.rs#L214-L231
[auth-key]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/login/src/auth/storage.rs#L243-L346
[auth-auto]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/login/src/auth/storage.rs#L452-L582
[store-types]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/config/src/types.rs#L136-L183
[secret-auth]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/features/src/lib.rs#L1028-L1033
[secrets-key]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/secrets/src/lib.rs#L184-L204
[keyring-cargo]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/keyring-store/Cargo.toml
[acct-login]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server/src/request_processors/account_processor.rs#L583-L727
[acct-notify]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server/src/request_processors/account_processor.rs#L921-L988
[login-bind]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/login/src/server.rs#L620-L700
[login-server]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/login/src/server.rs#L226-L560
[login-persist]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/login/src/server.rs#L833-L883
[device]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/login/src/device_code_auth.rs#L100-L180
[win-sbx]: https://learn.chatgpt.com/docs/windows/windows-sandbox
[win-sbx#windows-version-matrix]: https://learn.chatgpt.com/docs/windows/windows-sandbox#windows-version-matrix
[win-sbx#mxc-compatibility]: https://learn.chatgpt.com/docs/windows/windows-sandbox#mxc-compatibility
[win-sbx#configure-a-legacy-fallback]: https://learn.chatgpt.com/docs/windows/windows-sandbox#configure-a-legacy-fallback
[win-wsl]: https://learn.chatgpt.com/docs/windows/wsl
[win-app#powershell-execution-policy-blocks-commands]: https://learn.chatgpt.com/docs/windows/windows-app#powershell-execution-policy-blocks-commands
[as#windows-sandbox-setup-windowssandboxsetupstart]: https://learn.chatgpt.com/docs/app-server#windows-sandbox-setup-windowssandboxsetupstart
[as-readme-win]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server/README.md#L413-L424
[pkg-layout]: https://github.com/openai/codex/blob/rust-v0.162.1/scripts/codex_package/README.md#L17-L30
[helper-path]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/windows-sandbox-rs/src/helper_materialization.rs#L166-L190
[mxc-avail]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/mxc-sandbox/src/lib.rs#L91-L100
[win-features]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/features/src/lib.rs#L1327-L1349
[prefer-mxc]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/core/src/config/mod.rs#L3533-L3549
[setup-uac]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/windows-sandbox-rs/src/setup.rs#L1031-L1056
[setup-consts]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/windows-sandbox-rs/src/setup.rs#L52-L78
[win-level]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/core/src/windows_sandbox.rs#L61-L120
[eff-mode]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/config/src/config_toml.rs#L816-L834
[ep-win]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/core/src/exec_policy.rs#L785-L806
[patch-win]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/core/src/safety.rs#L95-L124
[ws-proto]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server-protocol/src/protocol/common.rs#L1277-L1286
[wsp-ready]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server/src/request_processors/windows_sandbox_processor.rs#L317-L353
[wsp-setup]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server/src/request_processors/windows_sandbox_processor.rs#L100-L289
[setup-done]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/windows-sandbox-rs/src/identity.rs#L79-L90
[ws-persist]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/core/src/windows_sandbox.rs#L308-L353
[setup-dirs]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/windows-sandbox-rs/src/setup.rs#L187-L201
[sbx-users]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/windows-sandbox-rs/src/setup_provisioning/sandbox_users.rs#L314-L350
[auto-setup]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/windows-sandbox-rs/src/identity.rs#L393-L456
[sens-write]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/windows-sandbox-rs/src/setup.rs#L1454-L1475
[allow-deny]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/windows-sandbox-rs/src/allow.rs#L14-L42
[ws-acl]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/windows-sandbox-rs/src/workspace_acl.rs#L23-L30
[read-roots]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/windows-sandbox-rs/src/setup.rs#L555-L620
[fw]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/windows-sandbox-rs/src/setup_provisioning/firewall.rs#L35-L237
[no-net-env]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/windows-sandbox-rs/src/env.rs#L126-L175
[shell-detect]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/shell-command/src/shell_detect.rs#L256-L352
[ps-utf8]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/shell-command/src/powershell.rs#L11-L33
[shell-login]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/core/src/shell.rs#L34-L43
[item-cmd]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server-protocol/src/protocol/item_builders.rs#L46-L62
[beh-cmd-str]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server/src/bespoke_event_handling.rs#L714-L750
[ps-actions]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/shell-command/src/parse_command.rs#L1423-L1447
[win-danger]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/shell-command/src/command_safety/windows_dangerous_commands.rs#L6-L87
[abs-path]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/utils/absolute-path/src/lib.rs#L147-L185
[req-cwd]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server/src/request_processors.rs#L631-L637
[trust-key]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/config/src/loader/mod.rs#L1381-L1430
[path-key]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/windows-sandbox-rs/src/path_normalization.rs#L4-L13
[writable-root]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/protocol/src/protocol.rs#L1156-L1190
[keyring-win]: https://docs.rs/crate/keyring/3.6.3/source/src/windows.rs
[stdio-unix]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server-transport/src/transport/stdio.rs#L34-L51
[lib-signal]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server/src/lib.rs#L218-L241
[lib-stdio-signal]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/app-server/src/lib.rs#L794-L796
[job]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/utils/pty/src/win/job.rs#L42-L60
[job-preserve]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/utils/pty/src/win/job.rs#L215-L253
[runner-eof]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/windows-sandbox-rs/src/bin/command_runner/win.rs#L441-L460
[codex-js]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-cli/bin/codex.js#L241-L295
[taskkill]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/exec-server/src/connection.rs#L234-L270
[skill-home]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/ext/skills/src/host_roots.rs#L18-L42
[dirs-home]: https://docs.rs/dirs/6.0.0/dirs/fn.home_dir.html
[env-win]: https://github.com/openai/codex/blob/rust-v0.162.1/codex-rs/protocol/src/shell_environment.rs#L124-L200
[t3]: https://github.com/pingdotgg/t3code/tree/7d5a42912a4036549ac4c70d0195f02af432115a
[t3-adapter]: https://github.com/pingdotgg/t3code/blob/7d5a42912a4036549ac4c70d0195f02af432115a/apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts
[t3-sm]: https://github.com/pingdotgg/t3code/blob/7d5a42912a4036549ac4c70d0195f02af432115a/apps/server/src/orchestration-v2/ProviderSessionManager.ts
[t3-managed]: https://github.com/pingdotgg/t3code/blob/7d5a42912a4036549ac4c70d0195f02af432115a/apps/server/src/provider/CodexManagedRuntime.ts
