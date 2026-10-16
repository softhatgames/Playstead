# T3 Code's toolchain on macOS and Windows

- **Question:** How well does T3 Code's toolchain work on macOS and Windows, and what does T3 Code itself say about developing and running on Windows? Asked in [#5][i5], a child of the map [#1][i1]. The findings become the checklist for [#6][i6] and feed [#8][i8].
- **Date:** 2026-10-16. All sources were accessed on this date.
- **Versions examined:** T3 Code at [`2577baf`][t3] (2026-10-15), read from the reference clone. Pins come from its root `package.json`, the `catalog` in `pnpm-workspace.yaml`, and `pnpm-lock.yaml` (§1).
- **Sources:** each tool's documentation, release notes, npm registry metadata and issue tracker; T3 Code's repository, issues and GitHub Actions runs; OpenAI's and Anthropic's documentation.
- **Local evidence:** none. Nothing was installed, built or run, and no Windows machine was used; T3 Code was only read.

Labels: **Documented** (official documentation, release notes, registry metadata or issue trackers), **Source** (T3 Code at `2577baf`), **Observed** (T3 Code's own CI runs), **Inference** (reasoning, not a source) and **Unconfirmed** (not established).

## Summary for Playstead

- **The tools ship for Windows; T3 Code does not test on it.** Every tool in the chain publishes Windows x64 and ARM64 builds at T3 Code's pins (§1). T3 Code ships signed x64 and ARM64 Windows installers, and its desktop app runs its server natively on Windows by default. But its CI lints, typechecks and tests on Ubuntu only, and its Windows test lane is manual and "not a required gate" (§3).
- **"Nothing passes on Windows yet" is out of date, but there is no recent proof either.** The lane's first run on 2026-09-04 failed 213 of 3,624 server tests, nearly all on Unix-only test fixtures. A stack of fixes made the whole suite pass on Windows the same day. No whole-suite Windows run has happened since, new Windows-only failures are known, and the maintainers treat them as low-priority test maintenance (§3).
- **Running from source on Windows x64 needs Git, Vite+ and Python, and no compiler.** `vp` supplies Node 24 and pnpm 11.10.0 from the repository's own declarations. Native npm modules, node-pty included, ship Windows binaries, and the Rust resource monitor is optional in development. Python is needed because T3 Code's Electron download step extracts the archive with `python3` on Windows, an undocumented prerequisite. Visual Studio Build Tools, Spectre-mitigated libraries and Rust are needed only for installers (§3).
- **Most Windows hazards sit in the tools** (§2):
  - Defender flags Vite+'s global shims as a trojan, and its installer may not add `vp` to `PATH`.
  - Smart App Control blocks unsigned oxlint and Rolldown bindings.
  - Vitest fails every file when the working folder's drive letter is lower case.
  - Electron 44 and T3 Code have open reports of crashes at launch in the GPU sandbox.
  - The pnpm pin lacks later Windows fixes.
- **The pins are young, and Node 24 is ageing.** tsc-rs is nine days old and calls itself experimental. Vite+ 1.0.0 is three minor versions behind. Node 24 enters maintenance on 2026-10-20 and Node 26 becomes LTS on 2026-10-28, which T3 Code's `engines` field rejects (§1–2).
- **Windows on ARM is the weak platform.** Node.js and Vite+ rate it Tier 2, and few tools test it (§1–2).
- **Codex and Claude install natively without administrator rights**, and T3 Code finds them through `PATH`, `PATHEXT` and a list of known folders (§4). Claude's installer leaves `PATH` alone, though T3 Code still finds it, and a terminal or app started before an install keeps the old `PATH`. Claude has no sandbox on native Windows; Codex's needs a one-off administrator-approved setup or a recent Windows 11 build.
- **§5 lists what threatens the first slice on Windows; §6 is the checklist for #6.**

## 1. Pinned versions

Pins are Source: the root `package.json`, the `catalog` in `pnpm-workspace.yaml`, and the lockfile ([pkg], [ws], [lock]). Dates and latest versions are Documented, from the npm registry and release pages.

| Tool | Pin at `2577baf` | Pin released | Latest on 2026-10-16 | Windows x64 / ARM64 builds | Windows in the tool's own CI |
| --- | --- | --- | --- | --- | --- |
| Vite+ (`vp`) | `vite-plus` 1.0.0 | 2026-09-28 | 1.3.0 | Yes / yes (Tier 1 / Tier 2) | x64 on every pull request; ARM64 only when the installer changes |
| oxlint | 1.85.0, through Vite+ | 2026-09-21 | 1.88.0 | Yes / yes | On `main` only |
| oxfmt | 0.70.0, through Vite+ | 2026-09-21 | 0.73.0 | Yes / yes | On `main` only |
| `@effect/tsgo` | 0.51.1, with TypeScript 7.0.2 | 2026-10-07 | 0.53.1 | Yes / yes | None; cross-compiled on Ubuntu |
| knip | 6.34.0 | 2026-08-31 | 6.41.0 | JavaScript; native parts yes / yes | Smoke tests on Node 20 and 22; full tests under Bun |
| tsc-rs | 0.7.0 | 2026-10-14 | 0.7.0 | Yes / yes, since 0.3.0 | x64 tests; ARM64 built natively |
| pnpm | 11.10.0 (`packageManager`) | 2026-07-04 | 11.28.6; npm's `latest` is 12.11.2 | Yes / yes | Not examined |
| Node.js | `^24.13.1` (`engines`) | — | 24.22.0 (2026-10-14) | Yes / yes (Tier 1 / Tier 2) | Not examined |
| Electron | 44.4.5 | 2026-09-23 | 44.8.0 | Yes / yes; 32-bit dropped in 44 | Not examined |
| electron-builder | 26.15.6 | — | Not examined | NSIS installers | Not examined |

## 2. The tools on macOS and Windows

macOS is the better-covered platform: every tool below publishes Apple silicon and Intel builds, and the Vite+ and tsc-rs projects test on macOS in CI ([vp-ci-mac], [tscrs-ci-mac]). The rest of this section is about Windows.

### Vite+ (`vp`)

- **What it is (Documented).** VoidZero's single toolchain: Vite, Vitest, Oxlint, Oxfmt, Rolldown, tsdown and a task runner ([vp-guide]). 1.0.0 bundles Vitest 5.0.1, oxlint 1.85.0 and oxfmt 0.70.0 ([vp-1.0.0]), and needs Node `^22.18.0 || ^24.11.0 || >=26.0.0` (Source, lockfile).
- **Platforms (Documented).** Prebuilt binaries follow Node.js's tiers: Windows x64, macOS x64 and macOS arm64 are Tier 1; Windows arm64 is Tier 2 ([vp-guide]). Its CI tests Windows x64; ARM64 is smoke-tested only when installer files change ([vp-ci], [vp-ci-arm]).
- **Install (Documented).** The global CLI installs with `irm https://vite.plus/ps1 | iex`, or `vp-setup.exe`, which "is not yet code-signed" ([vp-guide-src]). On Windows its commands live in `%LOCALAPPDATA%\vite-plus\bin` ([vp-global]). It can manage Node.js and the package manager: it reads `engines.node` and downloads the pnpm named in `packageManager` ([vp-env], [vp-pm]). A repository with `vite-plus` as a devDependency also runs through `pnpm run` without the global CLI ([vp-local]).
- **`vp check` (Documented).** Runs Oxfmt, Oxlint and, only when `typeAware` and `typeCheck` are both on, type checks ([vp-check]). They are off in T3 Code.
- **Open Windows issues (Documented).**
  - Defender flags the global CLI's shim executables as `Trojan:Win32/Wacatac.B!ml` ([vp-2866]).
  - The 1.1.0 PowerShell installer does not add `vite-plus\bin` to the user `PATH`, so `vp` is "not recognized" ([vp-2984]).
  - `vp build` fails when the project root is reached through an NTFS junction ([vp-1374]).
  - `vp lint` and `vp fmt` can run an oxlint or oxfmt from a parent folder's `node_modules`, such as `D:\node_modules`, instead of the bundled one ([vp-3065]).
  - Task-runner caching bugs on Windows, such as [vite-task#830][vt-830], should not affect T3 Code, whose tasks set `cache: false` ([server-vite], [vp-cache]).
- **Fixed after the pin (Documented).** One Ctrl+C left `cmd.exe` at "Terminate batch job (Y/N)?" until 1.1.0 ([vp-1.1.0]). 1.3.0 was published on 2026-10-16.
- **Vitest (Documented).** With a lower-case drive letter in the working folder (`c:\`), every test file can fail with "Vitest failed to find the current suite"; both reports are open ([vitest-10692], [vitest-10812]).

### oxlint and oxfmt

- **Builds (Documented).** Both publish `win32-x64`, `win32-arm64` and `win32-ia32` bindings at the pinned versions ([npm-oxlint], [npm-oxfmt]). Their Windows CI jobs run on `main` only, not on pull requests ([oxc-ci]).
- **JavaScript plugins (Documented, Source).** They are still "alpha" ([oxc-jsplugins]). T3 Code loads `./oxlint-plugin-t3code/index.ts` and `@shadcn/lint` ([vite-jsplugins]); `.ts` plugins load through Node's type stripping ([oxc-14009]). Windows plugin-loading failures and a Windows allocator panic were fixed before the pin ([oxc-14375], [oxc-19395]).
- **Unsigned bindings (Documented).** Smart App Control blocks the unsigned oxlint binding with "Cannot find native binding" ([oxc-27486]), and Rolldown's binding has the same open report ([rolldown-10801]).
- **Line endings (Documented).** oxfmt has no automatic line-ending mode and defaults to `lf` ([oxfmt-config], [oxc-17856]). T3 Code's `.gitattributes` exists for this (§3).
- **Type-aware linting** through tsgolint is off in T3 Code ([vite-typeaware]), so tsgolint's unsigned Windows executable ([tsgolint-876]) does not matter yet.

### @effect/tsgo and TypeScript 7

- **What the prepare step does (Documented).** `effect-tsgo patch` with no flags patches only TypeScript 7's native compiler: it renames the platform `tsc` in `@typescript/typescript-<os>-<arch>` and copies in Effect's build from `@effect/tsgo-<os>-<arch>` ([tsgo-flags], [tsgo-discovery], [tsgo-patcher]). It handles `win32` x64 and arm64.
- **Version lock (Documented).** A TypeScript version the patcher does not support is an error, which fails `prepare` and so the install ([tsgo-patcher]). Vite+ 1.2.0's notes tell @effect/tsgo users to stay on Vite+ 1.1.0, because the patch step fails with oxlint 1.88.0 ([vp-1.2.0]). **Inference:** that failure concerns @effect/tsgo's oxlint integration, which T3 Code's flag-less patch does not use, so it may not hold T3 Code back.
- **Windows testing (Documented).** No Windows CI: validation runs on Ubuntu, and the Windows binary is cross-compiled there ([tsgo-validate], [tsgo-release]).

### knip

- **Builds (Documented).** knip is JavaScript; its native parser and resolver publish Windows bindings. Its CI runs Windows smoke tests on Node 20 and 22 and full tests under Bun; the Node 24 lane is Ubuntu only ([knip-ci]).
- **Memory (Documented).** "On machines with low RAM or Windows with Node.js >=22, oxc-parser raw transfer may fail under memory pressure"; set `KNIP_DISABLE_RAW_TRANSFER=1` ([knip-known], [knip-1813]).

### tsc-rs

- **What it is (Documented).** "An experimental Rust port of the TypeScript 7 compiler (tsc)" from pingdotgg, T3 Code's own organisation, with Effect diagnostics ported from @effect/tsgo. Its README says "**This is an early release.**" and "I've never read a line of this code." ([tscrs-readme]).
- **Windows (Documented).** Windows x64 and ARM64 builds ship from 0.3.0 (2026-10-11) ([tscrs-0.3.0]). CI tests Windows x64, including Windows path forms, CRLF sources and a junction, and builds ARM64 natively ([tscrs-ci]).

### pnpm 11

- **Support (Documented).** pnpm supports Windows and uses junctions when Developer Mode is off ([pnpm-faq]). 11.10.0 needs Node 22.13 or newer ([npm-pnpm]).
- **The pin always wins (Documented).** pnpm 11's `pmOnFail` defaults to `download`: "download and run the declared pnpm version" ([pnpm-pmonfail]). Any global pnpm therefore hands over to 11.10.0 inside T3 Code, and `vp` downloads the same version ([vp-pm]).
- **Engines (Documented).** "installation will always fail if a project (not a dependency) specifies an incompatible version in its engines field" ([pnpm-engine]). T3 Code's `^24.13.1` therefore rejects Node 22, 25 and 26.
- **11.0 changes T3 Code relies on (Documented).** `allowBuilds` replaces `onlyBuiltDependencies`, `minimumReleaseAge` defaults to one day ([pnpm-11.0.0]), and on Windows `virtualStoreDirMaxLength` defaults to 60 to keep paths short ([pnpm-nm]).
- **Windows fixes the pin lacks (Documented).** 11.28.0 reinstalls a project moved together with its junctioned `node_modules` ([pnpm-11.28.0]). 11.28.1 stops `pnpm run` expanding `%VAR%` and doubling backslashes in arguments, and keeps a `%` in the project path intact in `.cmd` shims ([pnpm-11.28.1]).
- **Installing pnpm itself (Documented).** Not needed with `vp`. The 11.x docs recommend npm on Windows because "Windows Defender may block our executable" otherwise ([pnpm-install-11]). Corepack still ships with Node 24, as experimental, and is gone from Node 25 ([node-corepack]).

### Node.js 24

- **Release line (Documented).** Node 24 is Active LTS until 2026-10-20, then Maintenance LTS until 2028-04-30; Node 26 becomes LTS on 2026-10-28 ([node-schedule]). The newest 24.x is 24.22.0 ([node-dist]).
- **Windows (Documented).** x64 is Tier 1 on "Windows 10/Server 2016" and newer; ARM64 is Tier 2 ([node-building]). Node "does not support running on End-of-Life (EoL) platforms" ([node-building]), and Windows 10 Home and Pro left support on 2025-10-14 ([win10-eol]). There is no 32-bit build, and nodejs.org offers an MSI and a zip but no WinGet command ([node-download]).
- **Running `.ts` directly (Documented).** Type stripping is on by default, has printed no warning since 24.3.0 and became stable in 24.12.0 ([node-ts]). `node scripts/dev-runner.ts` needs no flags on `^24.13.1`.
- **`.cmd` files (Documented).** Since the April 2024 security releases, spawning a `.bat` or `.cmd` without `shell` fails with `EINVAL` ([node-cve]). Passing arguments with `shell: true` is runtime deprecation DEP0190 in Node 24 ([node-dep0190]). T3 Code handles both (§4).

### Electron 44 and electron-builder

- **Release line (Documented).** 44.0.0 shipped on 2026-08-25 and is supported until 2027-03-02. 44.8.0 is the newest, and 45.0.0 is due on 2026-10-20 ([electron-schedule]).
- **Windows (Documented).** Windows 10 and later, x64 and ARM64; Electron 44 dropped 32-bit Windows ([electron-readme], [electron-breaking]).
- **No download at install (Documented, Source).** The `electron` package "no longer downloads itself via `postinstall` script"; it downloads on first run, or through `npx install-electron --no` ([electron-breaking]). T3 Code's launcher runs its own repair first: it downloads the zip with `curl` and, on Windows, extracts it with `python3` ([ensure-electron], [electron-launcher]). Where `python3` is the Microsoft Store alias, extraction exits 9009 and `dev:desktop` cannot start; a fix was closed unmerged ([t3-10551]).
- **Crashes at launch (Documented).** T3 Code's #5236 reports the desktop app crashing on Windows in the Chromium GPU sandbox, with exit code 0x80000003; `--disable-gpu-sandbox` avoids it ([t3-5236]). Electron has open reports of the same exit code at start-up on Windows 11 with 44.x, and of crashes when indirect display drivers are present ([electron-54614], [electron-54552]). 44.5.0 fixed a GPU-process crash at start-up when another instance shares the session data folder, and a Windows-on-ARM crash; the pin predates both ([electron-44.5.0]).
- **Installers (Documented, Source).** electron-builder warns "Don't expect that you can build an app for all platforms on one platform" ([eb-multi]). T3 Code builds Windows installers on Windows, with `npmRebuild` off and every `.node` and `.dll` signed ([build-artifact]).

### Native modules

- **All ship Windows binaries (Documented, Source).** node-pty 1.2.0-beta.15 carries `win32-x64` and `win32-arm64` prebuilds in its package and builds from source only when they are missing ([npm-node-pty], [rel-spectre]). sharp, esbuild, tsc-rs, `@napi-rs/keyring`, `ffi-rs`, `@crowecawcaw/xa11y` and `@ff-labs/fff-node` have `win32-x64` and `win32-arm64` packages in the lockfile ([lock]). `msgpackr-extract` is listed in `allowBuilds` but is not in the lockfile.
- **No Electron rebuild (Documented).** All are Node-API addons or plain executables, and Node-API is ABI-stable ([node-napi]), so none needs `electron-rebuild`.
- **node-pty from source (Documented).** Building it needs Python, a C++ compiler, the Windows SDK and Spectre-mitigated libraries ([npm-node-pty], [node-pty-957]). Its open Windows issues include terminals killed before their first write on beta.15 ([node-pty-955]). They concern T3 Code's terminal, which Playstead does not follow.

## 3. What T3 Code says about Windows

### Development guide and CI

- **One flow for every platform (Source).** The guide asks for the global `vp` from the README, says "The checkout requires Node 24; Bun is optional", then runs `vp i` and `vp run dev`, or `vp run dev:desktop` for the Electron client ([dev]). The README's Windows command is `irm https://vite.plus/ps1 | iex` ([t3-readme]). Development has no Windows-specific section.
- **Checks (Source).** The guide runs `vp test run <files>`, `vp lint <files>` and `vp run --filter <package> typecheck`. Workspaces typecheck with tsc-rs; `typescript`, `@effect/tsgo` and the `effect-tsgo patch` prepare step stay for editors ([dev-checks]). CI runs `vp check`, which is oxfmt and oxlint here because T3 Code turns type-aware linting off, and `vpr typecheck` ([ci-lint], [ci-tc], [vite-typeaware], [vp-check]).
- **Windows is not a gate (Source).** The guide calls the Windows lane "available for focused Windows investigation while that suite is not a required gate" ([dev-checks]). Every CI job that tests, lints, typechecks or builds runs on Ubuntu; the one macOS job checks mobile native sources ([ci]). Windows runners are used by the release jobs, which build the x64 and ARM64 NSIS installers on hardware of their own architecture ([rel-targets], [rel-desktop]).
- **Install time (Source).** On T3 Code's Windows release runners a plain install "took 142-210s and 84-160s" on ARM64 and x64; linking, not downloading, takes the time ([rel-install]).
- **Agents are told not to run whole-repository checks (Source).** "No `vp check`, no `vp run -r test`, no `vp run -r typecheck` unless I ask. CI owns the full suite" ([t3-agents]). #6 needs exactly those runs, so its checklist asks for them.

### Running from source: no compiler, but Python

- **Build steps (Source).** The server's `build` task runs `node scripts/cli.ts build`, which bundles with `vp pack` ([server-vite]). The desktop `dev` task runs two Node scripts and `vp pack --watch`, after the server build ([desktop-vite]). The browser-secret helper compiles only on Linux ([browser-secret]).
- **The Rust monitor is optional in development (Source).** Development looks for `native/resource-monitor/target/release` or `target/debug`. Without the executable the server runs without native process telemetry ([desk-rm], [telemetry]).
- **SQLite is built into Node (Source).** The server uses `node:sqlite` and requires "Node.js >=22.16, >=23.11, or >=24" ([sqlite-req]).
- **Native npm modules (Source).** T3 Code's release workflow says of the Spectre-mitigated libraries: "Only the resource monitor build needs these libraries. … node-pty ships prebuilt Windows binaries" ([rel-spectre]). §2 lists the rest.
- **Python and curl for Electron (Source).** Electron's binary is fetched by T3 Code's repair script, which on Windows extracts it with `python3` (§2). Neither the development guide nor the README mentions this.
- **Inference:** Git, Vite+ and Python are enough to install and run T3 Code from source on Windows x64. Visual Studio Build Tools, Spectre-mitigated libraries and Rust are needed only for the resource monitor and installers.

### The Windows test lane

- **What it does (Source).** It runs only when started by hand, on a `blacksmith-8vcpu-windows-2025` runner with a 45-minute limit. It checks out without `/.repos/`, and sets up Vite+ with Node from `package.json` and with setup-vp's cache off, because it "restores a Linux-shaped store on Windows". Then it runs `vp install` and `ensure:electron`. Finally it tests every package except the server, one named package, or named files ([wt]).
- **Why nothing passed at first (Documented, Observed).** The lane was added on 2026-09-04 in #9538, whose description says "The test suite has never run on Windows, and there is no Windows CI" ([t3-9538]). Its first `apps/server` run failed 36 of 281 test files and 213 of 3,624 tests ([run-first-server]). The log shows Unix assumptions in the tests and one in the product:
  - `spawn EFTYPE`, 67 times, from fake CLIs written as shell scripts;
  - `EPERM: operation not permitted, fsync` on directories, fixed in the product by #9569;
  - `C:\dev\null`.

  The desktop run failed 7 of 73 test files and `packages/shared` 2 of 49, on tests expecting `/`-separated paths ([run-first-desktop], [run-first-shared]).
- **Then everything passed (Observed, Source).** About 20 test-fix pull requests, numbered #9564 to #9589, landed on `main` that evening. Minutes before, runs at the head of their stack passed every non-server package and the server's 281 test files (3,713 tests passed, 50 skipped) ([run-green-server], [run-green-rest]). The workflow's header was never updated.
- **Since then (Observed, Documented).** No whole-suite Windows run has been made; later runs target single files ([wt-runs]). Known Windows failures include:
  - symlink tests without Developer Mode ([t3-19681]);
  - NTFS file IDs too large for JavaScript numbers in a scanner test ([t3-14838]);
  - a test file name containing `:` ([t3-15651]);
  - temporary-folder clean-up failing with `EBUSY` or `EPERM` ([run-ebusy]).
- **Maintainers' stance (Documented).** On #19681 a maintainer's bot replied that the symlink failures are "test-only maintenance, not a product bug", that a maintainer "will pick this up when test maintenance resumes", and that "Until then, enabling Developer Mode lets the suite run locally" ([t3-19681]). Outside Windows test fixes have been closed unmerged ([t3-18212]). The lane's Blacksmith runners do not exist on forks ([t3-11438]).

### Line endings

- **LF everywhere except batch files (Source).** `.gitattributes` sets `* text=auto eol=lf`, commented "git autocrlf=true converts LF to CRLF on Windows, causing issues with oxfmt", and `eol=crlf` for `*.cmd` and `*.bat` because "Batch files need CRLF for cmd.exe to parse them reliably" ([gattr]). It arrived in #1491 on 2026-03-28.
- **Git applies the attribute (Documented).** `eol=lf` "uses the same line endings in the working directory as in the index", and only when `eol` is unspecified do `core.autocrlf` or `core.eol` decide ([git-attr]). **Inference:** a Windows checkout gets LF whatever `core.autocrlf` says, and files created on Windows should be saved with LF.

### Rust resource monitor and installer prerequisites

- **Monitor (Source).** `native/resource-monitor` is a Rust 2024-edition crate on `sysinfo` 0.39.3, built with `vp run build:resource-monitor` (`cargo build --locked --release`) ([rm-cargo], [pkg]). It runs as its own process, which "isolates collector crashes and avoids a Node/Electron addon ABI matrix" ([telemetry]). No `rust-toolchain` file pins Rust; edition 2024 needs Rust 1.85.0 or newer ([rust-2024]).
- **Windows installer prerequisites (Source).** "Install Rust, Python 3, and Visual Studio Build Tools with **Desktop development with C++**. Include the Windows SDK and the MSVC build tools and Spectre-mitigated libraries for the target architecture", then `rustup target add x86_64-pc-windows-msvc` (or `aarch64-pc-windows-msvc`). "NSIS is downloaded by electron-builder." WSL support also needs the Linux CLI archive passed as `--wsl-runtime` ([dev-installer]). `vp run dist:desktop:win` builds an unsigned installer into `release/` ([dev-artifacts]).
- **Release checks (Source).** Releases are signed with Azure Trusted Signing when its secrets exist ([rel-signing]). The artifact builder rejects a Windows package without the Windows resource monitor, or with more than 80 unpacked files, among other checks ([rel-payload]).
- **Rust on Windows (Documented).** The MSVC toolchain needs Visual Studio's "Desktop Development with C++" workload, or the MSVC build tools and a Windows SDK; `rustup-init` offers to install Visual Studio Community ([rustup-msvc]).

### WSL backend and the native default

- **Native by default (Source).** Desktop defaults are `localEnvironmentEnabled: true`, `wslBackendEnabled: false`, `wslDistro: null` and `wslOnly: false` ([desk-settings]). On Windows the desktop app therefore runs its primary server natively. WSL is opt-in: choosing a distro in **Settings → Connections** adds a second backend there, and `wslOnly`, which needs a restart, makes it the only one ([install-wsl], [desk-settings]).
- **WSL from a packaged app (Source).** Windows builds ship `wsl-runtime.tar.gz`, the Linux CLI archive, which the app verifies and unpacks into `~/.t3/wsl-runtime/sha256-<digest>` inside the distro ([rel-payload]). Provider CLIs must be installed inside the distro ([install-wsl]). The WSL server listens on loopback, which WSL forwards to Windows ([wsl-port]).
- **WSL from source (Source).** Unpackaged builds run the checkout's `apps/server` with the distro's own Node. If the Linux node-pty binary does not load, they rebuild it with `npx --yes node-gyp rebuild`, which needs `node`, `make`, `g++` and `python3` in the distro ([wsl-allow], [wsl-tools], [wsl-build]).
- **No process telemetry under WSL (Source).** "Windows desktop packages currently supply only the Windows executable, so native process telemetry for the WSL backend is unavailable" ([telemetry-wsl]).

### The Electron dev launcher on Windows

- **No process clean-up (Source).** `dev-electron.mjs` returns early on Windows from `killChildTreeByPid`, `cleanupStaleDevApps` and `killChildTree`, which use `pkill` elsewhere ([dev-electron]). **Inference:** after stopping or restarting the dev app, leftover `electron.exe` or `node.exe` processes may hold ports or files.
- **node-pty under `node --watch` (Source).** T3 Code patches node-pty's Windows ConPTY helpers so that Node's watch mode, which the server's `dev` script uses, does not leak into their IPC ([pty-patch], [server-pkg]). This shows the server is run from source on Windows.

### T3 Code's open Windows issues

- **Count (Documented).** By our reading about 76 open issues are specific to Windows or WSL. There is no Windows label, and 362 open issues mention "windows" somewhere ([t3-search]). No statement of Windows support level was found; Windows is a shipped, signed target, and "We are not actively seeking outside contributions and have limited review capacity" ([t3-contributing]).
- **Running from source.**
  - [#19681][t3-19681]: symlink tests fail without Developer Mode.
  - [#14838][t3-14838]: NTFS file IDs break a scanner test.
  - [#18788][t3-18788]: OpenCode servers outlive a killed T3 server, so dev-watcher restarts leave them running.
  - [#7625][t3-7625]: `lint:mobile` skips its linters and exits 0 on Windows.
- **The desktop app, also hit by a source build where the bug is in shared code.**
  - [#5236][t3-5236]: crash at launch in the GPU sandbox.
  - [#12498][t3-12498]: an idle app floods the machine with `git`, `taskkill` and `conhost` processes.
  - [#12689][t3-12689]: typing lag from synchronous IPC.
  - [#4403][t3-4403]: PowerShell profile probing slows start-up.
  - [#15001][t3-15001]: after upgrading from the Alpha profile, projects and threads vanish.
  - [#14990][t3-14990]: removing a worktree follows junctions and deletes their targets with Git for Windows before 2.54.0.
- **Codex and Claude.**
  - [#7360][t3-7360]: an app started from the Start menu inherits a stale `PATH` and reports every CLI as not found.
  - [#7513][t3-7513]: the Codex probe passes its 10-second timeout about one run in four.
  - [#14325][t3-14325]: **Connect with ChatGPT** needs Developer Mode for its symlinks; the plain `codex` login instance is unaffected.
  - [#13303][t3-13303]: onboarding's Codex install fails inside OpenAI's `install.ps1`.
  - [#8051][t3-8051]: an npm `codex.cmd` whose optional Windows binary is missing.
  - [#19510][t3-19510]: Claude's **Update now** fails for WinGet installs.
- **WSL.** About 20 open issues, such as WSL-only mode hanging without `libatomic1` ([t3-14393]).

## 4. Codex and Claude on Windows

The v0 notes cover how each provider behaves on Windows once running: [Codex App Server §11](codex-app-server.md#11-codex-on-windows) and [Claude Agent SDK §11](claude-agent-sdk.md#11-windows). This section covers installing, signing in and how T3 Code finds them. OpenAI's `developers.openai.com/codex/*` pages now redirect to `learn.chatgpt.com/docs/*`, which the links below use.

### Codex CLI

- **Versions (Documented).** The latest release is 0.163.0, published 2026-10-15 ([codex-rel]). T3 Code supports 0.156.0 and newer (see below).
- **Install (Documented).** OpenAI's README gives `powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"` for Windows, or `npm install -g @openai/codex` ([codex-readme]). The docs print no WinGet command. WinGet's `OpenAI.Codex` package exists, but its newest manifest is 0.161.0 ([winget-codex]). The ChatGPT desktop app for Windows also runs Codex, and "By default, the ChatGPT desktop app uses the Windows-native Codex agent" ([codex-win-app]).
- **Requirements (Documented).** Windows 11 is "Recommended"; fully updated Windows 10 is "Best effort", and "In practice, Windows 10 version 1809 or newer is required" ([codex-win]). The installer stops on 32-bit Windows ([codex-ps1]).
- **Where it lands (Documented).** The standalone installer puts `codex.exe` in `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin` by default ([codex-env]). It adds that folder to the user `PATH`, printing "PATH updated for future PowerShell sessions", and asks you to open a new PowerShell window ([codex-ps1]). **Inference:** the npm route puts npm's `codex.cmd` shim on `PATH`, which T3 Code runs through `cmd.exe`.
- **Native or WSL (Documented).** "Use the native Windows sandbox by default. Choose WSL when you need Linux-native tooling…"; WSL 1 is unsupported from 0.115 ([codex-win], [codex-wsl]). The sandbox modes are covered in the v0 note.
- **Sign in (Documented).** Run `codex` and choose **Sign in with ChatGPT** ([codex-readme]), or run `codex login` and complete the browser flow. `codex login --device-auth` is a beta alternative, and `codex login status` shows the active method. Credentials are cached in `auth.json` under `CODEX_HOME`, which defaults to `~/.codex`, or in the OS credential store ([codex-auth-doc], [codex-env]).

### Claude Code

- **Versions (Documented).** npm's `latest` tag is 2.1.301 and `stable` is 2.1.292 ([npm-claude]); WinGet's newest manifest is 2.1.296 ([winget-claude]). T3 Code supports 2.1.280 and newer.
- **Install (Documented).** In PowerShell, `irm https://claude.ai/install.ps1 | iex`; in CMD, `curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd`; or `winget install Anthropic.ClaudeCode`, which does not auto-update. `npm install -g @anthropic-ai/claude-code` needs Node.js 22 or later ([claude-setup]).
- **Requirements (Documented).** Windows 10 1809+ or Windows Server 2019+, 4 GB of memory, x64 or ARM64; no administrator rights. Git for Windows is optional: it provides Git Bash for the Bash and Monitor tools, and without it Claude Code uses the PowerShell tool ([claude-setup]).
- **Where it lands (Documented).** The native installer places `%USERPROFILE%\.local\bin\claude.exe`. It "prints the fix with that note but doesn't change PATH itself"; the documented fix appends `%USERPROFILE%\.local\bin` to the user `PATH` with `[Environment]::SetEnvironmentVariable`, then a new terminal ([claude-path]).
- **Native or WSL (Documented).** Sandboxing is "Not supported" on native Windows; it needs WSL 2 ([claude-setup]).
- **Sign in (Documented).** It needs a Pro, Max, Team, Enterprise or Console account; the free plan has no Claude Code. Run `claude` and follow the browser prompts, or `claude auth login` (`--console` for API billing). `claude auth status` prints JSON and "Exits with code 0 if logged in, 1 if not". An `ANTHROPIC_API_KEY` that you approve replaces the login ([claude-setup], [claude-cli]).

### How T3 Code finds and checks them

- **Executable lookup (Source).** On Windows, `resolveSpawnCommand` searches `PATH` with `PATHEXT`. A `.cmd` or `.bat` result runs through `cmd.exe` with an escaped command line, to avoid Node's DEP0190 warning ([shell-spawn], [shell-pathext]).
- **Extra folders (Source).** Both the server and the desktop add `%APPDATA%\npm`, `%LOCALAPPDATA%\Programs\nodejs`, `%LOCALAPPDATA%\Volta\bin`, `%LOCALAPPDATA%\pnpm`, `%USERPROFILE%\.local\bin`, `%USERPROFILE%\.bun\bin` and `%USERPROFILE%\scoop\shims` ([shell-dirs], [desk-dirs]). At start the desktop reads `PATH` from PowerShell 7 or Windows PowerShell, with and without the profile, and merges it with these folders and its own environment ([desk-pwsh], [desk-merge]). WinGet's links folder is not in the list (Source), so a WinGet install is found only through `PATH`.
- **"Not installed" (Source).** Exit code 9009, or cmd.exe's "is not recognized as an internal or external command" in six languages, becomes `ProviderCommandNotFoundError` ([probe-patterns], [probe-spawn]). A provider CLI must be on the server's `PATH`, or its **Binary path** set in provider settings ([install-path]).
- **Claude (Source).** The Agent SDK spawns without a shell, so T3 Code resolves `claude` to a full path. An npm `claude.cmd`, `.bat` or `.ps1` shim is replaced by `node_modules\@anthropic-ai\claude-code\bin\claude.exe`, or `cli.js`, beside it ([claude-exe]). The status check runs `claude --version`, then reads sign-in from the SDK; signed out, it says "Claude Code is not authenticated. Run `claude auth login` and try again." ([claude-version], [claude-auth]).
- **Codex (Source).** The status check starts `codex app-server` and sends `account/read`; signed out, it says "Codex CLI is not authenticated. Run `codex login` and try again." ([codex-probe], [codex-account], [codex-auth]). **Connect with ChatGPT** instead installs a Codex managed by T3 Code, `rust-v0.156.1` for `win32-x64` or `win32-arm64` ([codex-managed], [t3-codex-doc]).
- **Versions (Source).** For this release Codex is supported from 0.156.0 and recommended from 0.159.0; 0.149.x–0.155.x are unsupported and older versions broken. Claude Code is supported and recommended from 2.1.280; 2.1.111–2.1.279 degrade gracefully ([compat]).

## 5. Risks to the first slice on Windows

These are Inferences from the sections above unless marked.

**Could block the slice**

1. **No upstream Windows gate.** T3 Code does not test on Windows in CI, has not run its whole suite on Windows since 2026-09-04, and declines outside Windows test fixes (§3). Anything Playstead adopts can break on Windows without notice. Playstead needs its own Windows x64 CI from the first slice; T3 Code's lane cannot simply be borrowed, because its runners exist only in pingdotgg.
2. **Electron crashing at launch.** T3 Code's #5236 and Electron's #54614 and #54552 are open, and the Electron pin predates later 44.x fixes (§2). If the founder's Windows machine is affected, the desktop app does not open. #6 will show whether it is.
3. **Security software.** Defender flags Vite+'s shims and Smart App Control blocks unsigned oxlint and Rolldown bindings (§2), so development may not start on a locked-down machine. For the packaged app, T3 Code signs every shipped `.node` and `.dll`, because Smart App Control can block unsigned native files ([build-artifact], [t3-8206]). Playstead's installer needs the same signing.

**Manageable with known steps**

4. **Undocumented prerequisites.** Development also needs:
   - Python, for the Electron download (§2);
   - Developer Mode, for symlink tests and **Connect with ChatGPT** ([t3-19681], [t3-14325]);
   - an upper-case drive letter, for Vitest ([vitest-10692]);
   - Node 24 rather than the coming LTS, Node 26 (§2).

   Playstead's own setup should state these, or remove them.
5. **Provider discovery.** A stale `PATH` hides installed CLIs from an app started before the install or from the Start menu ([t3-7360]). Claude's installer leaves `PATH` alone, and Codex's install folder is not on T3 Code's known list (§4). Restarting from a new terminal, or setting **Binary path**, avoids it.
6. **Agent safety on Windows.** Claude has no sandbox on native Windows, and Codex's needs an elevated setup or Windows 11 24H2 or later (§4 and the v0 notes). The first slice uses T3 Code's default, Full access, so this does not block it. It limits any safer default on Windows.
7. **Young pins moving in lockstep.** tsc-rs is experimental. @effect/tsgo fails the install on an unsupported TypeScript version, so TypeScript, @effect/tsgo and tsc-rs move together. The pnpm, Electron and node-pty pins miss later Windows fixes (§2). Upgrades will need care and a Windows run.
8. **Line endings.** T3 Code keeps LF only through `.gitattributes`; Playstead must copy the rule (§3).
9. **Windows on ARM.** It is Tier 2 for Node.js and Vite+ and lightly tested elsewhere (§1). Treat it as best effort until #6 or a later run covers it.
10. **Installers need a Windows build machine.** That machine needs Visual Studio Build Tools, the Windows SDK, Spectre-mitigated libraries, Python and Rust. T3 Code builds on runners of each target architecture (§3).

## 6. Checklist for #6: run T3 Code from source on Windows

Use a fully updated Windows 11 x64 machine and PowerShell, as a normal user. Windows on ARM is Tier 2 for Node.js and Vite+, so treat it as an optional second run. Note how long each step takes, and save long output with `Tee-Object`.

- [ ] **0. Prepare the machine.**
  - Turn on Developer Mode: **Settings › System › Advanced › For developers** (before Windows 11 25H2, **Settings › System › For developers**). It needs administrator access once ([ms-devmode]). T3 Code's maintainers say it "lets the suite run locally" ([t3-19681]), and Codex's **Connect with ChatGPT** needs it ([t3-14325]).
  - Type paths with an upper-case drive letter (`C:\src`), because Vitest fails with `c:\` ([vitest-10692]).
  - Record Windows edition, version, build and architecture (`winver`), the CPU and memory, and whether Smart App Control and Defender real-time protection are on.
- [ ] **1. Install the prerequisites.**

  ```powershell
  winget install --id Git.Git -e --source winget
  winget install 9NQ7512CXL7T -e --accept-package-agreements --disable-interactivity
  $env:VP_NODE_MANAGER = "yes"
  irm https://vite.plus/ps1 | iex
  ```

  - **Git for Windows** must be 2.54.0 or newer ([t3-14990]). The WinGet package is "not maintained by the Git for Windows project", so use the git-scm.com installer if it lags ([git-win]).
  - **The Python install manager** provides `python3` ([py-win]), which T3 Code's Electron step runs ([ensure-electron]).
  - **Vite+**, set to manage Node.js ([vp-global]). It reads `engines.node` and fetches pnpm 11.10.0 itself ([vp-env], [vp-pm]). Do not install Node.js or pnpm separately.
  - **Not needed:** Visual Studio Build Tools, Rust.
  - Open a new PowerShell window, then check `git --version`, `python3 --version` and `vp --version`.
  - If `vp` is not recognised, add its folder to the user `PATH` ([vp-2984], [vp-global]) and open another window:

    ```powershell
    $userPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
    [Environment]::SetEnvironmentVariable('PATH', "$userPath;$env:LOCALAPPDATA\vite-plus\bin", 'User')
    ```

  - If Defender quarantines `vp.exe` or its shims, record the detection name before deciding anything ([vp-2866]).
- [ ] **2. Clone T3 Code at `2577baf`.**

  ```powershell
  New-Item -ItemType Directory -Force C:\src | Out-Null
  Set-Location C:\src
  git clone --filter=blob:none --no-checkout https://github.com/pingdotgg/t3code.git
  Set-Location C:\src\t3code
  git checkout --detach 2577baf8b0dc541283fa93d6919b0e354effadf4
  git log -1 --format="%H %cI %s"
  git status --short
  ```

  - **Why `2577baf`.**
    - It is Playstead's reference commit ([t3-rules]) and the one this note read.
    - It is 76 commits past the v0.1.0 tag and includes the Windows fixes of 2026-10-15 ([t3-19965], [t3-19966], [t3-20162]).
    - On 2026-10-16, `main` was only two commits ahead, and neither touches Windows or the toolchain ([t3-compare]).
  - **If #6 runs much later,** run `git fetch origin main` and `git log --oneline 2577baf..origin/main -i --grep=windows`. Move to a newer commit only for a Windows fix that #6 needs, and record which commit you used.
  - **Keep the path short and free of `%`.** The deepest tracked path is 182 characters (Source), and pnpm 11.10.0 mangles a `%` in the project path ([pnpm-11.28.1]). If Git reports "Filename too long", run `git config --global core.longpaths true` ([gfw-longpaths]).
  - **`git status --short` should print nothing,** because `.gitattributes` keeps LF ([gattr]).
- [ ] **3. Install dependencies.**

  ```powershell
  vp env install
  node --version
  vp i --frozen-lockfile
  vp run --filter "@t3tools/desktop" ensure:electron
  git status --short
  ```

  - `node --version` must print 24.13.1 or a later 24.x ([pkg], [vp-env]).
  - Record the install time (84–160 s on T3 Code's x64 Windows runners, [rel-install]), warnings, and any failure in the `prepare` step (`effect-tsgo patch && vp config --no-agent`) or in a build script.
  - `ensure:electron` downloads Electron 44.4.5 with `curl` and extracts it with `python3` ([ensure-electron]). Exit code 9009 means `python3` is still the Microsoft Store alias ([t3-10551]).
- [ ] **4. Start the desktop app in development.**

  ```powershell
  vp run dev:desktop
  ```

  - Expect `[dev-runner]` lines with ports, then the window. Development state goes to `~/.t3/dev/userdata`, never the live `~/.t3/userdata` ([dev-state]).
  - Record the time to the window, any Windows Defender Firewall prompt, and errors. Without Rust the resource monitor is absent, so diagnostics lack process telemetry; that is expected ([desk-rm]).
  - If Electron exits with 0x80000003 before a window appears, record it against [#5236][t3-5236].
  - After Ctrl+C, run `Get-Process electron, node -ErrorAction SilentlyContinue` and record any leftovers; the dev launcher does not clean up on Windows ([dev-electron]).
- [ ] **5. Install and sign in to Codex and Claude, then check that T3 Code shows them.**

  ```powershell
  powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"
  irm https://claude.ai/install.ps1 | iex
  ```

  Then, in a new PowerShell window:

  ```powershell
  codex --version
  codex login
  codex login status
  claude --version
  claude auth login
  claude auth status
  ```

  - **Versions.** Codex 0.159.0 or newer and Claude Code 2.1.280 or newer ([compat]).
  - **Accounts.** Sign in to Codex with ChatGPT, and to Claude with a Pro, Max, Team, Enterprise or Console account ([codex-readme], [claude-setup]). `claude auth status` exits 0 when signed in ([claude-cli]). Remove any `ANTHROPIC_API_KEY` you do not mean to use.
  - **`claude` not recognised?** Add `%USERPROFILE%\.local\bin` to the user `PATH` as Anthropic documents ([claude-path]).
  - **Restart.** Stop the dev app, open a new terminal and run `vp run dev:desktop` again, so that it sees the new `PATH`.
  - **Check.** In **Settings → Providers**, record for each provider: found or not, version, sign-in state and any warning. Take a screenshot with the account hidden.
  - **Not found?** Set **Binary path** to `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin\codex.exe` or `%USERPROFILE%\.local\bin\claude.exe`, and record that it was needed ([install-path]).
- [ ] **6. Add an empty folder as a project, and have each provider create a text file.**

  ```powershell
  New-Item -ItemType Directory C:\src\t3-probe | Out-Null
  ```

  - Add `C:\src\t3-probe` with **Add project** in the sidebar or **Add Project** in the command palette (`Ctrl+K`), and record the option used ([sidebar-add], [t3-add-project]).
  - In a Codex thread, ask: "Create hello-codex.txt containing the word codex." In a Claude thread, ask: "Create hello-claude.txt containing the word claude." Keep the default permission mode, Full access ([t3-rules]).
  - Check the files with `Get-Content C:\src\t3-probe\hello-*.txt`. Record whether each turn finished, any approval or UAC prompt, and any error.
- [ ] **7. Run the linter, the typecheck and the tests, as CI does.**

  ```powershell
  vp check
  vp run knip:check
  vp run typecheck
  vp run --parallel --concurrency-limit 4 --filter '!t3' --filter '!@t3tools/monorepo' test
  vp run --filter t3 test
  ```

  - **Where the commands come from.** These are CI's lint and typecheck commands and the Windows lane's test commands ([ci-lint], [ci-tc], [wt]).
  - **The server suite is the last line.** It had 3,763 tests on 2026-09-04 ([run-green-server]). CI splits it four ways and installs Chromium for its browser tests ([ci-server]).
  - **knip.** If it runs out of memory, rerun it after `$env:KNIP_DISABLE_RAW_TRANSFER = "1"` and record that you did ([knip-known]).
  - **Expected Windows failures:**
    - the test that creates a file named with `:` ([t3-15651]);
    - the NTFS file-ID test ([t3-14838]);
    - symlink tests, if Developer Mode is off ([t3-19681]);
    - occasional `EBUSY` or `EPERM` during temporary-folder clean-up.
  - **Record per package:** test files and tests passed, failed and skipped; each failing test's name and first error line; and the duration.
- [ ] **8. Record the results** in one comment on #6:
  - the machine from step 0, the T3 Code commit, and the versions of Git, Python, `vp`, Node.js, Codex and Claude Code;
  - each step's result, duration and notable output, with any workaround used;
  - screenshots of **Settings → Providers** and of the two threads;
  - the test table from step 7.

  Keep credentials, tokens, pairing URLs, e-mail addresses and account names out of the comment.

## Limits and unconfirmed points

- **Nothing was run on Windows.** Every Windows statement comes from documentation, source, issue trackers or T3 Code's CI logs. #6 is the first run.
- **Unconfirmed:**
  - whether T3 Code's whole suite passes on Windows at `2577baf`, since the last whole-suite run was on 2026-09-04;
  - whether Electron 44.4.5 starts on the founder's machine;
  - whether Vite+'s managed Node.js resolves `^24.13.1` to 24.22.0, and whether its installer adds `vp` to `PATH` today;
  - whether the Python install manager's `python3` extracts Electron without a Python runtime installed first.
- **Untested workaround:** if `python3` cannot be made to work, Electron's own `install-electron` command may fetch the binary first, so that T3 Code's repair step finds it and skips extraction ([electron-breaking]).
- **The count of about 76 open Windows issues is a manual reading** of search results, as T3 Code has no Windows label.
- **Not examined:**
  - the Windows CI of pnpm, Node.js, Electron and electron-builder;
  - the WSL backend from source, beyond its code;
  - packaging an installer;
  - macOS beyond the tools' published builds and CI. macOS appears to be T3 Code's primary development platform (Inference), but no macOS run was made either.
- **Not Windows-specific:** using a Claude subscription through the Agent SDK has terms of its own; see [Claude Agent SDK §3](claude-agent-sdk.md#3-authentication-and-terms).

[i1]: https://github.com/softhatgames/playstead/issues/1
[i5]: https://github.com/softhatgames/playstead/issues/5
[i6]: https://github.com/softhatgames/playstead/issues/6
[i8]: https://github.com/softhatgames/playstead/issues/8
[t3]: https://github.com/pingdotgg/t3code/tree/2577baf8b0dc541283fa93d6919b0e354effadf4
[dev]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/docs/operations/development.md#L3-L20
[dev-checks]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/docs/operations/development.md#L99-L119
[dev-artifacts]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/docs/operations/development.md#L139-L152
[dev-installer]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/docs/operations/development.md#L188-L202
[t3-readme]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/README.md#L113-L135
[t3-agents]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/AGENTS.md#L100
[pkg]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/package.json
[ci]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/.github/workflows/ci.yml
[ci-lint]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/.github/workflows/ci.yml#L61-L97
[ci-tc]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/.github/workflows/ci.yml#L137-L145
[vite-typeaware]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/vite.config.ts#L378-L381
[vp-check]: https://viteplus.dev/guide/check
[rel-targets]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/docs/operations/release.md#L34-L48
[rel-desktop]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/.github/workflows/release-desktop.yml
[rel-install]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/.github/workflows/release-desktop.yml#L165-L175
[rel-spectre]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/.github/workflows/release-desktop.yml#L244-L249
[rel-payload]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/docs/operations/release.md#L469-L509
[rel-signing]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/docs/operations/release.md#L609-L633
[server-vite]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/apps/server/vite.config.ts#L55-L60
[server-pkg]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/apps/server/package.json#L17-L22
[desktop-vite]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/apps/desktop/vite.config.ts#L22-L47
[browser-secret]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/apps/desktop/scripts/build-browser-secret.mjs#L16
[desk-rm]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/apps/desktop/src/backend/DesktopBackendConfiguration.ts#L169-L205
[telemetry]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/docs/internals/resource-telemetry.md#L3-L7
[telemetry-wsl]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/docs/internals/resource-telemetry.md#L49-L52
[sqlite-req]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/packages/shared/src/nodeSqliteClient.ts#L84-L111
[gattr]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/.gitattributes
[git-attr]: https://git-scm.com/docs/gitattributes
[rm-cargo]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/native/resource-monitor/Cargo.toml
[rust-2024]: https://doc.rust-lang.org/edition-guide/rust-2024/index.html
[rustup-msvc]: https://rust-lang.github.io/rustup/installation/windows-msvc.html
[desk-settings]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/apps/desktop/src/settings/DesktopAppSettings.ts#L38-L80
[install-wsl]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/docs/user/install.md#L89-L93
[install-path]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/docs/user/install.md#L147-L152
[wsl-port]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/apps/desktop/src/wsl/DesktopWslBackend.ts#L46-L60
[wsl-allow]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/apps/desktop/src/backend/DesktopBackendConfiguration.ts#L639
[wsl-tools]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/apps/desktop/src/wsl/DesktopWslEnvironment.ts#L490-L498
[wsl-build]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/apps/desktop/src/wsl/DesktopWslEnvironment.ts#L500-L508
[dev-electron]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/apps/desktop/scripts/dev-electron.mjs#L84-L99
[pty-patch]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/patches/node-pty%401.2.0-beta.15.patch
[shell-pathext]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/packages/shared/src/shell.ts#L412-L424
[shell-spawn]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/packages/shared/src/shell.ts#L682-L743
[shell-dirs]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/packages/shared/src/shell.ts#L750-L764
[desk-dirs]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/apps/desktop/src/shell/DesktopShellEnvironment.ts#L166-L185
[desk-pwsh]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/apps/desktop/src/shell/DesktopShellEnvironment.ts#L335-L364
[desk-merge]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/apps/desktop/src/shell/DesktopShellEnvironment.ts#L366-L399
[probe-patterns]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/packages/provider-core/src/server/snapshotProbe.ts#L26-L44
[probe-spawn]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/packages/provider-core/src/server/snapshotProbe.ts#L108-L131
[claude-exe]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/apps/server/src/provider/Drivers/ClaudeExecutable.ts#L10-L80
[claude-version]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/apps/server/src/provider/ClaudeProvider.ts#L505-L510
[claude-auth]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/apps/server/src/provider/ClaudeProvider.ts#L608-L625
[codex-probe]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/apps/server/src/provider/CodexProvider.ts#L436-L444
[codex-account]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/apps/server/src/provider/CodexProvider.ts#L469-L470
[codex-auth]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/apps/server/src/provider/CodexProvider.ts#L599-L604
[codex-managed]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/apps/server/src/provider/CodexInstallation.ts#L84-L95
[t3-codex-doc]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/docs/user/providers-codex.md#L5-L27
[compat]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/apps/server/src/provider/model-manifest.json#L4-L34
[codex-rel]: https://github.com/openai/codex/releases/tag/rust-v0.163.0
[codex-readme]: https://github.com/openai/codex/blob/main/README.md
[winget-codex]: https://github.com/microsoft/winget-pkgs/tree/master/manifests/o/OpenAI/Codex
[codex-win-app]: https://learn.chatgpt.com/docs/windows/windows-app
[codex-win]: https://learn.chatgpt.com/docs/windows/windows-sandbox
[codex-wsl]: https://learn.chatgpt.com/docs/windows/wsl
[codex-ps1]: https://chatgpt.com/codex/install.ps1
[codex-env]: https://learn.chatgpt.com/docs/config-file/environment-variables
[codex-auth-doc]: https://learn.chatgpt.com/docs/auth
[npm-claude]: https://www.npmjs.com/package/@anthropic-ai/claude-code
[winget-claude]: https://github.com/microsoft/winget-pkgs/tree/master/manifests/a/Anthropic/ClaudeCode
[claude-setup]: https://code.claude.com/docs/en/setup
[claude-path]: https://code.claude.com/docs/en/troubleshoot-install#verify-your-path
[claude-cli]: https://code.claude.com/docs/en/cli-reference
[t3-rules]: ../t3-code.md
[ws]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/pnpm-workspace.yaml
[lock]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/pnpm-lock.yaml
[wt]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/.github/workflows/windows-tests.yml
[wt-runs]: https://github.com/pingdotgg/t3code/actions/workflows/windows-tests.yml
[dev-state]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/docs/operations/development.md#L27-L33
[ci-server]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/.github/workflows/ci.yml#L282-L346
[vite-jsplugins]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/vite.config.ts#L123
[build-artifact]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/scripts/build-desktop-artifact.ts#L2855-L2870
[ensure-electron]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/apps/desktop/scripts/ensure-electron-runtime.mjs#L117-L140
[electron-launcher]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/apps/desktop/scripts/electron-launcher.mjs#L452-L469
[sidebar-add]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/apps/web/src/components/sidebar/SidebarThreadHeader.tsx#L110
[t3-add-project]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/docs/user/source-control.md#L117-L131
[t3-contributing]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/CONTRIBUTING.md
[t3-compare]: https://github.com/pingdotgg/t3code/compare/2577baf8b0dc541283fa93d6919b0e354effadf4...e3b35d1b2440b104f0bc2e357377c348121234dd
[t3-search]: https://github.com/pingdotgg/t3code/issues?q=is%3Aissue%20is%3Aopen%20windows
[t3-9538]: https://github.com/pingdotgg/t3code/pull/9538
[t3-8206]: https://github.com/pingdotgg/t3code/pull/8206
[t3-10551]: https://github.com/pingdotgg/t3code/pull/10551
[t3-11438]: https://github.com/pingdotgg/t3code/pull/11438
[t3-15651]: https://github.com/pingdotgg/t3code/pull/15651
[t3-18212]: https://github.com/pingdotgg/t3code/pull/18212
[t3-19965]: https://github.com/pingdotgg/t3code/pull/19965
[t3-19966]: https://github.com/pingdotgg/t3code/pull/19966
[t3-20162]: https://github.com/pingdotgg/t3code/pull/20162
[t3-4403]: https://github.com/pingdotgg/t3code/issues/4403
[t3-5236]: https://github.com/pingdotgg/t3code/issues/5236
[t3-7360]: https://github.com/pingdotgg/t3code/issues/7360
[t3-7513]: https://github.com/pingdotgg/t3code/issues/7513
[t3-7625]: https://github.com/pingdotgg/t3code/issues/7625
[t3-8051]: https://github.com/pingdotgg/t3code/issues/8051
[t3-12498]: https://github.com/pingdotgg/t3code/issues/12498
[t3-12689]: https://github.com/pingdotgg/t3code/issues/12689
[t3-13303]: https://github.com/pingdotgg/t3code/issues/13303
[t3-14325]: https://github.com/pingdotgg/t3code/issues/14325
[t3-14393]: https://github.com/pingdotgg/t3code/issues/14393
[t3-14838]: https://github.com/pingdotgg/t3code/issues/14838
[t3-14990]: https://github.com/pingdotgg/t3code/issues/14990
[t3-15001]: https://github.com/pingdotgg/t3code/issues/15001
[t3-18788]: https://github.com/pingdotgg/t3code/issues/18788
[t3-19510]: https://github.com/pingdotgg/t3code/issues/19510
[t3-19681]: https://github.com/pingdotgg/t3code/issues/19681
[run-first-server]: https://github.com/pingdotgg/t3code/actions/runs/33829864875
[run-first-desktop]: https://github.com/pingdotgg/t3code/actions/runs/33829863470
[run-first-shared]: https://github.com/pingdotgg/t3code/actions/runs/33829861646
[run-green-server]: https://github.com/pingdotgg/t3code/actions/runs/33916498800
[run-green-rest]: https://github.com/pingdotgg/t3code/actions/runs/33916500913
[run-ebusy]: https://github.com/pingdotgg/t3code/actions/runs/38094098153
[vp-guide]: https://viteplus.dev/guide/
[vp-guide-src]: https://github.com/voidzero-dev/vite-plus/blob/afbe4a285b4ac6ffac498eae71b10ff63069a029/docs/guide/index.md#L31-L36
[vp-global]: https://viteplus.dev/guide/global-cli
[vp-env]: https://viteplus.dev/guide/env
[vp-pm]: https://viteplus.dev/guide/package-management
[vp-local]: https://viteplus.dev/guide/local-cli
[vp-cache]: https://viteplus.dev/guide/cache
[vp-1.0.0]: https://github.com/voidzero-dev/vite-plus/releases/tag/v1.0.0
[vp-1.1.0]: https://github.com/voidzero-dev/vite-plus/releases/tag/v1.1.0
[vp-1.2.0]: https://github.com/voidzero-dev/vite-plus/releases/tag/v1.2.0
[vp-ci]: https://github.com/voidzero-dev/vite-plus/blob/afbe4a285b4ac6ffac498eae71b10ff63069a029/.github/workflows/ci.yml#L230-L233
[vp-ci-arm]: https://github.com/voidzero-dev/vite-plus/blob/afbe4a285b4ac6ffac498eae71b10ff63069a029/.github/workflows/test-standalone-install.yml#L1038-L1040
[vp-1374]: https://github.com/voidzero-dev/vite-plus/issues/1374
[vp-2866]: https://github.com/voidzero-dev/vite-plus/issues/2866
[vp-2984]: https://github.com/voidzero-dev/vite-plus/issues/2984
[vp-3065]: https://github.com/voidzero-dev/vite-plus/issues/3065
[vt-830]: https://github.com/voidzero-dev/vite-task/issues/830
[vitest-10692]: https://github.com/vitest-dev/vitest/issues/10692
[vitest-10812]: https://github.com/vitest-dev/vitest/issues/10812
[npm-oxlint]: https://www.npmjs.com/package/oxlint/v/1.85.0
[npm-oxfmt]: https://www.npmjs.com/package/oxfmt/v/0.70.0
[oxc-ci]: https://github.com/oxc-project/oxc/blob/4770423f7b02bd69bd4bd11f504d8d7209be6be9/.github/workflows/ci.yml#L77-L80
[oxc-jsplugins]: https://oxc.rs/docs/guide/usage/linter/js-plugins.html
[oxc-14009]: https://github.com/oxc-project/oxc/issues/14009
[oxc-14375]: https://github.com/oxc-project/oxc/issues/14375
[oxc-17856]: https://github.com/oxc-project/oxc/issues/17856
[oxc-19395]: https://github.com/oxc-project/oxc/issues/19395
[oxc-27486]: https://github.com/oxc-project/oxc/issues/27486
[oxfmt-config]: https://oxc.rs/docs/guide/usage/formatter/config-file-reference.html
[rolldown-10801]: https://github.com/rolldown/rolldown/issues/10801
[tsgolint-876]: https://github.com/oxc-project/tsgolint/issues/876
[tsgo-flags]: https://github.com/Effect-TS/tsgo/blob/47cb1ed7704aff44cacaa0f4d2ef24de990cba0e/_packages/tsgo/src/cli/integrationFlags.ts#L14-L19
[tsgo-discovery]: https://github.com/Effect-TS/tsgo/blob/47cb1ed7704aff44cacaa0f4d2ef24de990cba0e/_packages/tsgo/src/patcher/discovery.ts#L64-L104
[tsgo-patcher]: https://github.com/Effect-TS/tsgo/blob/47cb1ed7704aff44cacaa0f4d2ef24de990cba0e/_packages/tsgo/src/patcher/index.ts
[tsgo-validate]: https://github.com/Effect-TS/tsgo/blob/0076e24aadbe994000e4a1a2ab0e0e81868b75d1/.github/workflows/validate.yml#L29
[tsgo-release]: https://github.com/Effect-TS/tsgo/blob/0076e24aadbe994000e4a1a2ab0e0e81868b75d1/_tools/repoctl/src/releasePlan.ts#L41-L50
[knip-ci]: https://github.com/webpro-nl/knip/blob/8cc0cb0c9ff09463cad30817c8cf78cbc48b7ed6/.github/workflows/ci-legacy-5.0.4.yml#L37-L56
[knip-known]: https://knip.dev/reference/known-issues
[knip-1813]: https://github.com/webpro-nl/knip/issues/1813
[tscrs-readme]: https://github.com/pingdotgg/ts-rust/blob/v0.7.0/README.md
[tscrs-0.3.0]: https://github.com/pingdotgg/ts-rust/releases/tag/v0.3.0
[tscrs-ci]: https://github.com/pingdotgg/ts-rust/blob/780dc512d64f40afebffa6a7028207649fb7ed1c/.github/workflows/ci.yml#L145-L164
[npm-pnpm]: https://www.npmjs.com/package/pnpm/v/11.10.0
[pnpm-faq]: https://github.com/pnpm/pnpm.io/blob/main/versioned_docs/version-11.x/faq.md
[pnpm-pmonfail]: https://github.com/pnpm/pnpm.io/blob/main/versioned_docs/version-11.x/settings/cli.md#pmonfail
[pnpm-engine]: https://github.com/pnpm/pnpm.io/blob/main/versioned_docs/version-11.x/settings/cli.md#enginestrict
[pnpm-nm]: https://github.com/pnpm/pnpm.io/blob/main/versioned_docs/version-11.x/settings/node-modules.md
[pnpm-install-11]: https://github.com/pnpm/pnpm.io/blob/main/versioned_docs/version-11.x/installation.md
[pnpm-11.0.0]: https://github.com/pnpm/pnpm/releases/tag/v11.0.0
[pnpm-11.28.0]: https://github.com/pnpm/pnpm/releases/tag/v11.28.0
[pnpm-11.28.1]: https://github.com/pnpm/pnpm/releases/tag/v11.28.1
[node-schedule]: https://github.com/nodejs/Release/blob/main/schedule.json
[node-dist]: https://nodejs.org/dist/index.json
[node-building]: https://github.com/nodejs/node/blob/v24.x/BUILDING.md#platform-list
[node-download]: https://nodejs.org/en/download
[node-ts]: https://nodejs.org/docs/latest-v24.x/api/typescript.html
[node-cve]: https://nodejs.org/en/blog/vulnerability/april-2024-security-releases-2
[node-dep0190]: https://nodejs.org/docs/latest-v24.x/api/deprecations.html#DEP0190
[node-corepack]: https://nodejs.org/docs/latest-v24.x/api/corepack.html
[node-napi]: https://nodejs.org/docs/latest-v24.x/api/n-api.html
[win10-eol]: https://learn.microsoft.com/en-us/lifecycle/products/windows-10-home-and-pro
[electron-schedule]: https://releases.electronjs.org/schedule
[electron-readme]: https://github.com/electron/electron#platform-support
[electron-breaking]: https://github.com/electron/electron/blob/44-x-y/docs/breaking-changes.md
[electron-44.5.0]: https://github.com/electron/electron/releases/tag/v44.5.0
[electron-54552]: https://github.com/electron/electron/issues/54552
[electron-54614]: https://github.com/electron/electron/issues/54614
[eb-multi]: https://www.electron.build/v26/features/multi-platform-build/
[npm-node-pty]: https://www.npmjs.com/package/node-pty/v/1.2.0-beta.15
[node-pty-955]: https://github.com/microsoft/node-pty/issues/955
[node-pty-957]: https://github.com/microsoft/node-pty/issues/957
[ms-devmode]: https://learn.microsoft.com/en-us/windows/advanced-settings/developer-mode
[py-win]: https://docs.python.org/3/using/windows.html
[git-win]: https://git-scm.com/install/windows
[gfw-longpaths]: https://gitforwindows.org/git-cannot-create-a-file-or-directory-with-a-long-path
[vp-ci-mac]: https://github.com/voidzero-dev/vite-plus/blob/afbe4a285b4ac6ffac498eae71b10ff63069a029/.github/workflows/ci.yml#L114-L120
[tscrs-ci-mac]: https://github.com/pingdotgg/ts-rust/blob/780dc512d64f40afebffa6a7028207649fb7ed1c/.github/workflows/ci.yml#L62-L68
