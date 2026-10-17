# Roadmap

This document holds the plan: what each version promises, the milestones on the way and their order. Progress lives in GitHub: each milestone below links to its [GitHub milestone](https://github.com/softhatgames/playstead/milestones), which holds its spec and tickets and shows how far it has come. The plan changes as Playstead learns; each change is recorded under [Changes](#changes).

## Versions

Playstead has one version for the whole app. Builds report `0.0.0` until the first public release, and milestones do not change it.

### 0.1, the first public release

**Release test:** a developer installs Playstead, starts a new game project and finishes a small 2D platformer and a small 2D puzzle game, each ending as a standalone desktop build that runs on a computer without Playstead, .NET or the agents. Both games pass on the Mac and on the Windows laptop, played by the founder; every other platform passes the automated checks. After 0.1, Playstead collects feedback from other people, and the founder starts Handbuilt from scratch on it.

- **Who it is for:** developers comfortable installing the .NET 10 SDK and a provider's CLI. Playstead finds .NET and the providers and explains how to install what is missing.
- **Providers:** Codex and Claude.
- **Followed from T3 Code:** everything Playstead follows, slices 1–7 below. Two parts of T3 Code are left out of Playstead: switching provider within a thread, since a person uses one provider and one subscription, and the Nightly update channel.
- **Games:** C# on .NET 10 with MonoGame DesktopGL, 2D, without custom `.fx` shaders, which MonoGame compiles natively only on Windows. The stack's skills keep the agent to SpriteBatch and the built-in effects.
- **Platforms,** for Playstead and for exported games: macOS arm64 and x64, Windows x64 and arm64, Linux x64 and arm64. Minimums follow .NET 10: macOS 15, Windows 11 23H2, or a Linux distribution .NET 10 supports. Playstead checks at startup and explains when a system is too old.
- **Installers and updates:** signed installers for each platform, as T3 Code builds them, and auto-update on one Stable channel from GitHub Releases. The person starts each download and install.
- **Signing:** as Softhat Games, an organisation, through the Apple Developer Program and Azure Trusted Signing.
- **Feedback:** GitHub Issues. **Report a problem**, in Help and on the Diagnostics page, starts an agent with a skill Playstead ships. The agent drafts the issue from the error messages, exceptions, logs, versions and environment, strips identifying details and secrets, and leaves the game's code, content, names and idea out unless the person asks to include a snippet; the draft ends with what was removed. Playstead opens GitHub's new-issue form with the draft, and the person submits it. A draft too long for the form becomes a file the person attaches. There is no telemetry.

### Compatibility from 0.1

Before 0.1 anything may break. From 0.1, three promises hold across every stable release:

1. **The Playstead home** keeps its threads and settings. Schema changes are numbered migrations that run at startup, each with its own test, as in T3 Code. The migrations written before 0.1 are reset into one starting migration at the release.
2. **Game projects** made with any 0.x release open in every later one. When their format changes, Playstead upgrades them, says so, and the upgrade can be undone through Git.
3. **Games** keep building and running without Playstead. A game's Playstead library changes only when the person accepts an offered, explained upgrade.

Downgrades are not supported: an older Playstead refuses a newer home or game project with a clear message and leaves it untouched.

### Releasing

Only the founder releases. An agent may prepare the release pull request: the version, the release notes and the checklist results. Pushing the `v*` tag starts the release workflow, and its publishing job runs in the `release` environment, which holds the signing secrets and needs the founder's approval. Before each stable release, a checklist installs and then updates the signed build in a fresh Windows 11 arm64 VM with Defender and Smart App Control on, and on the Mac from a Safari download; the results go on the release's issue.

### Versions after 0.1

- **Patch releases** (`0.1.x`) carry fixes and small improvements, released when needed.
- **Minor releases** (`0.2`, `0.3` …) each carry a planned capability, defined here with its own release test before work starts.
- **1.0** means games are ready to publish: signed game builds, store packaging and phone targets.

## The road to 0.1

Three tracks lead to 0.1. The T3 Code track's slices come from [First working slice](https://github.com/softhatgames/playstead/issues/8); each follows T3 Code at the commit followed when it starts, with nothing trimmed. Building game features starts once slice 4 is done, when agents work under approval, attach screenshots and can be undone through version control. The technical prototype and the map for the making-games track start now. Slices 5–7 continue beside the game work, and 0.1 needs all three tracks.

| Milestone                                                                                     | Track        | Status       |
| --------------------------------------------------------------------------------------------- | ------------ | ------------ |
| [First working slice](https://github.com/softhatgames/playstead/milestone/1)                  | T3 Code      | Done         |
| [1. Permission modes and turn control](https://github.com/softhatgames/playstead/milestone/2) | T3 Code      | In progress  |
| [2. Threads and the sidebar](https://github.com/softhatgames/playstead/milestone/3)           | T3 Code      | In progress  |
| [3. The composer](https://github.com/softhatgames/playstead/milestone/4)                      | T3 Code      | Specified    |
| [4. Version control](https://github.com/softhatgames/playstead/milestone/5)                   | T3 Code      | Planned      |
| [5. Settings and providers in depth](https://github.com/softhatgames/playstead/milestone/6)   | T3 Code      | Planned      |
| [6. Usage](https://github.com/softhatgames/playstead/milestone/7)                             | T3 Code      | Planned      |
| [7. Several threads together](https://github.com/softhatgames/playstead/milestone/8)          | T3 Code      | Planned      |
| [Technical prototype](https://github.com/softhatgames/playstead/milestone/9)                  | Making games | Planned      |
| Making games, the rest                                                                        | Making games | Being mapped |
| [Release 0.1](https://github.com/softhatgames/playstead/milestone/10)                         | Release      | Planned      |

### T3 Code

- **First working slice:** threads with Codex and Claude, run from source on macOS and Windows. Specified in [Spec: First working slice](https://github.com/softhatgames/playstead/issues/12).
- **1. Permission modes and turn control:** Supervised, Auto-accept edits and Auto, with approvals and Codex's Windows sandbox setup; plan mode; the queue and steer; the reasoning and traits picker. Specified in [Spec: Permission modes and turn control](https://github.com/softhatgames/playstead/issues/45).
- **2. Threads and the sidebar:** generated titles; rename, pin, archive with **Settings → Archive**, delete, snooze, settle and mark unread; search, the command palette and drag reordering; threads without a project; removing a project. Specified in [Spec: Threads and the sidebar](https://github.com/softhatgames/playstead/issues/33).
- **3. The composer:** attachments and question attachments, `@` context chips, `/` commands, `$` skills, rich text and prompt history. Specified in [Spec: The composer](https://github.com/softhatgames/playstead/issues/59).
- **4. Version control:** a research ticket first chooses the system, which may not be Git; then checkpoints, Initialize, the changed-files card, **Edit from here** with file revert, and worktrees.
- **5. Settings and providers in depth:** General, Appearance and themes, Keybindings, Project, Storage, Diagnostics, notifications and the welcome screen; extra provider instances, environment variables, models, **Update now** and Codex's managed runtime.
- **6. Usage.**
- **7. Several threads together:** fork and merge back; the orchestrator's MCP server, with subagents and delegated tasks. The game tools reach the agent through the same server. Switching provider within a thread is left out.

### Making games

A wayfinder map charts this track: its destination is 0.1's release test, and its tickets decide how the Playstead library reaches a game, the order of the preview, prototypes, scenarios, playtests and records, and the release test's two games. Its milestones join the table as the map resolves them.

- **Technical prototype:** [ADR 0004](adr/0004-code-first-games-starting-with-csharp.md)'s prototype on .NET 10 and MonoGame. It starts from the `research/preview-probe` branch as evidence, not as a result: it reruns the branch's measurements at current versions, then adds Hot Reload inside the game loop, replay across machines with .NET's maths and a physics library, audio and input under T3 Code's permission modes, the remaining platforms through CI, and whether MonoGame's Vulkan path compiles shaders without Wine. Results go in [docs/research/](research/README.md).

### Release

- **Early:** register Softhat Games, then its D-U-N-S number, the Apple Developer Program and Azure Trusted Signing. Each validation can take weeks.
- **Installers** for the six platforms, signed, from the release workflow, each built on a GitHub runner of its own architecture.
- **Auto-update** on the Stable channel, following T3 Code's desktop updates without the Nightly channel.
- **Checks:** the macOS and Windows checks become required on pull requests. On all six platforms, CI builds and boots the installer, creates a game project from the template, builds it, runs its scripted play headless, exports the game and launches the export.
- **The GPU runner:** the founder's Linux x64 machine as a self-hosted runner for post-merge and release jobs only, never pull requests, running as its own user without the founder's credentials. It runs rendering checks and the preview's frame-delay measurement on a real GPU, and blocks nothing.
- **Report a problem** and its skill.
- **The release test**, the security-software checklist, the migration reset and the version set to `0.1.0`.

## After 0.1

Unordered. Each becomes a planned minor release when it is chosen.

- The other T3 Code providers, one protocol at a time, each once it passes the release test: the ACP runtime (Grok, Antigravity, the ACP Registry), Cursor's SDK, OpenCode's HTTP server, Pi and Muse.
- 3D games, with what they need from the Playstead library.
- Custom shaders.
- Reconsidering MonoGame as the first library.
- Guided setup for people who don't program.
- Adding an existing code-first game, starting with discovery.
- Toward 1.0: signed game builds, store packaging and phone targets.

## Changes

- **2026-10-17:** the roadmap replaces the slice outline in [First working slice](https://github.com/softhatgames/playstead/issues/8). 0.1 becomes the first public release with the game features; the other seven providers move after it; switching provider within a thread and the Nightly channel are left out; Linux joins macOS and Windows.
