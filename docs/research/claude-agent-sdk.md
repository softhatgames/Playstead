# Claude Agent SDK for a host-backed conversation

- **Question:** Can Playstead's host run real Claude conversations through the Claude Agent SDK, behind the existing provider boundary? What do versioning, process model, authentication and terms, separation from personal setup, sessions and resumption, events, permissions and sandboxing, resource controls, skills and Windows support mean for the first host-backed Claude conversation?
- **Date:** 2026-10-14. All sources were accessed on this date.
- **Versions examined:**
  - [`@anthropic-ai/claude-agent-sdk@0.3.300`][npm] (npm `latest`, published 2026-10-14T14:28Z). Its per-platform binary `@anthropic-ai/claude-agent-sdk-darwin-arm64@0.3.300` is Claude Code 2.1.300, built 2026-10-14T13:29Z.
  - `0.3.292` (published 2026-10-06), the SDK that bundles Claude Code 2.1.292, which is the Claude Code `stable` tag on npm. Older SDK versions 0.1.77, 0.2.50, 0.2.113 and 0.3.200 were read only for the history of defaults.
  - The SDK [changelog][changelog] at tag `v0.3.300`. It is not in the npm tarball.
  - The docs carry no version or update date. Many statements are tied to a Claude Code version (v2.1.2xx); the highest mentioned is SDK 0.3.296 / Claude Code 2.1.296. Help Center articles carry modification dates, given where cited.
- **Agent SDK docs:** [Overview][ov], [Quickstart][qs], [TypeScript reference][ts], [Migration guide][mig], [Streaming input][svs], [Agent loop][loop], [Sessions][sess], [Session storage][store], [Permissions][perm], [User input and approvals][ui], [Hooks][hooks-sdk], [Streaming output][stream], [Cost tracking][cost], [Configuration][cfg], [Claude Code features][ccf], [System prompts][sys], [Skills][skills-sdk], [Plugins][plugins], [MCP][mcp], [Hosting][host], [Secure deployment][secdep], [File checkpointing][ckpt], [Troubleshooting][trouble], [V2 preview (removed)][v2]. The older `docs.claude.com`, `platform.claude.com` and `docs.anthropic.com` SDK URLs redirect to `code.claude.com`.
- **Claude Code docs:** [Legal and compliance][legal], [Authentication][auth], [Settings][settings], [Settings reference][setref], [Environment variables][env], [Managed settings][managed], [Server-managed settings][srvmanaged], [Memory][memory], [Skills][ccskills], [Hooks][cchooks], [Permissions][ccperm], [Permission modes][modes], [Sandboxing][sbx], [Setup][setup], [Data usage][data], [Sessions][ccsess], [The `.claude` directory][claudedir], [Costs][costs], [Model configuration][model], [CLI reference][cli], [Status line][statusline], [Tools reference][toolsref].
- **Help Center and terms:** [Agent SDK with your Claude plan][hc-sdkplan] (modified 2026-10-07), [Log in to your Claude account][hc-login] (2026-05-19), [Monthly API credits for Max and Team][hc-credits] (2026-10-07), [Claude Code with Pro or Max][hc-promax] (2026-10-14), [API key environment variables][hc-apikey] (2026-05-05), [Fable models on your plan][hc-fable] (2026-09-02), [API credits for subscribers][api-credits], [Consumer Terms][consumer] (effective 2025-10-08), [Commercial Terms][commercial] (effective 2025-06-17), [Usage Policy][aup].
- **Local evidence:**
  - The 0.3.300 tarball and its darwin-arm64 binary, unpacked and read: `sdk.d.ts`, `sdk-tools.d.ts`, minified `sdk.mjs` (cited as `line:column`) and `strings` of the binary (cited by byte offset).
  - The bundled CLI's `--version`, `--help`, `auth --help` and `auth status --json`.
  - A `query()` whose prompt never yields, used to call `initializationResult()`, `supportedModels()`, `supportedCommands()`, `supportedAgents()`, `accountInfo()` and `mcpServerStatus()`, then `close()`, `abort()` or `kill -9`.
  - Every run used `env -i` with `HOME`, `CLAUDE_CONFIG_DIR`, `PLAYSTEAD_HOME` and `TMPDIR` in a throwaway folder under `/tmp`, on macOS (arm64). There were no credentials, no prompt was sent and no model was called.
- **Reference only:** [pingdotgg/t3code][t3] at commit `bf8ffe8` (main, 2026-10-14T18:14Z). This is not authoritative.

Labels used below: **Documented** (official docs, Help Center or terms), **Source** (the published package at 0.3.300: type definitions, `sdk.mjs` or binary strings), **Observed** (local runs described above), **Inference** (my reasoning) and **Unconfirmed** (not established).

## Summary for Playstead

- **Integration surface.** The TypeScript Agent SDK is Anthropic's documented surface for "embed[ding] Claude Code's agent in your own Python or TypeScript application, in a process you operate". `claude -p --output-format json` is offered for other languages ([ov]). Streaming input, where the prompt is an `AsyncIterable`, is "the **preferred** way"; interrupts, model and permission-mode changes work only in that mode ([svs], [ts]). The older V2 session API was removed in 0.3.142 ([v2]). Unlike Codex App Server, nothing in the SDK is labelled experimental as a whole; individual pieces are `@alpha`.
- **Pin one exact version.** The SDK released 56 versions in the 60 days to 2026-10-14, almost every working day (Observed, npm). SDK `0.3.N` bundles Claude Code `2.1.N` (Source, `package.json` `claudeCodeVersion`), and "updating the SDK is how you update the CLI" ([host]). Defaults change between patch releases: 0.3.286 made an omitted `permissionMode` start in `auto` ([changelog]). The init message reports `claude_code_version` and a `capabilities` list for feature detection ([ts]).
- **One process per conversation.** Each `query()` spawns one native Claude Code binary (about 250 MB, from a per-platform optional npm package) and talks to it over stdio. There is no shared process ([host], Source). Closing ends stdin, then SIGTERM after 2 s and SIGKILL after 5 s more; on Windows it waits 7 s and then calls `TerminateProcess`. Only the direct child is signalled (Source). A crash rejects the message loop with "Claude Code process exited with code N" (Source, Observed).
- **Authentication and terms.** The SDK accepts an API key, Bedrock, Vertex, Foundry or Claude Platform on AWS, and technically also a claude.ai login. Anthropic's pages do not agree on whether a third-party app may run on a person's subscription; §3 quotes each. The Agent SDK overview says: "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK" ([ov]). The Help Center says users "can still use the Claude Agent SDK, claude -p, and third-party apps with your subscription limits" ([hc-sdkplan]). This is stricter than OpenAI's position recorded in decision 0008. No page addresses a local open-source host explicitly.
- **Isolation needs several settings together.** `settingSources: []` stops user, project and local settings, CLAUDE.md, skills, hooks and `.mcp.json`. Managed policy, `~/.claude.json`, auto memory and claude.ai connectors still load ([ccf]). `CLAUDE_CONFIG_DIR` moves settings, transcripts, `.claude.json` and the credential store, with a separate macOS Keychain item per folder ([auth], Source). `env` replaces the child's environment rather than merging ([ts]). Admin policy always wins over the host's own `managedSettings` ([managed]).
- **SDK sessions trust the folder.** "`-p` or SDK session: Claude Code never shows the dialog and treats the folder as trusted", so a repository's hooks, `env` block and `.mcp.json` servers run when the `project` source is loaded ([cchooks], [ccperm]). This is the analogue of Codex's folder trust, but Claude has no per-folder trust record to write.
- **Sessions.** The host can choose the session id up front (`sessionId`, a UUID). Transcripts are JSONL under `<config>/projects/<encoded cwd>/<id>.jsonl`, in a format that "is internal to Claude Code and changes between versions" ([ccsess]). `resume`, `resumeSessionAt` and `forkSession` work on the same machine only. A resume that fails ends with an error result or a process exit; the exact SDK behaviour for an unknown id is **unconfirmed**.
- **Events.** Without `includePartialMessages`, assistant text arrives one completed content block at a time. With it, raw API `stream_event` deltas arrive for the main session only. Command output does not stream; `tool_progress` carries only elapsed time ([stream], Source). Each turn ends with exactly one `result` message, carrying usage, an estimated cost and `permission_denials` (Source). There is no native turn id; the host's own message `uuid` is echoed back.
- **Permission requests.** Only calls not settled by hooks, deny rules, ask rules, the mode or allow rules reach `canUseTool`. The order has six steps, and "auto-approved tools never reach `canUseTool`" ([perm]). The answer is `allow` (optionally with changed input or standing rules) or `deny` with a message and optional `interrupt` (Source). These map onto **Allow once**, **Deny** and **Deny and stop**. A request waits indefinitely ("permission prompts don't time out", [ts]). Its `AbortSignal` fires when the CLI cancels it or the query closes (Source).
- **The sandbox is optional and narrow.** It is off by default and covers shell commands only, not file tools, MCP servers or hooks ([sbx]). Reads are allowed across "most of the machine". Network goes through a proxy with an empty allowlist. It runs on macOS, Linux and WSL2. Anthropic's docs say native Windows is not sandboxed, while the 2.1.300 binary contains a gated native Windows sandbox (§11). Through the SDK, `enabled: true` fails closed by default (Source). Nothing reports per command that the sandbox applied.
- **Resource controls.** The host can enforce interrupt and close, denial, `maxTurns` (tool-use turns) and `maxBudgetUsd`. The budget is checked against a client-side estimate that "can pass this value" ([cost]). Cost figures "are client-side estimates, not authoritative billing data". `rate_limit_event` reports subscription limits as they are reached. Enforceable spend caps exist only server-side: Console workspace limits, the usage-credit spend limit or cloud budgets ([costs]).
- **Windows.** Claude Code runs natively. Git for Windows is optional: Git Bash backs the Bash tool, and without it a PowerShell tool is used ([setup]). The SDK spawns with `windowsHide` and no shell, so a `.cmd` shim cannot be launched ([t3-exe]). Process-tree cleanup is left to the caller.

## 1. Status, support and versioning

- **Recommended surface (Documented).**
  - The overview compares four products ([ov]):
    - Agent SDK: "Embed Claude Code's agent in your own Python or TypeScript application, in a process you operate". It is "A library that runs the Claude Code binary, with Claude Code's capabilities, such as built-in tools, permissions, sessions, and hooks."
    - Claude Code CLI: "Do interactive development or run one-off tasks from a terminal".
    - Client SDK: "You write the tool loop yourself".
    - Managed Agents: Anthropic hosts the loop.
  - "To drive the same agent loop from a language other than Python or TypeScript, run the CLI as a subprocess with the `-p` flag and `--output-format json`" ([ov]). The headless page points programmatic users to the SDK ([cli]).
  - **Inference:** for a Node host, the TypeScript SDK is the recommended route. `claude -p --output-format stream-json` is the same binary and protocol without the SDK's process handling, control requests and types (§2).
- **Stability (Documented, Source).**
  - "The SDK follows semver: take patch releases continuously and review the TypeScript or Python changelog before taking a minor" ([host]). Behaviour nevertheless changes in patch releases. 0.3.286 (2026-09-30) "Changed the TypeScript Agent SDK to leave an omitted `permissionMode` to Claude Code, so … on third-party providers or with telemetry off, the session starts in auto mode like `claude -p`; pass `permissionMode: 'default'` for manual approvals" ([changelog]).
  - The V2 session API (`unstable_v2_createSession`, `unstable_v2_resumeSession`, `unstable_v2_prompt`) was removed in 0.3.142 ([v2]).
  - Marked `@alpha` in 0.3.300 (Source, `sdk.d.ts`): `sessionStore`, `sessionStoreFlush`, `loadTimeoutMs`, `taskBudget`, `prewarm`, `resolveSettings`, `filterEscalatingDefaultMode`, `importSessionToStore`, `readMcpResource` and the `USAGE_*_PREFIXES`. `maxThinkingTokens` and `setMaxThinkingTokens()` are deprecated. `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET` says what it is.
  - Some members are blanked out of `sdk.d.ts` but read by `sdk.mjs`: `getOAuthToken`, `getHostAuthToken`, `workload` and `channels` (Source). They are not a public contract.
- **Release cadence (Observed, npm).**
  - The SDK's `latest` and `next` tags both point to 0.3.300. There is no stable tag and no prerelease has ever been published (323 versions).
  - 56 versions were published between 2026-08-15 and 2026-10-14, on 44 distinct days.
  - Claude Code's own npm package has `stable` = 2.1.292 (2026-10-06), "typically about one week old" ([setup]), and `latest` = 2.1.300. The SDK whose bundled CLI matches `stable` is 0.3.292.
- **Runtime and binary (Source, Documented).**
  - The SDK needs Node ≥ 18 (`engines`). Its peer dependencies are `@anthropic-ai/sdk >=0.93.0`, `@modelcontextprotocol/sdk ^1.29.0` and `zod ^4.0.0`; the root entry bundles them. The `/core` entry imports them from the application instead ([ts]).
  - Since 0.2.113 the SDK spawns "a native Claude Code binary (via a per-platform optional dependency) instead of bundled JavaScript" ([changelog]). Packages exist for darwin x64/arm64, linux x64/arm64 (glibc and musl) and win32 x64/arm64. The darwin-arm64 package holds one 249,556,880-byte Mach-O executable (Observed). The binary is built with Bun and needs neither Node nor Bun to run (Source).
  - The SDK finds the binary with `require.resolve('@anthropic-ai/claude-agent-sdk-<platform>-<arch>/claude[.exe]')`, trying musl first on Linux without glibc (Source, `sdk.mjs` 157:116679). An install that omits optional dependencies fails with "Native CLI binary for … not found. Reinstall @anthropic-ai/claude-agent-sdk without --omit=optional, or set options.pathToClaudeCodeExecutable" ([qs], Source).
  - `pathToClaudeCodeExecutable` overrides the binary. `executable` (`node`, `bun` or `deno`) matters only when that path is a `.js`/`.ts` file (Source).
  - `manifest.json` in the SDK tarball records the CLI version, commit, build date and a SHA-256 and size for each platform binary (Source).
- **Pinning (Inference).**
  - Pin the exact SDK version in `package.json`. That pins the bundled binary, because the platform packages are exact-version optional dependencies.
  - Verify at run time from the `initialize` response (`claude_code_version`, added in 0.3.296) or the init message's `claude_code_version`, plus `capabilities`. Both were present in the observed `initializationResult()` (Observed: `claude_code_version: "2.1.300"`, `capabilities: ["ui_surface_v1"]`).
  - The binary's SHA-256 can be checked against the tarball's `manifest.json` (Source).
  - Whether the bundled binary updates itself is **not documented**. The docs say native installations "automatically update in the background", while the SDK's bundled binary "is pinned to the SDK package version" ([setup], [host]). `DISABLE_AUTOUPDATER=1` and `DISABLE_UPDATES=1` exist ([env]).
- **Types as the contract (Inference).** `sdk.d.ts` (10,080 lines) and `sdk-tools.d.ts` define every message, option and tool input and output. There is no JSON Schema generator like Codex's. The docs track the latest release and mention versions inline.

## 2. Process and lifecycle

- **One process per `query()` (Documented, Source).**
  - "When your code calls `query()`, the SDK spawns a separate `claude` CLI process and talks to it over stdio. That subprocess owns the shell, the working directory, and the JSONL session transcripts on local disk." "One agent session maps to one subprocess. Running N concurrent sessions means N subprocesses" ([host]).
  - `spawn(command, args, {cwd, stdio: ["pipe","pipe","pipe"], signal, env, windowsHide: true})`, with no `shell` and no `detached` (Source, `sdk.mjs` 157:~104500).
  - Base flags: `--output-format stream-json --verbose --input-format stream-json`. The other options become `--flag=value` flags; `canUseTool` adds `--permission-prompt-tool=stdio` (Source, 157:104919). Several flags the SDK passes are hidden from `--help`, for example `--max-turns`, `--permission-prompt-tool`, `--thinking` and `--managed-settings` (Observed).
  - `spawnClaudeCodeProcess` lets the host spawn the process itself, for example "in VMs, containers, or remote environments" ([ts]).
  - `startup()` spawns and completes the handshake before a prompt exists. `prewarm()` (`@alpha`) keeps a spare process of "roughly 230 to 260 MB" ([ts]).
  - Sizing guidance is "1 GiB RAM, 5 GiB disk, and 1 CPU per agent", and memory grows with session length ([host]).
- **Driving a conversation (Documented).**
  - With a string prompt, the process exits after one turn. With an `AsyncIterable<SDKUserMessage>` it stays up, and "a streaming input session stays alive, and you can keep sending messages, except after a session crash, which emits a final `error_during_execution` result and exits the process" ([loop]).
  - A message sent while a turn runs takes a `priority`. `'next'` (the default) is read "in the same turn, as soon as the tool calls it is running finish". `'later'` waits for the turn to end. `'now'` "interrupts the turn" ([ts]). `shouldQuery: false` appends without starting a turn.
  - A message carries an optional `uuid`; the result echoes it as `user_message_uuid` ([ts]). "Claude Code echoes a `uuid` only if you set one on the message."
  - The `result` message is "exactly one result message per turn… treat it as the turn-complete signal" (Source, `sdk.d.ts` 5806-5809). A few trailing system events, such as `prompt_suggestion`, can follow it ([loop]).
  - Control requests (`interrupt`, `setModel`, `setPermissionMode`, `applyFlagSettings`, `supportedModels`, `accountInfo` and others) travel on the same stdio as `control_request` and `control_response` messages. The SDK handles them itself (Source). T3 Code notes that "The SDK puts no deadline on control requests" ([t3-ca-mcpdeadline]); this was not checked in the source.
- **Shutdown (Source, Observed).**
  - `Query.close()` runs cleanup callbacks, flushes any session-store mirror, aborts in-flight control-request handlers, closes the transport, closes in-process MCP servers and ends the stream. It then waits up to 2 s for the process (157:121079). Breaking out of `for await` does the same. `Query` implements `Symbol.asyncDispose`.
  - The transport ends stdin and waits 2 s. On POSIX it then sends SIGTERM, then SIGKILL after 5 s more. On Windows there is no SIGTERM: it waits 5 s more, then calls `kill("SIGKILL")`, which is `TerminateProcess` (157:111893). All timers are `unref()`ed.
  - Aborting `options.abortController` closes the transport the same way and rejects the iterator with `AbortError` (157:~108700). "`AbortError` is the only error class in the SDK's typed API" ([ts]).
  - On host exit, a `process.on("exit")` handler sends SIGTERM to every child it spawned; on Windows it ends their stdin instead (157:99658).
  - Observed, with a prompt that never yields:

    | Action                    | Message loop                                              | Child gone after |
    | ------------------------- | --------------------------------------------------------- | ---------------- |
    | `close()`                 | ends without error                                        | ≈ 0.3 s          |
    | `abortController.abort()` | throws `AbortError: Operation aborted`                    | ≈ 0.3 s          |
    | `kill -9` of the child    | throws `Claude Code process terminated by signal SIGKILL` | at once          |

- **Process trees (Source, Unconfirmed).**
  - The SDK contains no `taskkill`, no `detached` spawn and no process-group kill. The child shares the host's process group (Observed). Only the direct child is signalled.
  - Whether the CLI ends its own children (Bash commands, background shells, stdio MCP servers) on stdin EOF or SIGTERM is **unconfirmed**. T3 Code spawns the CLI detached and kills its whole process group, because "plugin MCP server grandchildren survive otherwise" ([t3-ca-spawn]).
  - Background tasks run inside the CLI process: `run_in_background` Bash commands, Monitor and subagents ([ts]). T3 Code says "a new selection would kill them" ([t3-ca-bg]).
- **Crashes (Source, Documented).**
  - An unexpected exit rejects the message loop with `Error("Claude Code process exited with code N. stderr: <tail>")` or "terminated by signal SIG…", keeping the last ~2 KB of stderr (157:110202). "There's no SDK error class to catch" ([trouble]).
  - A crash the CLI catches itself emits a final `error_during_execution` result "whose cost fields may be zeroed and whose `stop_reason` is `null`", then the process exits ([ts], [cost]).
  - Some startup refusals produce an `error_during_execution` result with a `startup_failure_reason`. Others "end with stderr output, a non-zero exit, and no result message" unless `CLAUDE_CODE_STARTUP_FAILURE_RESULTS=1` is set ([ts]).
  - A `kill -9` left a stale `<config>/sessions/<pid>.json` and a socket `/tmp/cc-socks/<pid>.sock` (Observed). Graceful closes removed both.
- **Files outside the configuration folder (Observed, Source).** The CLI creates its messaging socket at `/tmp/cc-socks/<pid>.sock` even when `TMPDIR` points elsewhere; the path matches a hard-coded pattern in the binary.
- **Fit with the provider boundary (Inference).**
  - `ProviderAdapter.start` and `status` assume a provider process. For Claude, a process exists only per session, so `providerStopped` becomes per session.
  - Status needs its own source. Options are `claude auth status --json` from the pinned binary, or a short `query()` whose prompt never yields, read through `initializationResult()` and then closed (§3). T3 Code uses the second ([t3-probe]).

## 3. Authentication and terms

### What the terms say

Anthropic's wording differs between pages. Each is quoted in full where it bears on Playstead.

- **Agent SDK overview ([ov]) and Quickstart ([qs]) (Documented).**

  > "Unless previously approved, Anthropic does not allow third party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Use the API key authentication methods described in the [Quickstart][qs] instead."

  > "Use of the Claude Agent SDK is governed by Anthropic's Commercial Terms of Service, including when you use it to power products and services that you make available to your own customers and end users".

  On branding: "Your product should maintain its own branding and not appear to be Claude Code or any Anthropic product." Allowed names include "Claude Agent" and "{YourAgentName} Powered by Claude"; "Claude Code" and "Claude Code Agent" are not permitted.

- **Claude Code legal and compliance, "Authentication and credential use" ([legal#authentication-and-credential-use]) (Documented).**

  > "**OAuth authentication** is intended exclusively for purchasers of Claude Free, Pro, Max, Team, and Enterprise subscription plans and is designed to support ordinary use of Claude Code and other native Anthropic applications."

  > "**Developers** building products or services that interact with Claude's capabilities, including those using the Agent SDK, should use API key authentication through Claude Console or a supported cloud provider. Anthropic does not permit third-party developers to offer Claude.ai login into their own applications, or to route requests through Free, Pro, or Max plan credentials on behalf of their users. Moreover, developers may not collect, store, or intermediate Claude.ai credentials or session tokens — sign-in to a Claude account must complete through Anthropic's own flow."

  > "This does not restrict how customers provision and manage their own API keys or third-party inference provider credentials … provided the resulting usage is billed to the key owner under their agreement with Anthropic (or the applicable provider) and is not resold or intermediated as described above. Nor does it prevent an end user from signing in to the unmodified Claude Code binary with their own Claude subscription, including where a platform hosts Claude Code as described under _Can customers offer Claude Code in their products?_ above."

  > "Anthropic reserves the right to take measures to enforce these restrictions and may do so without prior notice. For questions about permitted authentication methods for your use case, please contact sales."

  The same page ([legal#can-customers-offer-claude-code-in-their-products]) also says:

  > "**The Claude Code binary must not be modified.** … customers may not remove, disable, or restrict any authentication method built into it (including methods that permit signing in with a Claude account or the user's own API key)."

  > "**Customers may not pay for, resell, or intermediate Claude usage on their end users' behalf.** Each end user must authenticate with their own Anthropic API key, Claude subscription plan credentials, or 3P inference provider credential".

  Its licence section says Claude Code is subject to the Commercial Terms "for Team, Enterprise, and Claude API users", and to the Consumer Terms "for Free, Pro, and Max users". It also says: "Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code and the Agent SDK."

- **Help Center, "Use the Claude Agent SDK with your Claude plan" ([hc-sdkplan], modified 2026-10-07) (Documented).** The article contains only these two notices:

  > "Update October 7, 2026: Claude Max and Team plans now include monthly API credits, which cover the Claude Agent SDK, claude -p, the Claude API, and Claude Managed Agents. You can still use the Claude Agent SDK, claude -p, and third-party apps with your subscription limits."

  > "Update June 15, 2026: We've paused the previously-announced changes to Claude Agent SDK usage. For now, nothing has changed: Claude Agent SDK, claude -p, and third-party app usage still draw from your subscription limits."

- **Help Center, "Log in to your Claude account" ([hc-login], modified 2026-05-19; the legal page links it) (Documented).**

  > "The preferred way to access Anthropic services using third-party software, tools, or services ("third-party tools"), including open-source projects, is through API key authentication through Claude Console or a supported cloud provider. Anthropic may at its discretion allow paid subscribers who have enabled usage credits to use certain third-party tools to access Anthropic services included in paid subscription plans, but reserves the right to draw use of such third-party tools from usage credits rather than subscription limits. … Use of third-party tools that misrepresent their identity to Anthropic's servers, attempt to route third-party traffic against subscription limits, or otherwise violate applicable terms or policies is prohibited and such use may be enforced against."

  > "**Developers.** If you're building a product, application, or tool for others, use API key authentication through Claude Console or a supported cloud provider."

- **Monthly API credits ([hc-credits], modified 2026-10-07) (Documented).** "API credits cover claude -p and the Claude Agent SDK when you run them yourself with an API key from your linked Claude Console organization… When you're signed in with your Claude plan instead, claude -p and Agent SDK usage still draw from your plan's usage limits". The credits are available on Max and Team plans only.
- **Consumer Terms ([consumer], effective 2025-10-08) (Documented, with a limit).** From this location the site served only the EEA and Switzerland version, with Anthropic Ireland as the contracting party. It forbids accessing the services "through automated or non-human means, whether through a bot, script, or otherwise", "Except when you are accessing our Services via an Anthropic API Key or where we otherwise explicitly permit it". It also forbids sharing "Account login information… or Account credentials with anyone else". The rest-of-world text was not read.
- **Commercial Terms ([commercial], effective 2025-06-17) (Documented).** "Anthropic gives Customer permission to use the Services, including to power products and services Customer makes available to its own customers and end users".
- **Usage Policy ([aup]).** The live page shows "Effective November 12, 2026", which is after the access date. The version now in force is linked as "Previous Version" and was not read.
- **Where the pages differ (Inference).**
  - The SDK overview and the legal page tell _developers_ of products, "including those using the Agent SDK", to use API keys. They forbid _offering_ claude.ai login, routing plan credentials "on behalf of their users", and collecting or intermediating claude.ai credentials.
  - The Help Center tells _users_ they can still use "the Claude Agent SDK, claude -p, and third-party apps" with subscription limits. The legal page allows "an end user… signing in to the unmodified Claude Code binary with their own Claude subscription".
  - Playstead is open source, runs on the person's own computer and drives the unmodified binary. The person would sign in through Claude Code's own flow, and Playstead would never see the token. No page says whether that counts as "offering claude.ai login" for a product. The legal page sends such questions to sales. **Unconfirmed**, and this note does not resolve it.
  - Anthropic's position is stricter than OpenAI's. OpenAI says app-server authentication may continue for local or open-source apps ([Codex note §3](codex-app-server.md#3-authentication)). Anthropic names open-source projects among the "third-party tools" for which API keys are "preferred". It does not exempt them.

### Methods and precedence

- **Supported methods for the SDK (Documented).** `ANTHROPIC_API_KEY`; Amazon Bedrock (`CLAUDE_CODE_USE_BEDROCK=1`); Claude Platform on AWS (`CLAUDE_CODE_USE_ANTHROPIC_AWS=1` with `ANTHROPIC_AWS_WORKSPACE_ID`); Google Cloud's Agent Platform (`CLAUDE_CODE_USE_VERTEX=1`); Microsoft Foundry (`CLAUDE_CODE_USE_FOUNDRY=1`) ([qs]). "The SDK reads the key from the environment of the process that runs your agent; it doesn't load `.env` files automatically."
- **claude.ai logins work technically (Documented).** The Authentication page lists "Terminal, VS Code extension, and Agent SDK logins" for `forceLoginOrgUUID` ([auth]). The SDK features page says claude.ai connectors load "when the session authenticates with your claude.ai login" ([ccf]). `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token` is "a one-year OAuth token", "Alternative to `/login` for SDK and automated environments", and "can only make model requests" ([auth], [env]).
- **Precedence (Documented, [auth#authentication-precedence]).**
  1. Cloud provider credentials, when a `CLAUDE_CODE_USE_*` variable is set.
  2. `ANTHROPIC_AUTH_TOKEN`.
  3. `ANTHROPIC_API_KEY`. "In non-interactive mode (`-p`), the key is always used when present."
  4. `apiKeyHelper` output.
  5. `CLAUDE_CODE_OAUTH_TOKEN`.
  6. Anthropic profile and federation credentials.
  7. Subscription OAuth credentials from `/login`.

  "A signed-in Claude apps gateway session sits outside this list… and it outranks them." The Help Center warns that an `ANTHROPIC_API_KEY` in the environment is used instead of the subscription, at API rates ([hc-apikey]). **Inference:** a host that passes its own environment to Claude passes any such key too (§4).

- **Bare mode (Documented).** `--bare` (`CLAUDE_CODE_SIMPLE`) skips hooks, skills, plugins, MCP, auto memory and CLAUDE.md. "OAuth tokens and keychain credentials are not read, so Anthropic authentication must come from `ANTHROPIC_API_KEY` or an `apiKeyHelper` in `--settings`" ([env]).

### Where credentials are stored

- **Documented ([auth#credential-management]).**
  - macOS: "the encrypted macOS Keychain". When the Keychain rejects a write, the login goes to `~/.claude/.credentials.json` with mode `0600`.
  - Linux: `~/.claude/.credentials.json`, mode `0600`.
  - Windows: `%USERPROFILE%\.claude\.credentials.json`, which "inherit[s] the access controls of your user profile directory".
  - "If you've set the `CLAUDE_CONFIG_DIR` environment variable, Claude Code keeps the `.credentials.json` file under that directory instead… and keys the macOS Keychain entry to that directory too, so a session with a different `CLAUDE_CONFIG_DIR` reads a different entry."
  - Exception: "Separate directories don't keep two Claude Console sign-ins without an API key apart, because Claude Code stores that kind of sign-in outside the configuration directory." Anthropic profiles live in `~/.config/anthropic` or `%APPDATA%\Anthropic`.
  - `~/.claude.json` "holds your sign-in session, MCP server configurations, per-project state such as trust decisions" ([settings]).
- **Source (binary 2.1.300, darwin-arm64).**
  - The Keychain service is `Claude Code-credentials`, with `-<first 8 hex digits of SHA-256 of the config folder>` appended when `CLAUDE_CONFIG_DIR` (or `CLAUDE_SECURESTORAGE_CONFIG_DIR`) is set. The account is `$USER`. Access is through the `security` command (@0xbbe2e6e, @0x53e62f8).
  - The plaintext fallback prints "Warning: Storing credentials in plaintext."
  - Windows Credential Manager is used only when `CLAUDE_CODE_FORCE_WINDOWS_CREDMAN=1` or a remote feature flag is on; otherwise the credentials file is used.
  - No `libsecret` use was found for Linux. **Unconfirmed:** the Linux store beyond the documented file.
  - With `CLAUDE_CONFIG_DIR` set, `.claude.json` is written inside that folder rather than at `~/.claude.json` (Observed).
- **Reading sign-in status.**
  - `claude auth status` prints JSON and exits 1 when signed out. `authMethod` is one of `none`, `claude.ai`, `oauth_token`, `api_key`, `api_key_helper` or `third_party`, and `configDirectory` names the folder in use ([cli]). Observed in an empty folder: `{"loggedIn": false, "authMethod": "none", "apiProvider": "firstParty", "analyticsDisabled": false, "projectsDirectory": …, "configDirectory": …}`.
  - `claude auth login` signs in through Anthropic's flow; `--console` selects Console billing ([cli]).
  - In the SDK, `accountInfo()` and the `initialize` response return `AccountInfo {email?, organization?, subscriptionType?, tokenSource?, apiKeySource?, apiProvider?}` (Source). Observed signed out: `{tokenSource: "none", apiProvider: "firstParty"}`.
  - The init message carries `apiKeySource`: `ANTHROPIC_API_KEY`, `apiKeyHelper`, `/login managed key` or `none`. `none` covers "a claude.ai login, a bearer token, or a cloud provider" ([ts]).
  - An `auth_status` message streams progress while the CLI authenticates. An assistant message's `error` can be `authentication_failed`, `oauth_org_not_allowed`, `billing_error` and similar (Source).

## 4. Separation from personal setup

How Claude can run apart from the person's own Claude Code setup: their personal settings and skills, and which folders it trusts.

- **`settingSources` (Documented, Source).**
  - Current default: "When you omit `settingSources`, `query()` reads the same filesystem settings as the Claude Code CLI: user, project, and local settings, CLAUDE.md files, and `.claude/` skills, agents, and commands. To run without these, pass `settingSources: []`" ([ccf]). `sdk.d.ts` agrees: "When omitted, all sources are loaded (matches CLI defaults). Pass `[]` to disable filesystem settings (SDK isolation mode). Must include `'project'` to load CLAUDE.md files." (2264-2273).
  - History: the 0.1.0 changelog said "No filesystem settings by default", and 0.2.50's types said "When omitted or empty, no filesystem settings are loaded". The migration guide says "This default was briefly changed in v0.1.0 to load no filesystem settings and then reverted" ([mig], Source). The SDK passes `--setting-sources` only when the option is set, so the default is the CLI's (Source). Older guidance that the default loads nothing is out of date.
  - What each source loads ([ccf]):
    - `user`: `~/.claude/settings.json`, user CLAUDE.md, `~/.claude/rules/*.md`, and user skills, commands and subagents.
    - `project`: `<cwd>/.claude/settings.json` and its hooks (no parent fallback); CLAUDE.md and `.claude/rules/*.md` in `<cwd>` and every parent; skills, commands and subagents from `<cwd>` up to the repository root; and `.mcp.json` ([mcp]).
    - `local`: `CLAUDE.local.md` and `.claude/settings.local.json`.
  - Precedence: "Local settings > Project settings > User settings. Programmatic options such as `agents`, `allowedTools`, and `settings` override user, project, and local filesystem settings. Managed policy settings take precedence over programmatic options" ([ccf]).
- **What `settingSources: []` does not stop (Documented, [ccf#what-settingsources-does-not-control]).**
  - Managed policy: "Endpoint-managed policy, such as an MDM plist, registry policy, or managed settings file, loads from the host. Server-managed settings are fetched on an eligible configuration when the session authenticates with a qualifying credential". "You can't disable them from the SDK."
  - "`~/.claude.json` global config | Always read | Relocate with `CLAUDE_CONFIG_DIR` in `env`".
  - Auto memory at `~/.claude/projects/<project>/memory/`, disabled with `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` or `autoMemoryEnabled: false`.
  - claude.ai MCP connectors, when signed in with claude.ai. `strictMcpConfig: true` stops them; `mcpServers: {}` does not.
  - "`sandbox.credentials` `deny` entries and file `mask` entries in `~/.claude/settings.json`" stay as restrictions.
  - Bundled skills: `supportedCommands()` returned 48 built-in commands and skills with `settingSources: []` and an empty folder (Observed). `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS` removes "the skills and workflows included with Claude Code" ([env]).
  - The docs' isolation checklist: "set `settingSources: []` plus `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` in `env`", with a separate `CLAUDE_CONFIG_DIR` and `cwd` per tenant ([ccf], [host]).
- **`CLAUDE_CONFIG_DIR` (Documented, Source, Observed).**
  - "Override the configuration directory (default: `~/.claude`). All settings, session history, and plugins are stored under this path." It is honoured from the shell, user settings or managed settings, and "Ignored in project and local settings" ([env]).
  - It moves `.claude.json`, the credentials file and the Keychain item (§3), transcripts (`projects/`) and the per-process registry (`sessions/`). An empty folder gained `.claude.json`, `backups/` and `sessions/<pid>.json` on first start (Observed).
  - **The SDK's session helpers run in the host process.** `listSessions`, `getSessionMessages`, `getSessionInfo` and `forkSession` find transcripts through the _host's_ `process.env.CLAUDE_CONFIG_DIR`, falling back to `~/.claude`, and take no folder option (Source, `sdk.mjs` 39:~37343). **Inference:** a host that sets the folder only in the child's `env` must also set it for itself before using them.
  - `CLAUDE_CODE_PROJECT_DIR_NAME` names the transcript folder for "a host that embeds Claude Code and gives each session its own config directory" ([ccsess]).
- **Environment (Documented, Source).**
  - "`env` replaces the subprocess environment" ([ccf]). Since 0.2.113 this has been marked **Breaking** ([changelog]). The SDK then adds `CLAUDE_CODE_ENTRYPOINT=sdk-ts`, `CLAUDE_AGENT_SDK_VERSION` and `CLAUDE_CODE_SDK_READS_SESSION_STATE=1`, and removes `NODE_OPTIONS` (Source). It also writes `CLAUDE_AGENT_SDK_VERSION` into the host's own `process.env`.
  - `CLAUDE_AGENT_SDK_CLIENT_APP` adds the application's name to the User-Agent (Source, `sdk.d.ts` 1659-1665).
  - Variables relevant to isolation ([env]):
    - `CLAUDE_CODE_DISABLE_CLAUDE_MDS=1` stops every CLAUDE.md "including user, project, and auto memory files".
    - `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`.
    - `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS`.
    - `CLAUDE_CODE_DISABLE_POLICY_SKILLS` skips the system-wide managed skills folder.
    - `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1` strips credentials from the environment of Bash commands, hooks and stdio MCP servers, "leav[ing] GitHub tokens and proxy settings in place". It removes `CLAUDE_CONFIG_DIR`, runs Bash in a PID namespace on Linux, and turns sandbox auto-allow off.
    - `DISABLE_TELEMETRY`, `DISABLE_ERROR_REPORTING` and `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` also disable feature-flag fetching. That changes the default permission mode (§7).
  - The sandbox does not filter the environment: "Environment variables | Inherited from Claude Code, including any secrets in its environment" ([sbx]).
- **What the working folder still contributes.**
  - With `settingSources` including `project`, the SDK treats the folder as trusted (Documented, [cchooks#workspace-trust], [ccperm#what-runs-before-you-trust-a-folder]):

    > "**`-p` or SDK session**: Claude Code never shows the dialog and treats the folder as trusted, so hooks committed in a repository's `.claude/settings.json` run in a folder you've never trusted"

    Hooks, "the `env` block and helper commands such as `apiKeyHelper`, and a project skill's hooks and `allowed-tools`" are used. `.mcp.json` servers are "Connected without asking, approved or not". `permissions.allow` from `.claude/settings.json` is "Not used" ("`this workspace has not been trusted`" on stderr).

  - The docs' hardening advice for untrusted folders: "set the SDK's `settingSources` without project settings", start with `--bare`, pass `--settings '{"disableAllHooks": true}'`, or add a `disabledMcpjsonServers` entry ([ccperm]).
  - `disableAllHooks` in a non-managed source disables "user, project, local, and plugin hooks", while "managed hooks, Agent SDK hooks, and hooks from plugins force-enabled in managed `enabledPlugins` keep running" ([setref]). A project's `"disableAllHooks": false` overrides a user `true`, but `--settings` (the SDK's `settings` option) outranks project files ([cchooks], [settings]).
  - `permissions.defaultMode` values `auto` and `bypassPermissions` "don't take effect from project or local settings" ([settings]).
  - With `settingSources: []`, the project contributes no settings, CLAUDE.md, skills or `.mcp.json` ([ccf]). Subdirectory CLAUDE.md files and skills also load lazily, "once Claude reads, writes, or edits another file in that subdirectory" ([memory], [ccskills]). **Unconfirmed:** whether lazy loading respects `settingSources: []`.
  - `projectConfigRoot` (Source, `sdk.d.ts` 1548) points project settings, `.mcp.json` and `.claude` trees at a "trusted checkout" other than `cwd`.
  - Claude reads `AGENTS.md` "only when you have no `CLAUDE.md` in your working directory or above it", from Claude Code 2.1.277 ([memory]).
- **Managed and enterprise policy (Documented, Source).**
  - Paths: macOS `/Library/Application Support/ClaudeCode/`, Linux and WSL `/etc/claude-code/`, Windows `C:\Program Files\ClaudeCode\` (`managed-settings.json`, `managed-settings.d/`, `managed-mcp.json`, and a managed `CLAUDE.md` and `.claude/skills/`). Also the macOS `com.anthropic.claudecode` preferences domain and the Windows registry `HKLM` and `HKCU\SOFTWARE\Policies\ClaudeCode` ([managed], [memory], [ccskills]).
  - Server-managed settings apply to Team and Enterprise logins, `CLAUDE_CODE_OAUTH_TOKEN` and directly configured API keys, and are cached in `~/.claude/remote-settings.json` ([srvmanaged]).
  - The host can pass `managedSettings`, but "By default, Claude Code ignores parent settings whenever an admin source is present", and they pass "a restrictive-only filter" ([managed#let-an-embedding-host-add-policy], [ts]).
  - Keys only a managed source can set include `allowManagedHooksOnly`, `allowManagedPermissionRulesOnly`, `allowManagedMcpServersOnly` and `strictKnownMarketplaces` ([managed#keys-only-a-managed-source-can-set]). Managed `availableModels` restricts model choice ([model]).
- **Detecting what loaded.**
  - `resolveSettings({cwd, settingSources, managedSettings})` (`@alpha`) returns the merged settings and their provenance without spawning the CLI. It "reports the **raw settings cascade**, not a security decision", and does not run an admin `policyHelper` (Source, `sdk.d.ts` 3311-3335). Policy origins are `helper`, `remote`, `plist`, `hklm`, `file`, `parent` and `hkcu`.
  - The init message lists `tools`, `mcp_servers` (with `source`), `slash_commands`, `skills`, `plugins` and `plugin_errors` ([ts]). The `initialize` response adds `hooks_applied?` and `plugins_applied?` (Source).
  - The `InstructionsLoaded` hook reports each instruction file loaded, with `file_path`, `memory_type` (`User`, `Project`, `Local` or `Managed`) and `load_reason` (Source, `sdk.d.ts` 1068-1076).
  - `/status` shows a "Setting sources" line in the CLI ([settings]).
  - **Inference:** before starting a session, the host can find a working folder's `.claude/settings.json`, `.claude/settings.local.json`, `.mcp.json` and `CLAUDE.md`/`CLAUDE.local.md` files, and admin policy through `resolveSettings`, as it does for Codex's `.codex` files. While running, it can compare the init message and `InstructionsLoaded` with what it expected. Refusing admin policy is not possible; only detecting it is.

## 5. Sessions and persistence

- **Identity (Documented, Source).**
  - The session id appears on the init message and on "every result regardless of success or error". "Connection or process failures yield no result message" ([sess]).
  - `sessionId` sets "a specific UUID for the session instead of auto-generating one". It cannot be combined with `continue` or `resume` unless `forkSession` is set ([ts], Source).
  - **Inference:** the host can generate and store the id before the first turn, so a crash before the first result does not lose it.
- **Storage (Documented, Source).**
  - Transcripts go to `<config>/projects/<encoded cwd>/<session id>.jsonl`. The encoding replaces every non-alphanumeric character with `-`, cut to 200 characters plus a hash. Subagents go to `<session id>/subagents/agent-<id>.jsonl` ([sess], Source).
  - "The entry format is internal to Claude Code and changes between versions, so scripts that parse these files directly can break on any release" ([ccsess]).
  - "Transcripts and history are not encrypted at rest… If a tool reads a `.env` file or a command prints a credential, that value is written to `projects/<project>/<session>.jsonl`" ([claudedir]).
  - `cleanupPeriodDays` defaults to 30 and deletes old sessions ([data]). `persistSession: false` keeps a session in memory only, and it "cannot be resumed" ([ts]).
  - A `SessionStore` (`@alpha`) mirrors each batch the CLI writes locally to the host's backend. It is a mirror, "not a replacement", and cannot be combined with `persistSession: false` or file checkpointing ([store]).
- **Resume, continue and fork (Documented).**
  - `resume: <id>` continues a specific session. `continue: true` takes the most recent in the folder ([sess]).
  - Resume works "from any working directory", but "Same machine only: the session file still needs to exist on the current machine". Before Claude Code 2.1.223 the lookup was limited to the current project folder and its worktrees ([sess]).
  - `resumeSessionAt: <message uuid>` resumes at a message. `forkSession: true` on `query()`, or the standalone `forkSession(id, {upToMessageId})`, copies history to a new id; "Forking branches the conversation history, not the filesystem" ([sess], [ts]).
  - A session's system prompt is recorded on its first request and reused "until the session is compacted", so a different `append` on resume is not seen ([sys]).
  - Totals are restored on resume, so "summing results double-counts the restored spend" ([cost]).
- **When resume fails (Documented, Unconfirmed).**
  - The CLI reports "`No conversation found with session ID: <session-id>`" ([ccsess]).
  - Some refusals give an `error_during_execution` result with a `startup_failure_reason` such as `session_held_by_background`, `worktree_resume_refused` or `worktree_unverified`. Others exit without a result ([ts]).
  - **Unconfirmed:** what `query()` yields or throws for an unknown id. Also unconfirmed: whether a session cut off by `SIGKILL` mid-turn resumes cleanly, and how its last turn appears.
  - The docs suggest, for moving between hosts: "**Don't rely on session resume.** Capture the results you need… as application state and pass them into a fresh session's prompt" ([sess#resume-across-hosts]).
  - T3 Code reports that `sessionId` "would fail with 'already in use'" when the id already has a transcript, so it switches to `resume` ([t3-ca-resume]).
- **Concurrency (Unconfirmed).** Whether two processes can resume the same session at once is not documented. The startup failure reason `session_held_by_background` suggests the CLI detects some conflicts.
- **Fit with a conversation record kept by Playstead (Inference).**
  - Its premise holds: Claude's transcript is internal, version-dependent and has no sequence numbers. It records nothing of the host's permission answers beyond tool results.
  - The host keeps its own record and stores Claude's session id only to resume. The id can be chosen and stored before the first turn.
  - The SDK's own resume path (`resume`, then `resumeSessionAt` if needed) is the only supported way back into a conversation. Reading the transcript to rebuild the record is not.
  - Because the transcript lives under the config folder, Playstead's choice of `CLAUDE_CONFIG_DIR` decides where it lives, and `cleanupPeriodDays` decides how long it stays resumable.

## 6. Turns and events

- **Message types (Source, `sdk.d.ts` 5397).** The `SDKMessage` union has 39 members:
  - `assistant`: one per _completed content block_, all with the same message id. It carries `message` (the API message), `parent_tool_use_id`, an `error?` code, `aborted?: true` when cut short, and `user_message_uuid(s)`.
  - `user`: tool results and echoed input, with `tool_use_result` holding the tool's structured output.
  - `result`: subtypes `success`, `error_during_execution`, `error_max_turns`, `error_max_budget_usd` and `error_max_structured_output_retries`. Fields include `duration_ms`, `num_turns`, `stop_reason`, `terminal_reason`, `total_cost_usd`, `usage`, `modelUsage`, `permission_denials`, `deferred_tool_use` and `errors`.
  - `stream_event`: raw API events, with `includePartialMessages`.
  - `system` subtypes:
    - `init`: emitted "at the start of each turn", not once per session.
    - Context and status: `compact_boundary`, `status`, `api_retry`, `thinking_tokens`, `session_state_changed`.
    - Hooks: `hook_started`, `hook_progress`, `hook_response`.
    - Tasks: `task_started`, `task_progress`, `task_updated`, `task_notification`, `background_tasks_changed`.
    - Notices: `permission_denied`, `notification`, `informational`, `model_refusal_fallback`, `model_refusal_no_fallback`, `mirror_error`.
    - Others: `local_command_output`, `memory_recall`, `plugin_install`, `elicitation_complete`, `files_persisted`, `commands_changed`, `worker_shutting_down`, `control_request_progress`.
  - Top-level types: `tool_progress` (elapsed seconds only), `tool_use_summary`, `auth_status`, `rate_limit_event`, `prompt_suggestion`, `conversation_reset`.
- **Streaming (Documented).**
  - Text arrives as `content_block_delta` with `text_delta`, and tool input as `input_json_delta`. "Stream events are emitted for the main session only" ([stream]).
  - A cut stream still ends with `message_stop` from 0.3.290. "A cut tool call doesn't [get `content_block_stop`], so… treat that call's input as incomplete" ([stream]).
  - Thinking: `thinking: {type: "adaptive", display: "summarized"}` returns thinking text. "On Claude Opus 4.7 and later, the API default is `"omitted"`" ([ts]). `thinking_delta` is not named in the SDK docs; **Inference:** it arrives as a raw API `content_block_delta`, as T3 Code handles it ([t3-ca-stream]).
- **Tool results (Source, `sdk-tools.d.ts`).**
  - `BashOutput` has `stdout`, `stderr`, `interrupted`, `backgroundTaskId?`, `timedOutAfterMs?`, `returnCodeInterpretation?` and `dangerouslyDisableSandbox?`. There is no numeric exit code field.
  - `FileEditOutput` has `filePath`, `oldString`, `newString`, `originalFile` and `structuredPatch`. `FileWriteOutput` is defined alongside it.
  - The Bash tool's input is `command`, `description`, `timeout`, `run_in_background` and `dangerouslyDisableSandbox`. It has no working-folder field; the shell keeps its own working folder between calls (**Inference** from the input type).
- **Retries and errors (Source, Documented).** `system/api_retry` carries `attempt`, `max_retries`, `retry_delay_ms`, `error_status` and `error`. `API_TIMEOUT_MS` defaults to 600,000, `CLAUDE_CODE_MAX_RETRIES` to 10 (capped at 15), and the stream idle watchdog to 300,000 ms ([cost], [ts]). T3 Code notes that "the SDK reports API-level failures (401 auth, 529 overloaded, …) as subtype "success" with is_error set" ([t3-ca-result]).
- **Mapping onto `ProviderAdapter.ts` (Inference).**

  | Playstead event                                                  | Claude source                                                                                                                                                                                                                                      |
  | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `turnStarted`                                                    | No native turn id. The host's turn begins when it sends a message with its own `uuid`. `system/init` and `session_state_changed: running` (opt-in with `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1`) mark the start, and the result echoes the `uuid` |
  | `activityStarted` / `activityDelta` / `activityCompleted`, reply | `stream_event` `content_block_start` (text), `text_delta`, then the `assistant` message for that block                                                                                                                                             |
  | Same, command                                                    | `assistant` `tool_use` with name `Bash` (or `PowerShell`) starts it. No output deltas, only `tool_progress`. The `user` `tool_result` with `BashOutput` completes it                                                                               |
  | Same, file change                                                | `tool_use` for `Edit`, `Write`, `MultiEdit` or `NotebookEdit`, completed by its result with `structuredPatch`                                                                                                                                      |
  | Same, other                                                      | Every other tool under its own name, including `WebFetch`, `WebSearch`, `Agent`, MCP tools and the task tools                                                                                                                                      |
  | `usage`                                                          | Per step on `assistant` messages (deduplicate by message id; "per-step `output_tokens` is a placeholder"), and per turn in `result.usage` ([cost])                                                                                                 |
  | `warning`                                                        | `api_retry`, `rate_limit_event` with `allowed_warning`, `model_refusal_fallback`, `compact_boundary`, `informational`, `mirror_error`                                                                                                              |
  | `permissionRequested`                                            | A `canUseTool` call (§7)                                                                                                                                                                                                                           |
  | `permissionCleared`                                              | The call's `AbortSignal` firing, through `control_cancel_request` or close                                                                                                                                                                         |
  | `requestDeclined`                                                | Requests the host chooses not to present, such as `AskUserQuestion` (also via `canUseTool`), MCP elicitations (declined automatically without `onElicitation`) and `onUserDialog` dialogs                                                          |
  | `turnEnded`                                                      | The `result` message. Map `terminal_reason` `aborted_streaming`/`aborted_tools` to interrupted; `error_*` subtypes and `is_error` to failed                                                                                                        |
  | `skills`                                                         | `system/init` `skills` and `plugins`, `commands_changed`, `supportedCommands()`                                                                                                                                                                    |
  | `providerStopped`                                                | The message loop rejecting after a process exit. This is per session for Claude, process-wide for Codex                                                                                                                                            |

- **Claude events with no Codex equivalent (Source).** Client-side cost estimates (`total_cost_usd`, `modelUsage.costUSD`); `rate_limit_event` pushed during a turn; `tool_progress`; subagent and background-task messages (`task_*`, `background_tasks_changed`); hook lifecycle messages; `permission_denied` for denials made without a prompt; `thinking_tokens`; `prompt_suggestion`; `auth_status`; `files_persisted`; `conversation_reset` after `/clear`; and the `interrupt()` receipt listing queued messages.
- **Codex events with no Claude equivalent (Inference from §6 of the Codex note).**
  - No native turn id or `turn/started`.
  - No streamed command output (`item/commandExecution/outputDelta`).
  - No `serverRequest/resolved`; the closest is the `canUseTool` signal.
  - No report of the applied sandbox in the session-start response; only `permissionMode` is reported.
  - No `turn/diff/updated` or `turn/plan/updated`; the task tools carry plans.
  - No `model/rerouted`; Claude has `fallbackModel` and `model_refusal_fallback`.
  - No `instructionSources` list; the `InstructionsLoaded` hook is the nearest.
  - No `account/rateLimits/read` on a stable surface; Claude has only `usage_EXPERIMENTAL_…` and `/usage`.

## 7. Permissions, cancellation and sandbox

### Modes and evaluation

- **Permission modes (Source, Documented).** `PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan' | 'dontAsk' | 'auto'` ([ts]).
  - `default`: "calls that need approval and match no allow rule trigger your `canUseTool` callback"; "no callback means deny" ([perm], [loop]).
  - `acceptEdits`: "File edits and filesystem operations (`mkdir`, `rm`, `mv`, etc.) are automatically approved".
  - `plan`: edits always go to `canUseTool`.
  - `dontAsk`: "Any call that would otherwise prompt is denied… `canUseTool` is never called".
  - `bypassPermissions` needs `allowDangerouslySkipPermissions: true` in TypeScript, and is refused as root outside a recognised sandbox.
  - `auto`: "A model classifier approves or denies each call, prompting through `canUseTool` when it cannot decide" (Source, `sdk.d.ts` 2000).
  - The CLI's `--permission-mode` help lists `manual` where the SDK type says `default` (Observed). The VS Code setting accepts both ([modes]). **Unconfirmed:** whether the CLI flag accepts `default`; the SDK passes the type's value.
- **Omitting `permissionMode` (Documented, Source, Observed).**
  - Since 0.3.286, "When omitted, Claude Code picks the starting mode as it does for `claude -p`: a `permissions.defaultMode` from the settings the session loads, else `'auto'` where that is the default" (`sdk.d.ts` 2001). The permission-modes page says the built-in default for the SDK is "`default` in sessions that fetch feature flags. In sessions that don't, such as on a third-party provider or with telemetry off, `auto` with Claude Code v2.1.285 or later" ([modes#which-mode-a-session-starts-in]).
  - Observed: with no option and no settings, the `initialize` response reported `current_permission_mode: "auto"`. Telemetry was not disabled, and there were no credentials.
  - "A session that starts in auto mode drops broad allow rules such as a bare `Bash` entry… pass `default` explicitly" ([perm]).
- **Evaluation order (Documented, [perm#how-permissions-are-evaluated]).**
  1. Hooks. "A hook that returns `allow` does not skip the deny and ask rules below."
  2. Deny rules, which block "even in `bypassPermissions` mode". Bare names such as `Bash` remove the tool entirely.
  3. Ask rules, which fall through to `canUseTool` "even in `bypassPermissions` mode".
  4. The permission mode.
  5. Allow rules. Also "A call the tool approves on its own…: for example a file read inside your working directories or a read-only Bash command."
  6. `canUseTool`. In `dontAsk` this step is skipped and the call denied. With `permissionPrompts: 'none'` the callback is skipped and the call denied unless a `PermissionRequest` hook decides.

  "**Auto-approved tools never reach `canUseTool`.**" The SDK warns with `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED` when `bypassPermissions` or a bare `allowedTools` entry would shadow the callback ([perm]).

- **Tools and rules (Documented).**
  - `allowedTools` only pre-approves; "Other tools not listed here still exist". `disallowedTools: ["Bash"]` removes the tool. `Bash(rm *)` denies matching calls "as written", and "`/bin/rm`, fall[s] through" ([perm]).
  - `tools` sets which built-in tools exist; `[]` removes all ([ts]).
  - Read and Edit rules cover built-in file tools and file commands Claude recognises in Bash, "not… a Python or Node script that opens files itself. For OS-level enforcement… enable the sandbox" ([ccperm]).
  - Reads inside the working folders need no approval. "File-access tools… still prompt for paths outside the working directory and additional directories" ([toolsref]). `permissions.blockReadsOutsideWorkingDirectories` refuses them in every mode ([ccperm]).
  - Writes to protected paths such as `.git`, `.claude`, `.vscode`, `.mcp.json`, shell rc files and `.gitconfig` "are never auto-approved, except in `bypassPermissions` mode" ([modes#protected-paths]).
  - Rules that a permission answer adds can be saved to `userSettings`, `projectSettings`, `localSettings`, `session` or `cliArg`. "Bash prompts include a suggestion with the `localSettings` destination, so returning it in `updatedPermissions` writes the rule to `.claude/settings.local.json`" ([ts]).

### Requests that reach the host

- **`canUseTool` (Source, `sdk.d.ts` 217-311).**
  ```ts
  type CanUseTool = (toolName: string, input: Record<string, unknown>, options: {
    signal: AbortSignal; suggestions?: PermissionUpdate[]; blockedPath?: string;
    mcpServer?: { name: string; source: string }; decisionReason?: string;
    title?: string; displayName?: string; description?: string;
    defaultToNo?: boolean; suppressAlwaysAllowRule?: boolean;
    toolUseID: string; agentID?: string; requestId: string;
    matchedAskRule?: { source: string; toolName: string; ruleContent?: string };
  }) => Promise<PermissionResult | null>;

  type PermissionResult =
    | { behavior: 'allow'; updatedInput?: Record<string, unknown>; updatedPermissions?: PermissionUpdate[];
        toolUseID?: string; decisionClassification?: 'user_temporary' | 'user_permanent' | 'user_reject' }
    | { behavior: 'deny'; message: string; interrupt?: boolean; toolUseID?: string;
        decisionClassification?: … };
  ```
  - Requests come from tool calls: `Bash` with the command; `Edit`, `Write` and `NotebookEdit` with the path and change; reads outside the working folders; `WebFetch` and MCP tools; `AskUserQuestion` (1–4 questions with 2–4 options); `ExitPlanMode` ([ui]).
  - With the sandbox on, a command retried with `dangerouslyDisableSandbox` prompts as "Bash command (unsandboxed)" outside `bypassPermissions`, and is denied in `dontAsk` ([sbx]). "The first time a command needs a new network domain, Claude Code prompts for approval" ([sbx]). The binary contains a `SandboxNetworkAccess` name (Source). **Unconfirmed:** how a network-domain prompt reaches `canUseTool`, and with what tool name and input.
  - `defaultToNo` asks that "a single stray keystroke must not approve this request". `suppressAlwaysAllowRule` asks that no standing choice be offered ([ts]).
  - A prompt that has waited about six seconds also produces a `Notification` hook of type `permission_prompt` ([ts]).
- **Answers and Playstead's choices (Documented, Inference).**
  - **Allow once:** `{behavior: 'allow', updatedInput: input}` with no `updatedPermissions`. Before Claude Code 2.1.207, an allow without `updatedInput` was rejected ([ui]).
  - **Deny:** `{behavior: 'deny', message}`. "Claude sees this message and may adjust its approach" ([ui]).
  - **Deny and stop:** `{behavior: 'deny', message, interrupt: true}`. The SDK pages give only the field; the hooks reference says "if `true`, stops Claude" ([cchooks#permissionrequest-decision-control]). **Unconfirmed:** which result follows, and whether queued messages still run. Calling `interrupt()` after the denial is the documented alternative.
  - Standing answers would be `updatedPermissions` with a `session` destination or a settings file. Playstead's rules defer those to bounded-task approval.
  - Changed input: "Claude sees the result but isn't told you changed anything" ([ui]).
- **Requests never answered (Documented, Source).**
  - "The callback can stay pending indefinitely. Execution remains paused until your callback returns" ([ui]). "Fail-closed: an accidental null means no control_response is sent and the tool stays blocked indefinitely — permission prompts have no park deadline" (Source, `sdk.d.ts` 208-215).
  - For long waits the docs suggest a `PreToolUse` hook returning `defer`. The turn then ends with `stop_reason: "tool_deferred"` and `deferred_tool_use`, so "the process can exit and resume later from the persisted session" ([ui], [ts]). "`defer` only works when Claude makes a single tool call in the turn", and it is honoured "only in non-interactive mode with the `-p` flag" ([cchooks#defer-a-tool-call-for-later]). **Inference:** this is the only documented way a pending request could survive a host restart.
  - The signal is aborted by a `control_cancel_request` from the CLI or by `close()` (Source, `sdk.mjs` 159:632). **Unconfirmed:** exactly when the CLI cancels a pending request on `interrupt()`, and what happens to an answer given after the signal fired.
  - After a transport gap within a live process, `reinitialize()` and the `pending_permission_requests` in the `initialize` response send pending requests to `canUseTool` again. "Make the callback idempotent per request ID" ([ts]).
- **Hooks (Documented).**
  - 33 events, including `PreToolUse` (`allow`/`deny`/`ask`/`defer`, plus `updatedInput`), `PermissionRequest` (allow or deny, with `interrupt`), `PermissionDenied`, `SessionStart`, `Stop` and `InstructionsLoaded` ([hooks-sdk], Source).
  - Precedence is "`deny` … over `defer`, which takes priority over `ask`, which takes priority over `allow`".
  - Callback hooks default to a 600 s timeout; "Claude Code doesn't run the tool call" when a `PreToolUse` callback times out ([hooks-sdk]).
  - "For checks that must run on every tool call, use a `PreToolUse` hook: hooks run before every other step, and a hook deny applies even in `bypassPermissions` mode" ([perm]).

### Interrupt and abort

- **`interrupt()` (Documented).** It works only in streaming input mode. On CLIs with `interrupt_receipt_v1` it returns `{still_queued: string[]}`, the uuids of messages still pending. "Claude Code processes the listed messages after the interrupt unless you cancel them first"; `interrupt()` itself never cancels them ([ts]).
- **After an interrupt (Documented).** The assistant message is marked `aborted: true` and the stream gets its `message_stop` ([stream]). The result carries `terminal_reason` `aborted_streaming` or `aborted_tools`. The docs list `error_during_execution` for "a cancelled request" ([loop]). T3 Code notes that "The CLI can label an abort as success with is_error=false" ([t3-ca-result]); quote both, as the docs do not settle it.
- **Interrupting during a pending hook (Documented).** "Claude Code cancels the pending tool call. Before v2.1.208, the tool call could still proceed" ([hooks-sdk]).
- **What is not documented (Unconfirmed).** Whether running Bash commands and background shells are killed on `interrupt()`. Whether a final result follows `abort()` or `close()` (Observed: `abort()` rejects the loop; `close()` ends it with no result, when idle). Whether the transcript is flushed after a mid-turn close.

### Claude Code's sandbox

- **Scope (Documented, [sbx]).**
  - "The sandbox covers shell commands only. Claude's file tools, MCP servers, and hooks run outside it." The limits "apply to Bash, PowerShell, and Monitor commands and the processes they start". Subagents share the parent's sandbox.
  - "The sandbox is off by default." It is built on `@anthropic-ai/sandbox-runtime`: Seatbelt on macOS, bubblewrap on Linux and WSL2 (which also need `socat`).
  - "On native Windows, Claude Code runs commands unsandboxed. To use the sandbox on a Windows machine, run Claude Code inside a WSL2 distribution." (§11 records conflicting evidence in the binary.)
- **What it enforces (Documented, [sbx#what-the-sandbox-restricts]).**
  - Writes: "The working directory, a per-user temp directory, and directories you've added. Protected paths stay write-denied".
  - Reads: "Most of the machine, including credential files such as `~/.ssh` and `~/.aws/credentials`", narrowed with `filesystem.denyRead` and `credentials`.
  - Network: "No direct route out. Connections go through a proxy on your machine that checks each host against your allowed domains, which start empty." `strictAllowlist` denies instead of prompting. The proxy "does not terminate or inspect TLS".
  - Environment: inherited, "including any secrets".
  - `autoAllowBashIfSandboxed` defaults to `true`: sandboxed commands run without prompting, "even in Manual mode, where the file edit tools would prompt".
  - `allowUnsandboxedCommands` defaults to `true`, so the model can retry with `dangerouslyDisableSandbox`. `false` gives "Strict sandbox mode". `excludedCommands` "run with your full access".
  - Warning: "If `permissionMode` is set to `bypassPermissions` and `allowUnsandboxedCommands` is enabled, the model can autonomously execute commands outside the sandbox without approval prompts" ([ts]).
- **Failing open or closed (Documented, Source; the sources differ).**
  - The sandboxing page: "By default, if the sandbox can't start because a dependency is missing or the platform is unsupported, Claude Code runs commands without sandboxing. To make Claude Code exit at startup instead, set `sandbox.failIfUnavailable` to `true`" ([sbx]).
  - The SDK option: "When this option sets `enabled: true`, `failIfUnavailable` defaults to `true` unless this option or an inline `settings` sandbox block sets it: if sandbox dependencies are missing… `query()` emits an error result and exits rather than silently running commands unsandboxed" (Source, `sdk.d.ts` 2170-2175; changelog 0.2.91).
  - **Inference:** the two agree if read as different defaults for the settings file and the SDK option. Setting `failIfUnavailable: true` explicitly avoids depending on that reading.
- **Verifying it applied (Documented, Inference).**
  - The docs' check is to ask Claude to run `touch ~/sandbox-probe` (expect "`Operation not permitted`" or "`Read-only file system`") and `curl --noproxy '*' https://example.com` ([sbx#confirm-commands-run-inside-the-sandbox]). `/sandbox` shows the resolved settings.
  - **Not documented:** any per-session or per-command report that the sandbox started. The init message reports `permissionMode` but not sandbox state (Source). Codex's `thread/start` reports the applied policy; Claude has no equivalent.
  - **Inference:** with `failIfUnavailable: true` set, a session that starts implies the sandbox could start. `resolveSettings` shows the settings that would apply, including admin overrides. `BashOutput.dangerouslyDisableSandbox` marks commands that ran outside it.
- **Reaching the host's port (Documented, Inference).**
  - With the sandbox off (the default), a command Claude runs is an ordinary local program. **Inference:** it can reach `127.0.0.1:4317`. The host's local-access guard accepts requests without an `Origin` header from programs (ARCHITECTURE, "Remote access").
  - macOS sandbox: "set `network.allowLocalBinding` to `true`. Sandboxed commands can then listen on network ports and connect to any port on localhost, which includes every other service listening there" ([sbx]). **Inference:** without it, a direct loopback connection is blocked. Claude Code sets `NO_PROXY` so `localhost` is reached directly, not through the proxy.
  - Linux and WSL2 sandbox: "a sandboxed command's `localhost` is private to that command… A direct connection to `localhost` or `127.0.0.1` doesn't reach servers on the host, and `allowLocalBinding` has no effect."
  - Through the proxy, a hostname that resolves only to local addresses is refused, but "The names `localhost` and `*.localhost` are allowed to resolve to loopback".
  - `WebFetch` runs outside the sandbox and follows permission rules ([sbx]). **Unconfirmed:** whether `WebFetch` can fetch a loopback address, and whether it asks first.

## 8. Resource controls

- **The host can enforce (Documented, Source).**
  - `interrupt()`, `close()` or abort, and denying permission requests.
  - `maxTurns`, which "counts tool-use turns only". In streaming input the count "starts over for each queued message", and the session stays alive after a cap result ([cfg]).
  - `maxBudgetUsd`: "Stop the query when the client-side cost estimate reaches this USD value. The estimate can pass this value, so leave headroom. Counts only the call's own spend; totals restored from a resumed session don't count." The overshoot is up to one response plus running subagents ([ts], [loop#budget-headroom]). The budget covers subagents. `0` is rejected at startup.
  - `taskBudget: {total}` (`@alpha`).
  - Removing tools (`tools`, `disallowedTools`) and switching skills off (`skills`).
  - Timeouts through the environment: `BASH_DEFAULT_TIMEOUT_MS` (120 s) and `BASH_MAX_TIMEOUT_MS` (600 s), `API_TIMEOUT_MS`, `CLAUDE_CODE_MAX_RETRIES`, `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` (3) and `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` (20) ([env], [ts]).
  - "No top-level session timeout. A session does not time out on its own" ([host]). There is "No per-subagent wall-clock deadline".
- **The host can only observe (Documented, Source).**
  - `total_cost_usd` and `modelUsage[model].costUSD` "are client-side estimates, not authoritative billing data… Do not bill end users or trigger financial decisions from these fields" ([cost]). `ModelUsage.costBasis` is `list`, `managed` or `unknown`.
  - Tokens: `usage` covers the main loop and that turn only, while `modelUsage` and `total_cost_usd` are running totals for the call, "plus any spend restored when the call resumed a session" ([cost]). `getContextUsage()` returns context-window use.
  - `rate_limit_event` carries `status` (`allowed`, `allowed_warning`, `rejected`), `resetsAt`, `rateLimitType` (`five_hour`, `seven_day`, …), `utilization` and overage fields. It applies "for claude.ai subscription users". `errorCode: "credits_required"` means the subscription's included usage is exhausted ([ts], Source).
  - `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()` returns token totals and plan rate-limit windows (Source). The status line exposes `rate_limits.five_hour` and `seven_day` "only for claude.ai Pro and Max subscribers… and only after the first API response" ([statusline]).
  - Pro and Max have "a five-hour session limit and a weekly limit", shared between Claude and Claude Code ([hc-promax]).
- **Enforceable spend caps outside Playstead (Documented, [costs]).** Console workspace spend limits for API keys; a monthly spend limit on claude.ai usage credits; organisation limits for Team and Enterprise; and cloud providers' own budgets. "When you first authenticate Claude Code with your Claude Console account, a workspace called 'Claude Code' is automatically created for you."
- **Inference.** As with Codex, Playstead can enforce only stopping work and refusing requests. Claude adds a turn cap and an estimate-based budget stop, both of which can overshoot. Any spend figure Playstead shows from the SDK is an estimate.

## 9. Models and effort

- **Listing (Source, Observed).**
  - `supportedModels()` returns `ModelInfo {value, resolvedModel?, displayName, description, supportsEffort?, supportedEffortLevels?, supportsAdaptiveThinking?, supportsFastMode?, supportsAutoMode?}`; live objects also carry `supportsThinkingOff`.
  - Observed signed out, five rows: `default` and `opus` (`claude-opus-5-5`), `fable` (`claude-fable-5-1`), `sonnet` (`claude-sonnet-5-5`) and `haiku` (`claude-haiku-5-5`). All allow efforts `low` to `max`, and none allows thinking off. The values are aliases, not model ids.
  - **Unconfirmed:** how the list changes when signed in, by plan or provider.
- **Account-dependent defaults and access (Documented).**
  - "Pro, Max, Team, Enterprise, and Anthropic API: defaults to Opus 5.5"; "Microsoft Foundry: defaults to Sonnet 4.5" ([model]).
  - Fable on Pro and standard Team seats "run[s] on pay-as-you-go usage credits"; on Max and premium seats it is "a standard part of your plan" ([hc-fable]). The Help Center says Fable 5.1 needs Claude Code 2.1.255; the model page says 2.1.257.
  - Administrators restrict choice with `availableModels` ([model]).
- **Per session and per turn (Documented, Source).**
  - `model` and `fallbackModel` at start. "When the primary is overloaded or unavailable, the session switches to the backup. The primary is retried at the start of each user turn" ([cfg]).
  - `setModel()` changes the model in a live session; "the response Claude is already generating finishes on the old model". A switch recomputes the conversation "uncached at the new model's rates" ([cfg]).
  - Effort: `effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max'`, changed live with `applyFlagSettings({effortLevel})` ([ts]). Defaults are "`high` on every model that supports effort, except that Opus 5.5, Sonnet 5.5, and Haiku 5.5 default to `medium`" ([model]). `CLAUDE_CODE_EFFORT_LEVEL` outranks every other setting, including `--effort` ([env]).
  - Thinking: `thinking: {type: 'adaptive' | 'enabled' | 'disabled', display?}`. "You can't turn thinking off on Opus 5.5, Sonnet 5.5, Haiku 5.5, or the Fable models" ([model]). From 0.3.300, `disabled` runs as adaptive on those models ([changelog]). `thinking` is a launch flag (`--thinking`), so T3 Code starts a new process to change it ([t3-ca-thinking]).
  - "`effort` trades latency and token cost for reasoning depth within each response. Extended thinking is a separate feature" ([loop]).
- **Inference.** Claude's model and effort can change between turns of one live session, as Playstead's `TurnRequest` expects. Thinking display is a session-level choice.

## 10. Instructions and skills

- **System prompt (Documented).**
  - "When you don't set `systemPrompt`…, the SDK uses a minimal prompt that covers tool calling but omits the rest of the `claude_code` preset's content, including its security and safety instructions. This differs from `claude -p`" ([sys]).
  - `{type: "preset", preset: "claude_code", append}` uses Claude Code's prompt with additions. A custom string replaces it entirely, and "You take responsibility for replacing the tool guidance and safety instructions".
  - "CLAUDE.md loading is controlled by setting sources, not by the `claude_code` preset."
  - There is no `appendSystemPrompt` option in the TypeScript SDK (Source).
- **CLAUDE.md (Documented, [memory]).**
  - Load order: the managed `CLAUDE.md`; `~/.claude/CLAUDE.md`; `CLAUDE.md` or `.claude/CLAUDE.md` in `cwd` and "every directory above it"; and `CLAUDE.local.md`. All are concatenated.
  - Subdirectory files load lazily, imports use `@path` (at most four hops deep), and rules live in `.claude/rules/`.
  - "Managed policy CLAUDE.md files can't be excluded." Auto memory loads "The first 200 lines of `MEMORY.md`, or the first 25KB".
- **Skills (Documented).**
  - Locations ([ccskills]):
    - managed: `.claude/skills/` in the managed folder
    - personal: `~/.claude/skills/`
    - project: `.claude/skills/` from `cwd` up to the repository root, plus nested folders loaded lazily
    - `--add-dir` folders
    - plugins: `<plugin>/skills/`, namespaced `plugin:skill`
    - claude.ai account skills synced into `~/.claude/skills/synced/` when signed in with claude.ai (2.1.273 and later); `syncClaudeAiSkills: false` turns that off
    - bundled skills
  - Name collisions: "Enterprise over personal, and personal over project."
  - In the SDK, skills "are filesystem artifacts" governed by `settingSources`; "The SDK doesn't provide a programmatic API for registering them" ([skills-sdk]).
  - The `skills` option takes `'all'`, a list of names or `[]`, and adds the `Skill` tool to `allowedTools`. "The model doesn't see unlisted skills and the Skill tool rejects them, while their files remain on disk and stay reachable through Read and Bash." `sdk.d.ts` adds that omitting it "is **not** 'skills off'", and that it is "a context filter, not a sandbox" (Source).
  - Plugins load from local paths only (`{type: "local", path}`); "If a plugin path doesn't exist, the SDK skips that plugin… so check the `plugins` list in the init message" ([plugins]). `skipMcpDiscovery` loads a plugin's skills, hooks, agents and commands without its MCP servers.
  - `skillOverrides` sets a skill to `"on"`, `"name-only"`, `"user-invocable-only"` or `"off"`; "Plugin skills are not affected by `skillOverrides`" ([ccskills]). `disable-model-invocation` in a skill's front matter keeps Claude from invoking it on its own.
  - "Disable all skills by denying the Skill tool"; `Skill(name)` rules match single skills ([ccskills]).
  - `reloadSkills()` reloads from disk mid-session ([skills-sdk]).
  - "Only one skill expands per message; a second `/x` becomes argument text" (T3 Code, citing a Claude Code issue, [t3-skilldispatch]).
- **Reporting the active set (Documented, Source).** The init message's `skills`, `plugins` and `slash_commands`; `supportedCommands()`; `commands_changed` "when Claude Code discovers skills as the agent enters a subdirectory" ([ts]).
- **For skills the game project controls (Inference).**
  - Personal skills stay out when `user` is not a setting source. Under a Playstead `CLAUDE_CONFIG_DIR` the personal folder would be Playstead's own, if Claude resolves `~/.claude/skills` through that variable (**Unconfirmed**; the docs say settings, history and plugins move).
  - Unlike Codex, Claude finds no personal skills through `HOME`, as far as the docs say.
  - A game project's own skills and CLAUDE.md need the `project` source, which also brings its hooks, `env` and `.mcp.json` (§4).
  - The other route is `settingSources: []`, with selected skills loaded from a folder Playstead controls through the `plugins` option. They would then be namespaced and listed in the init message.
  - Bundled skills need `CLAUDE_CODE_DISABLE_BUNDLED_SKILLS` or the `skills` filter to leave the active set.

## 11. Windows

Nothing in this section was run on Windows. Statements come from the docs, the SDK source and strings in the darwin-arm64 binary of the same version.

- **Native support (Documented, [setup#set-up-on-windows]).**

  | Setup          | Requirement                         | Sandboxing      |
  | -------------- | ----------------------------------- | --------------- |
  | Native Windows | "None; Git for Windows is optional" | "Not supported" |
  | WSL 2          | WSL 2 enabled                       | Supported       |
  | WSL 1          | WSL 1 enabled                       | Not supported   |
  - Windows 10 1809 or later, or Windows Server 2019 or later. Installing needs no administrator rights.
  - "Installing Git for Windows is optional. It provides Git Bash, which the Bash tool and the Monitor tool need." "Without Git for Windows, Claude Code runs shell commands via the PowerShell tool." With Git for Windows, the PowerShell tool is available alongside Bash ([setup], [toolsref]).
  - `CLAUDE_CODE_GIT_BASH_PATH` names `bash.exe` if detection fails ([env]).
  - The SDK ships `win32-x64` and `win32-arm64` binary packages (Source).

- **Sandbox (Documented, Source; the sources differ).**
  - The docs: "On native Windows, Claude Code runs commands unsandboxed" ([sbx]).
  - The 0.3.300 types describe a native Windows sandbox: "Ignored on native Windows, where the sandboxed process runs as a separate user with no inherent rights", and "On native Windows an ephemeral CA cannot pass the sandbox trust check, so omitting the paths uses a persistent CA managed by the sandbox runtime (set up and trusted via /sandbox install)" (Source, `sdk.d.ts` 8819, 8848).
  - The binary contains "Install the Windows sandbox user and network filters. Self-elevates (one UAC prompt)", "the WFP filter keys on the dedicated `srt-sandbox` user's SID", "The Windows sandbox is not enabled on this build.", and a refusal to start in the home folder or the config folder (Source, strings).
  - **Inference:** a native Windows sandbox exists in the code behind a build or feature gate. **Unconfirmed:** whether it is enabled in the `win32` builds of 2.1.300. The documentation's statement is the current official position.
- **Credentials and paths (Documented, Source).**
  - Credentials go to `%USERPROFILE%\.claude\.credentials.json`, or under `CLAUDE_CONFIG_DIR`, protected only by the profile's ACLs. Credential Manager is behind a flag (§3).
  - Managed policy lives in `C:\Program Files\ClaudeCode\` (not the legacy `C:\ProgramData` path) and the `HKLM`/`HKCU\SOFTWARE\Policies\ClaudeCode` registry keys ([managed]).
  - Permission rule paths are "normalized to POSIX form before matching. `C:\Users\alice` becomes `/c/Users/alice`" ([ccperm]).
- **Processes (Source, Inference).**
  - `spawn` uses `windowsHide: true` and no shell. T3 Code notes that the SDK therefore cannot start an npm `claude.cmd` shim ("`spawn EINVAL`") or a bare `claude` name ([t3-exe]). The bundled binary is a plain `claude.exe`, so this matters only for `pathToClaudeCodeExecutable`.
  - Closing ends stdin, waits 7 s, then calls `TerminateProcess` on the direct child only. There is no SIGTERM step and no tree kill.
  - **Inference:** a host that must stop the whole tree on Windows would run `taskkill /PID <pid> /T /F` itself, as Playstead does for Codex.
  - The `pluginDelivery` option warns that "Windows refuses to start a process whose command line" exceeds its limit, which many plugins can reach (Source, `sdk.d.ts` 2044-2057).

## 12. Reference implementation (non-authoritative)

The following summarises how [pingdotgg/t3code][t3] at `bf8ffe8` runs Claude. It records what one open-source client does; it is not guidance from Anthropic. Where it differs from Anthropic's documentation, the documentation applies.

- **SDK and binary.**
  - It depends on `@anthropic-ai/claude-agent-sdk` `^0.3.276`, locked at 0.3.276 (bundling Claude Code 2.1.276) ([t3-pkg]).
  - It always passes the user's installed `claude` as `pathToClaudeCodeExecutable`, and strips the SDK's platform binaries from its install and desktop builds: "The SDK always receives the user's Claude executable, so its bundled binaries are unused" ([t3-ws]).
  - A model manifest marks Claude Code ≥ 2.1.280 supported, 2.1.111–2.1.279 graceful and older unsupported, with a minimum CLI version per model. The installed version comes from `claude --version`. The manifest is refreshed hourly from GitHub ([t3-manifest]).
- **Process.**
  - It uses one long-lived `query()` per provider session, fed by a queue as streaming input ([t3-ca-runner]).
  - Model, effort and fast mode change live through `setModel` and `applyFlagSettings`. Thinking, permission policy, tools or MCP changes close the process and resume in a new one. It refuses such a change while background agents or shells run ([t3-ca-open]).
  - On non-Windows hosts it spawns the CLI detached and kills its whole process group, because "plugin MCP server grandchildren survive otherwise". It drops stderr ([t3-ca-spawn]). Sessions idle for 30 minutes are released, or after up to 4 hours while background work runs.
  - It iterates the `Query` object rather than its raw generator, because the raw generator's `return()` "never settles while the CLI is idle" ([t3-ca-iterate]).
- **Authentication.**
  - It uses whatever login the CLI already has, never calls a sign-in API, and sends the user to a terminal running `claude auth login`.
  - It passes the host environment through, so an `ANTHROPIC_API_KEY` there is used.
  - It moves configuration with `CLAUDE_CONFIG_DIR` rather than `HOME`, because "Overriding HOME also relocates the macOS login keychain lookup" ([t3-home]).
  - Status comes from a probe every 5 minutes: a `query()` whose prompt never yields, `initializationResult()` for `account.{email, subscriptionType, tokenSource, apiKeySource, apiProvider}`, and the experimental usage call for rate-limit windows. The probe uses `persistSession: false`, `disableAllHooks`, `strictMcpConfig` and no tools ([t3-probe]).
  - The interface shows "Authenticated · Claude Max 20x Subscription" or similar, with the email.
  - On Linux and Windows it reads `claudeAiOauth.accessToken` from `<config>/.credentials.json`. It uses that token to call `api.anthropic.com/api/oauth/usage` and `…/reset_rate_limits`, with a `claude-cli/<version> (external, cli)` user agent ([t3-reset]).
  - **This differs from Anthropic's documentation.** The legal page says developers "may not collect, store, or intermediate Claude.ai credentials or session tokens" ([legal#authentication-and-credential-use]). The Help Center prohibits tools "that misrepresent their identity to Anthropic's servers" ([hc-login]).
- **Personal setup.**
  - Chat sessions set no `settingSources`, so the user's settings, CLAUDE.md, hooks, skills, plugins and MCP servers all load. Only the status probe and its title generator (`claude -p` with `--settings {"disableAllHooks":true}`, `--strict-mcp-config` and `--disable-slash-commands`) are isolated ([t3-probe], [t3-title]).
  - The system prompt is the `claude_code` preset with an appended runtime note ([t3-ca-opts]).
  - T3's own MCP server is added with `setMcpServers` after start, because "The SDK would pass `mcpServers` as an inline `--mcp-config` argument, which every local user can read" ([t3-ca-mcp]).
- **Permissions.**

  | T3 mode                    | `permissionMode`                                            |
  | -------------------------- | ----------------------------------------------------------- |
  | approval required          | `default`                                                   |
  | auto-accept edits          | `acceptEdits`                                               |
  | auto                       | `auto`                                                      |
  | full access (T3's default) | `bypassPermissions`, with `allowDangerouslySkipPermissions` |
  | plan                       | `plan`                                                      |
  | read-only                  | `dontAsk` with only `Read`, `Glob` and `Grep`               |
  - `canUseTool` turns each call into an approval request: `Bash` becomes a command request, edit tools a file change, and read tools a file read. It uses no SDK hooks ([t3-ca-modes]).
  - Answers ([t3-ca-decision]):
    - Approve → `allow` with the input unchanged.
    - "Always allow this session" → `allow` with the SDK's suggestions re-targeted to `destination: "session"`.
    - Decline → `deny`.
    - Cancel → `deny` with `interrupt: true`.
  - `AskUserQuestion` becomes a user-input request. `ExitPlanMode` is denied after T3 captures the plan.
  - A pending callback resolves as cancel when its signal aborts. Requests are answerable only while the same live session runs. On restart they expire, and on shutdown they are cancelled. It declares `pendingRequestsSurviveRestart: false` and `approvalCallbacksAreLiveOnly: true`.

- **Interrupt and resume.**
  - Stop calls `interrupt()` and then immediately `close()`, waits up to 10 s, and marks the turn interrupted. Every Stop ends the process, and the next turn resumes in a new one ([t3-ca-interrupt]). A `terminal_reason` of `aborted_tools` or `aborted_streaming` counts as interrupted "even when the CLI labels the result `success`" ([t3-ca-result]).
  - T3 allocates the session id itself, uses `resume` whenever the thread has turns, and uses `resumeSessionAt` and the standalone `forkSession` for rollback and fork.
  - When resume fails, it starts a fresh session with a summary of the thread from its own history ([t3-resume]).
- **Events.**
  - Only thinking deltas stream. Assistant text appears per completed block (`streaming: false`), although the adapter declares `streamsAssistantText: true` ([t3-ca-stream]).
  - Tool results complete command, file-change, web-search and MCP items. Command output is not streamed.
  - It handles `rate_limit_event`, `compact_boundary`, `api_retry`, `model_refusal_fallback`, the `task_*` messages and `background_tasks_changed` (which it calls an "Undeclared SDK subtype").
  - `tool_progress`, hook messages, `auth_status`, `files_persisted` and unknown types are ignored apart from a protocol log.
  - A fresh `uuid` per prompt separates its turns from turns the CLI starts itself for finished background tasks.
- **Models and usage.**
  - The model list comes from its manifest, filtered by CLI version, rather than from `supportedModels()`.
  - Effort offers `low` to `max`, plus `ultracode` (`xhigh` with a setting) and `ultrathink` (a prompt prefix). Fast mode is offered on Opus. Thinking is always `adaptive` with `display: "summarized"` unless switched off.
  - It reports context-window and per-turn token usage and rate-limit bars. It never reads `total_cost_usd` or `modelUsage` ([t3-usage]).
- **Windows.**
  - It resolves `claude` through `PATH` and `PATHEXT` and follows npm shims to `claude.exe` or `cli.js`, because the SDK spawns without a shell ([t3-exe]).
  - On Windows the SDK does its own spawning and killing.
  - The status probe skips IDE auto-detection to avoid "a Windows `tasklist | findstr` process tree on every periodic refresh".
  - `CLAUDE_CODE_GIT_BASH_PATH` is not referenced.
- **Claude versus Codex in T3 Code.**
  - Claude sessions serve one thread and cannot switch runtime mode in place.
  - There are no native turn ids (it uses synthetic `turn:<attempt>`), no thread snapshot and no streamed tool output.
  - Subagents are not exposed as threads.
  - Cancel maps to `deny` + `interrupt` rather than Codex's `abort`.
  - `$skill` mentions are rewritten to `/skill`, because "Codex parses that natively; Claude Code does not, and treats it as prose".
  - Both declare `pendingRequestsSurviveRestart: false` and native enforcement ([t3-ca-caps]).

## Limits and unconfirmed points

- **Not exercised:** any real model turn, sign-in, permission request, interrupt mid-turn, resume, fork, sandboxed command or rate-limit event. No API key, subscription or cloud credential was used. Every statement about turn-time behaviour comes from docs, types or source. Observations cover only the signed-out handshake, the control requests listed in the header, `auth status`, and `close`, `abort` and `kill -9` of an idle process, on macOS arm64.
- **Unconfirmed (terms):** whether Anthropic considers a local, open-source host that drives the unmodified bundled binary, with the person signed in through Claude Code's own flow, to be "offer[ing] claude.ai login" (§3). The pages quoted differ, and the legal page refers such questions to sales. The rest-of-world Consumer Terms and the Usage Policy currently in force were not read. Applying "developer", "third-party tool" or "end user" to Playstead is my inference.
- **Unconfirmed (process):** whether the CLI ends its own children (Bash commands, background shells, stdio MCP servers) on stdin EOF, SIGTERM or `TerminateProcess`. Also how long a busy CLI takes to exit after stdin closes. Only an idle process was closed.
- **Unconfirmed (permissions):**
  - The exact effect of `interrupt: true` in a `canUseTool` denial.
  - When the callback's `AbortSignal` fires on `interrupt()`.
  - What happens to an answer given after the signal fired.
  - How network-domain requests from the sandbox reach `canUseTool`, if at all.
  - Whether the CLI flag accepts `default` as well as `manual`.
  - Whether `default` mode with the sandbox enabled prompts for exactly the actions Playstead's Codex conversation does. Both auto-allow inside the sandbox and the model's `dangerouslyDisableSandbox` retries affect this.
- **Unconfirmed (stop):** whether an interrupted turn's result is `success` with an `aborted_*` `terminal_reason` or `error_during_execution`. The docs and T3 Code differ. Also unconfirmed: what a mid-turn `close()` or crash leaves in the transcript, and whether that session resumes.
- **Unconfirmed (sessions):**
  - What `query()` does with `resume` for an unknown or deleted id.
  - Whether `sessionId` with an existing id fails as T3 Code reports.
  - Whether two processes can hold one session.
  - Whether `~/.claude/skills` and auto memory follow `CLAUDE_CONFIG_DIR`.
- **Unconfirmed (isolation):**
  - Whether lazily loaded subdirectory CLAUDE.md files and skills respect `settingSources: []`.
  - Whether a managed `CLAUDE.md` loads with `settingSources: []`. "Managed policy settings" are said to load regardless, and the `InstructionsLoaded` hook would show it.
  - Which files a signed-in session writes to a fresh `CLAUDE_CONFIG_DIR`.
  - Whether claude.ai account skills sync into it.
  - Whether the bundled binary updates itself.
- **Unconfirmed (sandbox):**
  - Any machine-readable sign that the sandbox applied to a command, beyond `failIfUnavailable` and `BashOutput.dangerouslyDisableSandbox`.
  - Whether a macOS-sandboxed command without `allowLocalBinding` is refused when it connects to `127.0.0.1:4317`.
  - Whether `WebFetch` reaches loopback.
- **Unconfirmed (Windows):** all Windows behaviour, because nothing was run on Windows. This includes:
  - whether the native Windows sandbox in the binary is enabled in `win32` builds, and what `/sandbox install` leaves behind;
  - PowerShell versus Git Bash selection with and without Git for Windows;
  - whether the credentials file or Credential Manager is used;
  - process-tree cleanup after `TerminateProcess`.
- **Unconfirmed (Linux):** the credential store beyond the documented `.credentials.json`. Bubblewrap and socat availability on CI images was not checked.
- **Unconfirmed (models):** how `supportedModels()` differs when signed in, by plan and provider. Also whether a signed-in Pro account sees Fable as available.
- **Doc drift and version notes.**
  - The `settingSources` default changed in 0.1.0 and was later reverted, without a changelog entry for the reversal (§4).
  - The omitted `permissionMode` default changed in 0.3.286 (§7).
  - The sandbox's `failIfUnavailable` default differs between the settings file (`false`) and the SDK option (`true` when the option enables the sandbox) (§7).
  - The Fable 5.1 minimum CLI version differs between the Help Center (2.1.255) and the model page (2.1.257).
  - Line numbers refer to `sdk.d.ts` and `sdk-tools.d.ts` at 0.3.300. `sdk.mjs` positions are `line:column` in that minified file, and binary offsets are into the darwin-arm64 `claude` of the same version. Docs pages carry no version and may change without notice.

[npm]: https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk/v/0.3.300
[changelog]: https://github.com/anthropics/claude-agent-sdk-typescript/blob/v0.3.300/CHANGELOG.md
[ov]: https://code.claude.com/docs/en/agent-sdk/overview
[qs]: https://code.claude.com/docs/en/agent-sdk/quickstart
[ts]: https://code.claude.com/docs/en/agent-sdk/typescript
[mig]: https://code.claude.com/docs/en/agent-sdk/migration-guide
[svs]: https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode
[loop]: https://code.claude.com/docs/en/agent-sdk/agent-loop
[loop#budget-headroom]: https://code.claude.com/docs/en/agent-sdk/agent-loop#budget-headroom
[sess]: https://code.claude.com/docs/en/agent-sdk/sessions
[sess#resume-across-hosts]: https://code.claude.com/docs/en/agent-sdk/sessions#resume-across-hosts
[store]: https://code.claude.com/docs/en/agent-sdk/session-storage
[perm]: https://code.claude.com/docs/en/agent-sdk/permissions
[perm#how-permissions-are-evaluated]: https://code.claude.com/docs/en/agent-sdk/permissions#how-permissions-are-evaluated
[ui]: https://code.claude.com/docs/en/agent-sdk/user-input
[hooks-sdk]: https://code.claude.com/docs/en/agent-sdk/hooks
[stream]: https://code.claude.com/docs/en/agent-sdk/streaming-output
[cost]: https://code.claude.com/docs/en/agent-sdk/cost-tracking
[cfg]: https://code.claude.com/docs/en/agent-sdk/configuration
[ccf]: https://code.claude.com/docs/en/agent-sdk/claude-code-features
[ccf#what-settingsources-does-not-control]: https://code.claude.com/docs/en/agent-sdk/claude-code-features#what-settingsources-does-not-control
[sys]: https://code.claude.com/docs/en/agent-sdk/modifying-system-prompts
[skills-sdk]: https://code.claude.com/docs/en/agent-sdk/skills
[plugins]: https://code.claude.com/docs/en/agent-sdk/plugins
[mcp]: https://code.claude.com/docs/en/agent-sdk/mcp
[host]: https://code.claude.com/docs/en/agent-sdk/hosting
[secdep]: https://code.claude.com/docs/en/agent-sdk/secure-deployment
[ckpt]: https://code.claude.com/docs/en/agent-sdk/file-checkpointing
[trouble]: https://code.claude.com/docs/en/agent-sdk/troubleshooting
[v2]: https://code.claude.com/docs/en/agent-sdk/typescript-v2-preview
[legal]: https://code.claude.com/docs/en/legal-and-compliance
[legal#authentication-and-credential-use]: https://code.claude.com/docs/en/legal-and-compliance#authentication-and-credential-use
[legal#can-customers-offer-claude-code-in-their-products]: https://code.claude.com/docs/en/legal-and-compliance#can-customers-offer-claude-code-in-their-products
[auth]: https://code.claude.com/docs/en/authentication
[auth#authentication-precedence]: https://code.claude.com/docs/en/authentication#authentication-precedence
[auth#credential-management]: https://code.claude.com/docs/en/authentication#credential-management
[settings]: https://code.claude.com/docs/en/settings
[setref]: https://code.claude.com/docs/en/settings-reference
[env]: https://code.claude.com/docs/en/env-vars
[managed]: https://code.claude.com/docs/en/managed-settings
[managed#let-an-embedding-host-add-policy]: https://code.claude.com/docs/en/managed-settings#let-an-embedding-host-add-policy
[managed#keys-only-a-managed-source-can-set]: https://code.claude.com/docs/en/managed-settings#keys-only-a-managed-source-can-set
[srvmanaged]: https://code.claude.com/docs/en/server-managed-settings
[memory]: https://code.claude.com/docs/en/memory
[ccskills]: https://code.claude.com/docs/en/skills
[cchooks]: https://code.claude.com/docs/en/hooks
[cchooks#workspace-trust]: https://code.claude.com/docs/en/hooks#workspace-trust
[cchooks#permissionrequest-decision-control]: https://code.claude.com/docs/en/hooks#permissionrequest-decision-control
[cchooks#defer-a-tool-call-for-later]: https://code.claude.com/docs/en/hooks#defer-a-tool-call-for-later
[ccperm]: https://code.claude.com/docs/en/permissions
[ccperm#what-runs-before-you-trust-a-folder]: https://code.claude.com/docs/en/permissions#what-runs-before-you-trust-a-folder
[modes]: https://code.claude.com/docs/en/permission-modes
[modes#which-mode-a-session-starts-in]: https://code.claude.com/docs/en/permission-modes#which-mode-a-session-starts-in
[modes#protected-paths]: https://code.claude.com/docs/en/permission-modes#protected-paths
[sbx]: https://code.claude.com/docs/en/sandboxing
[sbx#what-the-sandbox-restricts]: https://code.claude.com/docs/en/sandboxing#what-the-sandbox-restricts
[sbx#confirm-commands-run-inside-the-sandbox]: https://code.claude.com/docs/en/sandboxing#confirm-commands-run-inside-the-sandbox
[setup]: https://code.claude.com/docs/en/setup
[setup#set-up-on-windows]: https://code.claude.com/docs/en/setup#set-up-on-windows
[data]: https://code.claude.com/docs/en/data-usage
[ccsess]: https://code.claude.com/docs/en/sessions
[claudedir]: https://code.claude.com/docs/en/claude-directory
[costs]: https://code.claude.com/docs/en/costs
[model]: https://code.claude.com/docs/en/model-config
[cli]: https://code.claude.com/docs/en/cli-reference
[statusline]: https://code.claude.com/docs/en/statusline
[toolsref]: https://code.claude.com/docs/en/tools-reference
[hc-sdkplan]: https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan
[hc-login]: https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account
[hc-credits]: https://support.claude.com/en/articles/17154008-monthly-api-credits-for-max-and-team-plans
[hc-promax]: https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan
[hc-apikey]: https://support.claude.com/en/articles/12304248-manage-api-key-environment-variables-in-claude-code
[hc-fable]: https://support.claude.com/en/articles/15424964-claude-fable-models-on-your-plan
[api-credits]: https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers
[consumer]: https://www.anthropic.com/legal/consumer-terms
[commercial]: https://www.anthropic.com/legal/commercial-terms
[aup]: https://www.anthropic.com/legal/aup
[t3]: https://github.com/pingdotgg/t3code/tree/bf8ffe81a63c82d3de5fbaa9991fd5f30034a452
[t3-pkg]: https://github.com/pingdotgg/t3code/blob/bf8ffe81a63c82d3de5fbaa9991fd5f30034a452/apps/server/package.json#L32
[t3-ws]: https://github.com/pingdotgg/t3code/blob/bf8ffe81a63c82d3de5fbaa9991fd5f30034a452/pnpm-workspace.yaml#L203-L211
[t3-manifest]: https://github.com/pingdotgg/t3code/blob/bf8ffe81a63c82d3de5fbaa9991fd5f30034a452/apps/server/src/provider/model-manifest.json#L25-L34
[t3-exe]: https://github.com/pingdotgg/t3code/blob/bf8ffe81a63c82d3de5fbaa9991fd5f30034a452/apps/server/src/provider/Drivers/ClaudeExecutable.ts#L53-L97
[t3-home]: https://github.com/pingdotgg/t3code/blob/bf8ffe81a63c82d3de5fbaa9991fd5f30034a452/apps/server/src/provider/Drivers/ClaudeHome.ts#L36-L54
[t3-probe]: https://github.com/pingdotgg/t3code/blob/bf8ffe81a63c82d3de5fbaa9991fd5f30034a452/apps/server/src/provider/ClaudeProvider.ts#L210-L452
[t3-reset]: https://github.com/pingdotgg/t3code/blob/bf8ffe81a63c82d3de5fbaa9991fd5f30034a452/apps/server/src/provider/claudeResetCredits.ts#L149-L250
[t3-title]: https://github.com/pingdotgg/t3code/blob/bf8ffe81a63c82d3de5fbaa9991fd5f30034a452/apps/server/src/textGeneration/ClaudeTextGeneration.ts#L188-L242
[t3-usage]: https://github.com/pingdotgg/t3code/blob/bf8ffe81a63c82d3de5fbaa9991fd5f30034a452/apps/server/src/provider/ClaudeTurnTokenUsage.ts#L61-L145
[t3-resume]: https://github.com/pingdotgg/t3code/blob/bf8ffe81a63c82d3de5fbaa9991fd5f30034a452/apps/server/src/orchestration-v2/ProviderTurnStartService.ts#L666-L760
[t3-skilldispatch]: https://github.com/pingdotgg/t3code/blob/bf8ffe81a63c82d3de5fbaa9991fd5f30034a452/apps/server/src/provider/Drivers/ClaudeSkillDispatch.ts#L1-L24
[t3-ca-caps]: https://github.com/pingdotgg/t3code/blob/bf8ffe81a63c82d3de5fbaa9991fd5f30034a452/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts#L268-L361
[t3-ca-mcpdeadline]: https://github.com/pingdotgg/t3code/blob/bf8ffe81a63c82d3de5fbaa9991fd5f30034a452/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts#L233-L235
[t3-ca-spawn]: https://github.com/pingdotgg/t3code/blob/bf8ffe81a63c82d3de5fbaa9991fd5f30034a452/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts#L237-L266
[t3-ca-bg]: https://github.com/pingdotgg/t3code/blob/bf8ffe81a63c82d3de5fbaa9991fd5f30034a452/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts#L446-L453
[t3-ca-iterate]: https://github.com/pingdotgg/t3code/blob/bf8ffe81a63c82d3de5fbaa9991fd5f30034a452/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts#L511-L519
[t3-ca-runner]: https://github.com/pingdotgg/t3code/blob/bf8ffe81a63c82d3de5fbaa9991fd5f30034a452/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts#L705-L951
[t3-ca-mcp]: https://github.com/pingdotgg/t3code/blob/bf8ffe81a63c82d3de5fbaa9991fd5f30034a452/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts#L738-L742
[t3-ca-thinking]: https://github.com/pingdotgg/t3code/blob/bf8ffe81a63c82d3de5fbaa9991fd5f30034a452/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts#L1029-L1042
[t3-ca-opts]: https://github.com/pingdotgg/t3code/blob/bf8ffe81a63c82d3de5fbaa9991fd5f30034a452/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts#L1058-L1178
[t3-ca-modes]: https://github.com/pingdotgg/t3code/blob/bf8ffe81a63c82d3de5fbaa9991fd5f30034a452/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts#L1773-L1820
[t3-ca-decision]: https://github.com/pingdotgg/t3code/blob/bf8ffe81a63c82d3de5fbaa9991fd5f30034a452/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts#L2523-L2576
[t3-ca-result]: https://github.com/pingdotgg/t3code/blob/bf8ffe81a63c82d3de5fbaa9991fd5f30034a452/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts#L2657-L2690
[t3-ca-stream]: https://github.com/pingdotgg/t3code/blob/bf8ffe81a63c82d3de5fbaa9991fd5f30034a452/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts#L6927-L6973
[t3-ca-open]: https://github.com/pingdotgg/t3code/blob/bf8ffe81a63c82d3de5fbaa9991fd5f30034a452/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts#L8436-L8680
[t3-ca-resume]: https://github.com/pingdotgg/t3code/blob/bf8ffe81a63c82d3de5fbaa9991fd5f30034a452/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts#L8533-L8542
[t3-ca-interrupt]: https://github.com/pingdotgg/t3code/blob/bf8ffe81a63c82d3de5fbaa9991fd5f30034a452/apps/server/src/orchestration-v2/Adapters/ClaudeAdapterV2.ts#L8915-L9008
