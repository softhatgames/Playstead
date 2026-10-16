# How T3 Code tests itself

- **Question:** How does T3 Code test itself, and in particular how does `packages/provider-testing` record and replay provider sessions? Which tests need a real, installed and signed-in provider, and which run without one? Asked in [#4](https://github.com/softhatgames/playstead/issues/4), on the way to the first working slice ([#1](https://github.com/softhatgames/playstead/issues/1)).
- **Date:** 2026-10-16.
- **Source:** T3 Code at commit `2577baf` (`2577baf8b0dc541283fa93d6919b0e354effadf4`, 2026-10-15), read from the reference clone at `~/.cache/playstead/t3code` with `git show`, `git ls-tree`, `git grep` and `git log`. Nothing was installed, built or run, so every statement comes from reading.
- **Citations:** paths are in T3 Code's repository. `path:12-20` means lines 12 to 20 at `2577baf`, viewable at `https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/<path>#L12-L20`.

Labels: **Documented** (T3 Code's own documentation at `2577baf`), **Source** (code, configuration or recordings at `2577baf`), **History** (T3 Code commits before `2577baf`), **Inference** (my reasoning) and **Not found** (searched for and absent).

## Summary for Playstead

- **Few, deep tests.** T3 Code validates its orchestration "with a small number of high-value integration tests". A command goes through the real orchestrator, provider adapter, event store, projections and checkpoint policy; only the provider's transport is replayed. Test doubles are allowed only at process, network, clock, id and filesystem boundaries (Documented, `docs/orchestration-v2/testing-strategy.md:3-48`).
- **A recording is an NDJSON transcript of raw provider frames.** A `transcript_start` header (provider, protocol, version, scenario, metadata) is followed, in order, by `expect_outbound` frames T3 must send, `emit_inbound` frames the provider sent, and a `runtime_exit` (Source, `packages/contracts/src/orchestrationV2.ts:3582-3626`). There are 149 recordings in scenario folders, each folder with a provider-neutral `input.ts` and per-provider assertions (§2).
- **Recordings are made by hand against real, signed-in providers,** with one recorder script per protocol (`apps/server/scripts/record-*-replay-fixture.ts`). They write over the committed recording by default. The Pi and Muse recorders drive T3's real orchestrator against the live agent and keep a recording only if its replay passes the scenario's assertions (§3).
- **Replay replaces the lowest transport seam each adapter owns:** Codex's stdio stream, the Claude Agent SDK's `query()` runner, Cursor's SDK, OpenCode's HTTP client, a child-process ACP peer, Pi's process spawner or Muse's host. Each outbound frame is checked in order after normalising, and recorded inbound frames are fed in their recorded order (§4).
- **Nothing keeps recordings current automatically.** No workflow records, and no CI test runs a real provider (Not found). People re-record, edit expected outbound frames in place when T3's own requests change (one commit edited a line in 30 Codex recordings), and hand-port newer behaviour. The Codex replayer also fills in fields older recordings lack. Header versions are unreliable: the Claude recorder always writes `0.2.111`, while the server depends on `^0.3.276` (§5).
- **Everything else runs on `vp test`** (Vite+, with Vitest underneath) in Node. Server test files run one at a time, in 8 CI shards balanced by recorded durations. Web tests are mostly Node logic tests, with some jsdom and static-markup rendering, and there is no automated browser test of the web client. The desktop smoke test only boots the built Electron app for 8 seconds, and no workflow runs it (§6–8).
- **Performance** is guarded by byte and SQL-statement budgets inside ordinary tests, plus a transfer-budget report that CI posts on pull requests (§9).
- **CI runs the tests only on Linux,** for every pull request and push to `main`, with no secrets and no provider installed. macOS and Windows see only release builds, whose command-line archives are smoke-tested on each platform's own hardware. The Windows test lane is manual, and "nothing in the suite passes on Windows yet" (§8, §10).
- **Real providers are needed only by** the recorders, a few opt-in `*.live.test.ts` files (Cursor, Grok, ACP Registry with Antigravity, OpenCode 2) and manual verification scripts. There is no live test for Codex or Claude. All other tests run without any provider installed or signed in (§11).
- **For Playstead's first slice (Inference).** The thread part of the scenario, a turn in which Codex or Claude writes a text file, can be checked offline and in CI against a recording Playstead makes once per provider. That proves Playstead's handling of the recorded protocol. It does not prove that the file appears on disk, that installed providers are found, that sign-in works or that the desktop app runs; those need fake executables, a live run and a packaged-app check of Playstead's own (§12).

## 1. The testing principle

- **Shape (Documented).** "command dispatch → real Orchestrator → real ProviderAdapter → replayed ProviderRuntime transport → real adapter normalizer → real V2 event store/sink using production persistence semantics → real V2 projection/projector → real Checkpoint policy → assertions" (`docs/orchestration-v2/testing-strategy.md:9-21`). Replay "does not replace the adapter, normalizer, command/event infrastructure, projection reducers/projectors, checkpoint policy, or business logic" (line 23).
- **Allowed substitutes (Documented):** the provider transport backed by replay transcripts, Effect's `TestClock`, a deterministic `Random`, temporary filesystems and worktrees, a temporary or in-memory database with the same repository interfaces, and a fake process supervisor only for process-failure tests. Mocked orchestrators, adapters, normalisers, event sinks, projection reducers, checkpoint services or capability policy are not allowed, nor are pre-normalised domain events as adapter input (`testing-strategy.md:27-48`).
- **Determinism (Documented, Source).** Production code reads time and randomness only through Effect services (`testing-strategy.md:52-60`). Replay tests run under `provideDeterministicTestRuntime`, which supplies `TestClock.layer()` and `Random.withSeed(0x1234_5678)` (`apps/server/src/orchestration-v2/testkit/DeterministicRuntime.ts:5-13`).
- **Four levels (Documented):** schema tests, pure projection tests, adapter replay tests and full orchestration tests. "The fourth level is the most important one" (`testing-strategy.md:158-167`).
- **Provider guidance (Documented).** Adapter behaviour is proved with replays. Unit tests are "for pure logic and for failures a real provider cannot produce on demand. A test that drives the adapter with hand-written frames is a guess about the protocol; live testing regularly finds what those guesses missed." A gated live test "is welcome, but it does not replace replays, because CI skips it" (`docs/internals/adding-a-provider.md:51-68`).
- **Contributor rules (Documented).** Run the smallest proof, such as `vp test run <files>`; no repo-wide checks, as "CI owns the full suite"; drain the effect worker or await a persisted event, and "A test that needs a timeout to pass is wrong." Do not render components to static markup to assert props (`AGENTS.md:96-103`). Waiting uses drainable workers (`docs/internals/overview.md:98-105`).
- **Lint (Source).** `t3code/no-manual-effect-runtime-in-tests` ("Use @effect/vitest with it.effect(...) and test layers instead") and `t3code/no-test-in-loop` (use `it.each`) are errors (`vite.config.ts:165,168`; `oxlint-plugin-t3code/rules/no-manual-effect-runtime-in-tests.ts:92`). In `@effect/vitest`, `it.effect` runs with `TestClock` and `TestConsole` and `it.live` with live services (`.repos/effect-smol/packages/vitest/src/internal/internal.ts:59,386-387`, T3 Code's vendored copy of Effect).

## 2. What a recording contains

- **Schema (Source).** `ProviderReplayEntry` is one of `expect_outbound {label?, frame}`, `emit_inbound {label?, frame, afterMs?}` and `runtime_exit {status: success | error | cancelled, error?}`. `ProviderReplayTranscript` holds `provider`, `protocol`, `version`, `scenario`, optional `metadata` and `entries`. On disk the first line is a `transcript_start` record carrying the same metadata (`packages/contracts/src/orchestrationV2.ts:3582-3626`).
- **Reading (Source).** `decodeProviderReplayNdjson` skips blank lines, requires the header first (or fallback metadata) and rejects a second header. `readProviderReplayTranscript` converts file URLs through Effect's `Path`, so Windows drive-letter and UNC paths work (`packages/provider-testing/src/replayTranscript.ts:116-173`).
- **Example, Claude (Source).** `apps/server/src/orchestration-v2/testkit/fixtures/simple/claude_transcript.ndjson` has 10 lines. The header records the prompt, model `claude-sonnet-4-6`, the native session id, `permissionMode: bypassPermissions` and `generatedBy`. Then come `expect_outbound` `query.open` (the SDK options T3 passes) and `prompt.offer:1`, then `emit_inbound` hook frames, `system:init`, `assistant`, `rate_limit_event` and `result`, and finally `runtime_exit success`.
- **Example, Codex (Source).** `fixtures/simple/codex_transcript.ndjson` has 30 lines of JSON-RPC: `initialize`, `initialized`, `thread/start` with `cwd: "<workspace>"`, `turn/start` with `approvalPolicy: "never"` and `sandboxPolicy: {type: "dangerFullAccess"}` (Full access), the provider's notifications with their own `emittedAtMs`, three text deltas, `turn/completed` and `runtime_exit success`.
- **Placeholders and sanitising (Source).**
  - `<workspace>` stands for the run's working directory and is filled in outbound frames only (`packages/provider-testing/src/replayTranscript.ts:52,72-87`).
  - The Codex recorder replaces the home directory with `/home/replay-user`, the checkout with `/home/replay-user/t3code`, the hostname with `replay-host`, and `installationId` and `planType` with fixed values (`apps/server/scripts/codexReplayRecordingRecords.ts:1-73`).
  - The Claude recorder rewrites the working directory to `/tmp/claude-replay-<scenario>`, empties the account's tools, MCP servers, slash commands, skills and plugins in `system:init`, and keeps only the status of rate-limit events (`apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.testkit.ts:1157-1229`).
  - ACP recordings use `<any>` wildcards (`apps/server/scripts/acp-replay-agent.ts:86-123`). Grok's header states its normalisation: fixed session ids, `<workspace>`, a placeholder home and user, and T3's own prompt text as `<any>` (`apps/server/scripts/record-grok-acp-replay-fixture.ts:525-526`).
- **No recorded timing (Source).** No recording uses `afterMs`. Time moves through `advance_clock` steps on the test clock.
- **Scenario folders (Source).** Each folder under `apps/server/src/orchestration-v2/testkit/fixtures/` holds:
  - `input.ts`, the provider-neutral steps: `message`, `queue_message`, `steer`, `restart`, `interrupt`, `approve_next_runtime_request`, `answer_next_user_input_request`, `rollback`, `advance_clock`, `release_replay_gate` and others, plus optional `workspaceFiles` (`fixtures/shared.ts:203-308`);
  - `<provider>_transcript.ndjson`, the recording;
  - `<provider>_output.ts`, assertions on the final projection (for example `fixtures/simple/claude_output.ts:18-33`);
  - sometimes a `README.md`.
- **Registry (Source).** `ORCHESTRATOR_REPLAY_FIXTURES` (`fixtures/index.ts:220`) lists 79 scenarios with 131 provider variants. `simple` alone has 8 (`index.ts:617-669`). The other 18 recordings serve dedicated tests for forks, merge-back, provider switching and recovery. Prompts are shared constants, such as `SIMPLE_PROMPT` (`fixtures/shared.ts:33`), used by both the recorders and `input.ts`.
- **Inventory (Source).**

| Provider | Recordings | Protocol | Header versions |
| --- | --- | --- | --- |
| Claude | 42 | `claude-agent-sdk.query` | `0.2.111` (38), `0.3.276` (4) |
| Codex | 31 | `codex.app-server` | `0.156.1` (27), `0.120.0` (2), `0.157.0` (1), `0.124.0-alpha.3` (1) |
| OpenCode | 22 | `opencode-sdk.sse`, `opencode2-http.sse` | `1.14.39` (6), `2.0.18` (16) |
| Grok | 16 | `acp.ndjson-jsonrpc` | `1` |
| ACP Registry | 11 | `acp.ndjson-jsonrpc` | `1` |
| Cursor | 11 | `cursor-agent-sdk.local` | `1` |
| Pi | 8 | `pi.rpc-jsonl` | `1.0.0` |
| Muse | 8 | `muse.msp-jsonl` | `1.4.3-R5018.1` (4), `1.4.4-R5419.1` (3), `1.4.6-R6000.1` (1) |

- **Provenance (Source).** 129 of the 149 headers name a recorder or live capture. The other 20 say "hand-authored", "hand-ported", "constructed", "protocol-semantic-fixture" or "manual-replay-from-thread", meaning assembled by hand from a real thread's logs. These cover failures that cannot be produced on demand: `claude_result_is_error` reproduces a turn that hit an expired sign-in. Only the 22 OpenCode headers carry a capture date, though the fixture rules ask for "protocol metadata, provider version, model, cwd policy, and capture timestamp" (`testing-strategy.md:186-194`).

## 3. How a recording is made

| Protocol | Command, from `apps/server` | What it drives | Needs |
| --- | --- | --- | --- |
| Codex app-server | `record:codex-replay`, i.e. `bun scripts/record-codex-app-server-replay-fixture.ts --scenario <name>` (or `all`) | The real `codex app-server` (`T3_CODEX_BIN`, `CODEX_BIN` or `codex` on `PATH`) through T3's real Codex client, with scripted turns | Bun; Codex installed and signed in (the recording shows `account/updated` with `authMode: "chatgpt"`) |
| Claude Agent SDK | `record:claude-replay`, i.e. `bun scripts/record-claude-agent-sdk-replay-fixture.ts --scenario <name>` | The SDK's `query()`, preferring the installed `claude` on `PATH` | Bun; Claude Code installed and signed in |
| Cursor Agent SDK | `record:cursor-replay` | The Cursor SDK | `CURSOR_API_KEY` |
| Pi RPC | `record:pi-replay` | T3's orchestrator and Pi adapter against the live `pi` (`T3_PI_BIN`) | Pi with its model provider configured |
| Grok ACP | `record:grok-replay` | T3's orchestrator and Grok adapter against the live `grok` (`T3_GROK_BIN`) | Grok installed and signed in |
| Muse MSP | `record:muse-replay` | T3's orchestrator and Muse adapter against the live `muse` (`T3_MUSE_BIN`) | Muse installed |

Sources: `apps/server/package.json:24-29`; `apps/server/scripts/record-codex-app-server-replay-fixture.ts:1231-1253`; `ClaudeAdapterV2.testkit.ts:1502-1533`; `apps/server/scripts/record-cursor-agent-sdk-replay-fixture.ts:148,216-218`; `apps/server/scripts/record-pi-rpc-replay-fixture.ts:60`; `record-grok-acp-replay-fixture.ts:415`; `apps/server/scripts/record-muse-msp-replay-fixture.ts:59`. No OpenCode recorder is in the repository: OpenCode headers name an "opencode2-spike" recorder, "oc2-8 live recording" or an "authenticated-opencode-sdk-probe" (Not found). Each recorder relies on the provider's own sign-in; none signs in itself (Inference from what each spawns).

- **Protocol-level recorders: Codex, Claude and Cursor (Source).** The script drives the provider directly with scripted turns, but builds requests with the adapter's own builders so the frames match what T3 sends. The Codex recorder says "Match the V2 adapter's initialize, thread and turn frames so recordings replay against it without hand edits" (`record-codex-app-server-replay-fixture.ts:71-77`). Claude uses `ClaudeAdapterV2.makeClaudeQueryOptions` and `makeClaudeUserMessage` (`ClaudeAdapterV2.testkit.ts:1583-1655`); Cursor uses `makeCursorAgentOptions` (`apps/server/src/orchestration-v2/Adapters/CursorAdapterV2.testkit.ts:702-714`). The Codex client's logging hook records each outgoing payload as `expect_outbound` and each incoming one as `emit_inbound` (`record-codex-app-server-replay-fixture.ts:1171-1229`). The recorder accepts every approval and answers each question with its first option (lines 1271-1324).
- **Orchestrator-level recorders: Pi, Grok and Muse (Source).** The script runs the scenario's own `input.ts` through T3's real orchestrator and adapter against the live agent, and taps the wire: Pi through a recording process spawner (`apps/server/src/orchestration-v2/Adapters/PiAdapterV2.testkit.ts:437-479`), Grok through a wire tee (`record-grok-acp-replay-fixture.ts:414-497`).
  - Pi and Muse then replay the normalised recording through the scenario's assertions and write it only if they pass: "A recording that fails them never replaces the existing fixture" (`record-pi-rpc-replay-fixture.ts:298-320`; `record-muse-msp-replay-fixture.ts:276-294`).
  - Grok writes first, then prints any assertion failure from the live run (`record-grok-acp-replay-fixture.ts:544-562`).
  - Pi runs hermetically, with `--no-extensions --no-skills --no-prompt-templates --no-context-files --approve` and a temporary session directory, so the user's own setup stays out (`record-pi-rpc-replay-fixture.ts:32-37,219`).
- **Output (Source).** Every recorder writes over the checked-in recording unless given `--out`. Cursor's flag reads "Write the transcript here instead of over the checked-in fixture" (`record-cursor-agent-sdk-replay-fixture.ts:209-212`; also `apps/server/scripts/record-claude-agent-sdk-replay-fixture.ts:384-398`, `record-codex-app-server-replay-fixture.ts:202-207,1649-1669`, `record-pi-rpc-replay-fixture.ts:209`, `record-grok-acp-replay-fixture.ts:544`).
- **Workspace (Source).** Recorders and replay share `checkpointWorkspace`: a temporary Git repository with a committed `README.md` plus the scenario's `workspaceFiles` (`packages/provider-testing/src/replayWorkspace.ts:44-77`). The Claude recorder checks before and after a denied write that the file is absent, and stores the evidence as `verifiedAbsentWorkspacePaths` (`record-claude-agent-sdk-replay-fixture.ts:479-584`).
- **Where recorders live (Documented).** "Provider transcript recorders live with the server orchestration testkit, not with provider client packages" (`testing-strategy.md:153-156`). "A new protocol usually needs its own recorder" (`adding-a-provider.md:56-58`).

## 4. How replay drives an adapter

- **Harness (Source).** Each provider's `*AdapterV2.testkit.ts` exports an `OrchestratorV2ProviderReplayHarness`: a driver kind, a transcript decoder and `makeProviderAdapterRegistryLayer(transcript, {replayGate})` (`apps/server/src/orchestration-v2/testkit/ProviderReplayHarness.ts:165-181`; for example `CodexOrchestratorReplayHarness`, `apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.testkit.ts:240-278`).
- **Runtime (Source).** `runOrchestratorV2ProviderReplayScenario` builds the production services around that registry: orchestrator, event sink and stores, provider session manager and event ingestor, run execution, checkpoint services on the real Git driver, and the effect worker as a daemon (`ProviderReplayHarness.ts:183-226,257-549`). SQLite is in memory by default (line 292). Stand-ins are few: a provider auth service that handles no prompt commands (399-401), a no-op thread-title regeneration (439-444), MCP configuration switched off and an empty MCP app context (360-362, 382), and two small testkit layers (370, 512).
- **One test (Source).** For each scenario and provider, `OrchestratorReplayFixtures.integration.test.ts` (`apps/server/src/orchestration-v2/testkit/`, lines 89-173):
  1. reads the NDJSON, optionally transforms it, and appends T3's runtime instructions for Cursor, Grok and the ACP Registry (`testkit/ReplayRuntimeInstructions.ts:5-69`);
  2. creates the temporary Git workspace and fills `<workspace>` (Codex, Muse);
  3. decodes the transcript with the provider's schema and turns the scenario's steps into commands with deterministic ids;
  4. runs on the test clock with seeded randomness;
  5. calls the variant's assertions, then common checks: no streaming assistant artefacts persisted, the expected model selection, and a ready thread-start checkpoint.

  `it.effect.each` covers every scenario and provider pair (lines 234-247). Extra cases reuse recordings with edited frames to reach states a provider cannot produce on demand, such as an undecodable event (lines 265-508).
- **Scenario runner (Source).** Steps are `dispatch`, `advance_clock`, `await…`, `respond_to_next_runtime_request`, `release_replay_gate` and `finish_held_run` (`testkit/OrchestratorScenario.ts:30-100`). Waiting steps re-read the projection between event-loop turns, for up to 10,000 attempts and a 60-second deadline (lines 217-225). The result holds the stored and domain events, the projections and shell snapshots (lines 109-117).
- **Gates (Source).** `makeProviderReplayGate` holds a labelled inbound frame until a step releases it, so races such as steering a running turn can be set up exactly. It also records when an adapter arms a finish debounce, so `finish_held_run` advances the test clock by exactly that amount (`packages/provider-testing/src/replayGate.ts:3-117`; `OrchestratorScenario.ts:562-615`).
- **Seams (Source):**

| Provider | Replay replaces | Where |
| --- | --- | --- |
| Codex | The app-server's stdio: a fake `Stdio` under T3's real JSON-RPC client | `packages/effect-codex-app-server/src/replay.ts:392-558` |
| Claude | `ClaudeAgentSdkQueryRunner`, the adapter's wrapper around the SDK's `query()`. A recorded `permission.request` calls the adapter's real `canUseTool`, and its answer is checked as the next outbound frame | `ClaudeAdapterV2.testkit.ts:487-886`, especially 550-591 |
| Cursor | The Cursor Agent SDK runner | `CursorAdapterV2.testkit.ts:214` |
| OpenCode 1 | The SDK client | `apps/server/src/orchestration-v2/Adapters/OpenCodeAdapterV2.testkit.ts:337` |
| OpenCode 2 | Effect's `HttpClient`: requests become logical operations and the SSE stream is synthesised | `apps/server/src/orchestration-v2/Adapters/OpenCode2AdapterV2.testkit.ts:140-230` |
| Grok, ACP Registry | A real child process, `node acp-replay-agent.ts`, spawned by T3's real ACP session runtime | `apps/server/src/orchestration-v2/Adapters/AcpAdapterV2.testkit.ts:178-240`; `apps/server/scripts/acp-replay-agent.ts` |
| Pi | Effect's `ChildProcessSpawner`, returning a fake process | `PiAdapterV2.testkit.ts:341-368` |
| Muse | The adapter's `createHost` hook | `apps/server/src/orchestration-v2/Adapters/MuseAdapterV2.testkit.ts:393-412` |

  For Claude, this "does not test the SDK's own subprocess or transport parser" (Documented, `testing-strategy.md:137-140`).
- **Matching (Source).** Outbound frames must arrive in recorded order and are compared as key-sorted JSON after normalising. A mismatch, an unexpected outbound frame or running out of entries fails the replay (`replay.ts:456-506`; `ClaudeAdapterV2.testkit.ts:708-755`).
  - Codex ignores `clientInfo.version` and developer instructions. It treats `approvalPolicy: "never"` and `sandboxPolicy: dangerFullAccess` as defaults, and ignores `cwd`, `model`, `mcp_servers` and recorder-only config keys in `thread/start`, `thread/resume` and `thread/fork` (`replay.ts:180-284`).
  - Claude maps recorded prompt UUIDs to the replayed ones (`ClaudeAdapterV2.testkit.ts:657-706`).
  - ACP accepts `<any>` and expands `<workspace>` (`acp-replay-agent.ts:86-123`).
- **Completeness (Source).** Claude, Cursor, ACP, Pi, Muse and OpenCode 2 fail if entries remain unused at the end (`ClaudeAdapterV2.testkit.ts:872-884`; `CursorAdapterV2.testkit.ts:473-505`; `AcpAdapterV2.testkit.ts:111-150`; `PiAdapterV2.testkit.ts:430`; `MuseAdapterV2.testkit.ts:285-291,489`; `OpenCode2AdapterV2.testkit.ts:196-200`). Codex defines `CodexAppServerReplayIncompleteError` (`replay.ts:115-126`), but nothing raises it (Not found), so a Codex replay does not check that the whole recording was used.
- **No side effects (Source).** Replay runs no tools and writes no project files. A recorded write appears as a `file_change` or `command_execution` turn item, and assertions check the item and the content it carries, not the disk (`fixtures/tool_call_read_only_on_request/output.ts:43-62`). For Claude's foreground Bash, the testkit writes the recorded output to the task files the adapter tails (`ClaudeAdapterV2.testkit.ts:997-1041`). Denied writes are checked with `expectedAbsentWorkspacePaths` (`OrchestratorReplayFixtures.integration.test.ts:139-151`).
- **Restart and recovery (Source).** Restart tests keep SQLite in a file in a temporary directory and run the scenario twice, the second time with startup recovery (`testkit/OrchestratorReplayRecovery.integration.test.ts:181-202,545-561`). The strategy calls for this: tear down and recreate the outer layer against durable persistence, with no restart-only methods (`testing-strategy.md:105`).
- **Checks on the recordings themselves (Source).** A contract test checks unique names, provider and scenario metadata, decodable commands, gate labels that exist, and that every Codex recording starts with `initialize` and ends with `runtime_exit success` (`testkit/OrchestratorReplayFixtures.contract.test.ts:22-155`). Another fails if a Claude recording uses a tool that T3's native tool table does not know (`testkit/ClaudeReplayFixtures.integration.test.ts:198-223`).

## 5. How recordings are kept current

- **Re-running a recorder (Source).** It overwrites the committed file (§3). Nothing schedules this: no workflow in `.github/workflows/` runs a recorder or installs a provider (Not found).
- **Editing expected frames in place (History).** When T3 changes what it sends, the recordings' `expect_outbound` frames are edited. Commit `90ca6a775` (2026-10-14, "new Codex threads no longer miss slow MCP servers' tools") added `mcp_optional_startup_grace_ms` to the `thread/start` frame, one line in each of 30 Codex recordings.
- **Tolerating drift in the replayer (Source).** Codex fills in fields newer app-server versions added, such as `sessionId`, `projectId`, `startedAtMs`, `completedAtMs` and `isBlocking`, so older recordings still decode (`replay.ts:286-344`). It also ignores values that vary by version or machine (§4).
- **Hand-porting (Source).** Newer provider behaviour is sometimes spliced into an older recording: the four Claude recordings with header version `0.3.276` are "hand-ported" from a live Claude Code 2.1.285 capture or assembled from a real thread (§2).
- **Recording with the feature (History).** Commit `a5d97921f` (2026-10-15, "command output streams live while it runs") changed both the Codex and Claude recorders and added new recordings with the feature.
- **Signals of drift (Source, Documented).** The contract and tool-table tests above, gated live tests against real binaries (§11), and contributors' live runs: live testing "regularly finds what those guesses missed" (`adding-a-provider.md:64-66`).
- **Gaps (Source).**
  - The Claude recorder writes the literal version `"0.2.111"` (`ClaudeAdapterV2.testkit.ts:2839`), while the server depends on `@anthropic-ai/claude-agent-sdk` `^0.3.276` (`apps/server/package.json:32`).
  - Other recorders take the version from the provider: Codex from the `userAgent` (`record-codex-app-server-replay-fixture.ts:284-295`), Pi from `pi --version` (`record-pi-rpc-replay-fixture.ts:200-203`). Grok stores `grokVersion` in its metadata but writes `1` as the header version (`record-grok-acp-replay-fixture.ts:517-528`).
  - Nothing records when a recording was last checked against its provider (Not found).

## 6. Server and orchestration tests

- **Runner (Source).** `vp` is the command-line tool of Vite+ (`vite-plus`, root `package.json:61`). `vp test` runs Vitest: CI notes that `vp run … test -- <files>` "does not forward positional args to vitest" (`.github/workflows/windows-tests.yml:67-68`), and the server's shard sequencer extends Vitest's `BaseSequencer` (`apps/server/src/testUtils/weightedShardSequencer.ts:1-5`). Tests import from `vite-plus/test` and `@effect/vitest`. `vp run test` runs every workspace's `test` script (root `package.json:34`).
- **Configuration (Source).** The root config uses the Node environment, 60-second timeouts and excludes `.repos`, `.t3` and build output (`vite.config.ts:55-72`). The server runs files strictly one at a time, "Running files in parallel introduces load-sensitive flakes", with 120-second timeouts, a Git configuration setup file and a weighted shard sequencer (`apps/server/vite.config.ts:114-123`). The sequencer splits files across `--shard` runs by recorded durations (`weightedShardSequencer.ts:14-44`), refreshed with `apps/server/scripts/update-test-shard-weights.ts`.
- **Scale (Source).** 440 test files in `apps/server`, 136 in `packages/client-runtime`, 95 in `packages/shared`, 39 in `packages/contracts`, 21 in `packages/provider-core` and 2 in `packages/provider-testing`.
- **`@t3tools/provider-testing` beyond replay (Source).** Provider packages are tested through it rather than through `apps/server` (`adding-a-provider.md:116-118`).
  - `TestProviderHost.layer` is a `ProviderHost` with temporary directories, in-memory settings and an in-memory credential map (`packages/provider-testing/src/TestProviderHost.ts:23-78`).
  - `writeFakeCli` writes a fake provider executable: a Node script behind a `#!/bin/sh` launcher, or behind a `.cmd` shim on Windows (`packages/provider-testing/src/fakeCli.ts:15-56`). It stands in for real binaries in status, driver and text-generation tests, such as a fake `codex` in `apps/server/src/textGeneration/CodexTextGeneration.test.ts:63`.
- **Other substitutes (Source).** Detection and driver tests replace Effect's `ChildProcessSpawner` with scripted spawners (`apps/server/src/provider/Drivers/CodexDriver.test.ts:93-98,523-558`). Hand-written peers also exist: an ACP mock agent (`apps/server/scripts/acp-mock-agent.ts`, used by `AcpAdapterV2.test.ts`), a Codex mock peer (`packages/effect-codex-app-server/test/fixtures/codex-app-server-mock-peer.ts`), and 214 inline transcript entries in `CodexAdapterV2.test.ts` driving the replay driver.
- **Other integration tests (Source).** Chromium tests cover T3's server-side browser preview (`apps/server/src/preview/*.test.ts`), for which CI installs a headless Chromium shell (`.github/workflows/ci.yml:314-338`). There is also the transfer-budget test (§9).

## 7. The web client and client runtime

- **Web (Source).** One Vitest project, `unit`, runs `src/**/*.test.{ts,tsx}` with 15-second timeouts in the root's Node environment (`apps/web/vite.config.ts:68-77,250-252`; `apps/web/package.json:12`). There are 502 test files, 132 of them `.tsx`. 24 opt into jsdom with `// @vitest-environment jsdom`, 23 import `react-dom/client`, and 32 render to static markup with `react-dom/server`, a pattern `AGENTS.md:99` discourages for new tests.
- **Client runtime (Source).** `packages/client-runtime`, the state and connection logic shared by web and mobile, runs `src/**/*.test.ts` in Node (`packages/client-runtime/vite.config.ts:4-9`).
- **No automated browser tests (Not found).** No browser or end-to-end project exists for the web UI. Browser checks are agent-driven passes through T3's own Browser panel against an isolated development server, done on request (`.agents/skills/test-t3-app/SKILL.md:1-41`; `AGENTS.md:103`).

## 8. Desktop and release smoke tests

- **Desktop tests (Source).** `apps/desktop` has 118 test files, run with `vp test run --passWithNoTests` and 15-second timeouts (`apps/desktop/package.json:11`; `apps/desktop/vite.config.ts:143-147`). They run in CI's Test job after the Electron runtime is installed (`ci.yml:219-248`). CI also builds the desktop pipeline and checks the preload bundle (`ci.yml:157-164`).
- **Smoke test (Source).** `vp run test:desktop-smoke` runs `node apps/desktop/scripts/smoke-test.mjs` (root `package.json:37`; `apps/desktop/package.json:12`). It launches the built `dist-electron/boot.cjs` in Electron and kills it after 8 seconds. It fails if the output contains "Cannot find module", "MODULE_NOT_FOUND", "Refused to execute", or an uncaught `Error`, `TypeError` or `ReferenceError` (`apps/desktop/scripts/smoke-test.mjs:8-55`). It needs a prior build, uses no provider and does not touch the interface. No workflow at `2577baf` runs it (Not found).
- **Release smoke tests (Source).** CI's Release Smoke job runs `scripts/release-smoke.ts`, which exercises release-only steps against copied manifests (`ci.yml:444-466`). For each command-line archive, the release workflow runs `scripts/smoke-cli-archive.ts`: `--version` must match, and `t3 serve`, with an empty `PATH` and a scratch home, must answer HTTP 200 within 30 seconds (`.github/workflows/release-desktop.yml:577-580`; `scripts/smoke-cli-archive.ts:113-174`). Archives are "built, signed, and smoke-tested on hardware of its own architecture": macOS arm64, Linux x64 and arm64, Windows x64 and arm64 (`docs/operations/release.md:45`; runners in `.github/workflows/release.yml:550-684`). This is the only automated check that runs on macOS or Windows; it covers the server, not the desktop app (Source).

## 9. Performance tests

- **Budgets in ordinary tests (Source).** For example, `ThreadTransportPerformance.test.ts` pins snapshot and command-event sizes, such as `MAX_PROJECTED_BOUNDED_SNAPSHOT_RPC_JSON_BYTES = 131_072` (`apps/server/src/orchestration-v2/ThreadTransportPerformance.test.ts:30-35`). These run in CI with the rest of the suite.
- **Focused command (Source, Documented).** `vp run test:perf:v2-wire` runs a named list of 18 such files across server, contracts and client runtime (root `package.json:35`). `docs/internals/performance-regressions.md:1-60` explains the invariants they pin: "Payload budgets belong in these tests so regressions fail locally."
- **Transfer budget (Source).** `apps/server/integration/transferBudgetV2.integration.test.ts` measures real local HTTP and WebSocket transfers and SQL statements over a synthetic thread, and fails on any budget violation (line 357). CI adds its report to the job summary and uploads the result (`ci.yml:340-377`). `.github/workflows/thread-transfer-report.yml` then comments on the pull request, comparing it with `main` (lines 1-75).
- **Gated benchmark (Source).** `apps/server/src/orchestration-v2/ProviderRuntimeRecoveryPerformance.test.ts` always runs one small recovery measurement and runs a scaling sweep only with `T3_BENCH_RECOVERY=1` (lines 481-500).
- **Bench files (Not found).** `apps/web/src/performance.bench.ts` and `packages/client-runtime/src/remotePerformance.bench.ts` match no test `include` pattern, and nothing refers to them, so they are run by hand if at all.

## 10. What CI runs

`.github/workflows/ci.yml` runs on pull requests and pushes to `main` (lines 3-7), on Linux runners except one macOS job. It references no secrets (Not found).

| Job | Runs | Lines |
| --- | --- | --- |
| Changes | Maps changed files to affected packages. Pushes to `main` run everything, and detection fails open | 23-55 |
| Lint | `vp check`, `knip:check` and the generated GraphQL check | 61-97 |
| Build and Typecheck | `vp run build:desktop`, the preload bundle check and `vpr typecheck` | 99-172 |
| Test | Every workspace's `test` except server and web, in parallel | 180-248 |
| Test Web | `vp run --filter @t3tools/web test` | 252-272 |
| Test Server 1–8 | `vp run --filter t3 test --shard n/8`, with Chromium and the transfer report | 282-377 |
| Rust | `cargo fmt` and `cargo test` for three native crates | 381-412 |
| Mobile Native Static Analysis | macOS, `vp run lint:mobile`, only for native mobile changes | 414-442 |
| Release Smoke | `node scripts/release-smoke.ts` | 444-466 |
| Check | Passes only if every job passed or was rightly skipped; required by branch protection | 473-513 |

- **Windows (Source).** "Manual only: nothing in the suite passes on Windows yet" (`.github/workflows/windows-tests.yml:1-21`).
- **Release (Source).** The release workflow runs `vp check`, typecheck, the non-server tests and three server shards before publishing (`.github/workflows/release.yml:259-337`).
- **Others (Not found).** No other workflow installs a provider or uses provider credentials.

## 11. Real providers or offline

| Needs a real, installed and signed-in provider | Gate | Source |
| --- | --- | --- |
| The six recorders (Codex, Claude, Cursor, Pi, Grok, Muse) | Run by hand | `apps/server/package.json:24-29` |
| `apps/server/src/orchestration-v2/CursorOrchestratorV2.live.test.ts` | `T3_CURSOR_LIVE_ORCHESTRATOR=1` | line 149 |
| `apps/server/src/orchestration-v2/GrokOrchestratorV2.live.test.ts` | `T3_GROK_LIVE_ORCHESTRATOR=1` | line 146 |
| `apps/server/src/orchestration-v2/AcpRegistryOrchestratorV2.live.test.ts` | `T3_ACP_REGISTRY_LIVE_ORCHESTRATOR=1` or `T3_ACP_ANTIGRAVITY_LIVE=1` | lines 52-56, 164 |
| `apps/server/src/orchestration-v2/OpenCode2OrchestratorV2.live.test.ts` | `OPENCODE2_BIN` and `OPENCODE2_LIVE_ROOT` | lines 58-59, 302 |
| `packages/provider-opencode/src/server/v2/OpenCode2Client.live.test.ts`, `OpenCode2Server.live.test.ts` | `OPENCODE2_BIN` | lines 21 and 69; lines 25 and 78 |
| `packages/provider-grok/src/server/acpCliProbe.test.ts` | `T3_GROK_ACP_PROBE=1`; a full turn also needs `T3_GROK_LIVE_TURN=1` | lines 19, 60 |
| `apps/server/scripts/verify-background-live.ts` | By hand. It "uses real provider CLI credentials and consumes model usage", starting the production server in a fresh home; Claude by default | `docs/operations/background-verification.md:1-34`; script lines 28-37 |
| `packages/effect-codex-app-server/test/examples/codex-app-server-probe.ts` | By hand, through the package's `probe` script | `packages/effect-codex-app-server/package.json:35` |

- **No live test for Codex or Claude (Not found).** Their coverage is the replays, fake executables, the background verifier and recorder runs.
- **Everything else runs without a provider (Source).** That covers the replay fixtures, adapter unit tests, fake-executable and fake-spawner tests, contracts, web, client runtime, desktop and performance tests. CI provides no provider and no secrets (§10).

## 12. What this means for Playstead (Inference)

### For the Architecture document (#7)

- **Follow the shape.** Test through real orchestration, persistence and projections, replacing only the provider transport, clock, randomness, processes and filesystem. Use Effect's `TestClock`, seeded `Random` and `@effect/vitest`'s `it.effect`.
- **A small testing package like `provider-testing`,** with transcript reading, gates, temporary Git workspaces, fake executables and a test provider host. Replay drivers sit with each protocol's client, as Codex's sits in `packages/effect-codex-app-server/src/replay.ts`. Recorders and scenario fixtures sit in the server.
- **Playstead's own recordings.** Copying T3's recordings would break the rule against copying T3 Code, and their outbound frames carry T3's identity (for example `clientInfo` "T3 Code" in Codex's `initialize`), so they would not match what Playstead sends. That means one recorder per protocol Playstead enables first: Codex app-server and the Claude Agent SDK.
- **Close T3's gaps.** Check that a Codex replay used the whole recording; write the real provider version and a capture date into every header; note when each recording was last checked against its provider.
- **Run replays where Playstead ships.** Run them on macOS and Windows as well as Linux, since the first slice targets both, while T3's CI tests only on Linux and its Windows lane does not pass. Keep live tests opt-in and out of CI. Re-recording could be a periodic manual task, perhaps alongside the weekly T3 Code review.

### For the First working slice (#8)

- **Checkable offline, against a recording.** "In a thread, the person chats with a provider, which creates a simple text file." Record this once for each default provider, Codex and Claude, in Full access. Replay it through Playstead's real server in CI and assert:
  - one completed run, with the user and assistant messages;
  - a completed `file_change` item naming the file and carrying its content;
  - the turn's checkpoint;
  - that the recording was fully used.
- **Not provable by replay:**
  - **The file on disk and a non-empty checkpoint diff.** Replay writes nothing, unless Playstead's harness applies recorded file changes, which T3's does not.
  - **"Finds the providers installed on the machine."** T3 tests detection with fake executables and scripted spawners, not recordings.
  - **Opening an empty directory and T3 Code's "Initialize Git".** T3's replay workspace always starts as a Git repository with a committed README (`replayWorkspace.ts:44-65`), so this path needs its own setup.
  - **Sign-in and current provider behaviour.** These need a live run with real, signed-in Codex and Claude.
  - **The desktop app, its name, icons and interface on macOS and Windows.** T3 has no automated interface test; its smoke test only boots Electron and watches for fatal errors.
- **Acceptance could therefore combine** replay tests in CI on macOS and Windows; fake-executable tests for provider discovery; a smoke boot of the packaged app on each platform; and one manual live run per platform with each default provider.

## Limits and unconfirmed points

- **Nothing was run.** Counts come from `git grep` and `git ls-tree` at `2577baf`. Whether every test passes there is unconfirmed.
- **Partly read testkits.** The Cursor, OpenCode 1 and Muse replay boundaries are described from their testkits' structure and the strategy document; those files were not read in full.
- **Sign-in needs are inferred.** The sign-in each recorder needs comes from what it spawns and from recorded frames. The scripts do not check sign-in themselves.
- **OpenCode's recorder is unknown.** How the OpenCode recordings were made was not found: their headers name a spike recorder outside the repository.
- **Bench files.** That they are run by hand is inferred from the absence of any reference to them.
- **Plan versus inventory.** The strategy's "First Ten Integration Tests" (`testing-strategy.md:169-184`) is a plan, not an inventory. Scenario names such as `approval_request` and `steering_restart_fallback` have no folder; approvals are covered by the `tool_call_*` scenarios.
- **Polling despite the rule.** `AGENTS.md` says tests must not wait on sleeps or polling, yet the scenario runner polls projections between event-loop turns with an attempt budget and a 60-second deadline (`OrchestratorScenario.ts:217-225`). This records how it is; it is not a recommendation.
