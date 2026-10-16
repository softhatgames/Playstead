# Following T3 Code

[T3 Code](https://github.com/pingdotgg/t3code) runs coding agents in production and has verified how each provider behaves on every platform. Playstead follows it for working with coding agents and for the parts of the app around them, and adds what making a game needs.

## Rules

- **Behaviour.** Follow T3 Code for every provider it supports, and for sessions, permission modes and sandboxes. That includes its default permission mode, Full access.
- **Architecture.** Follow its orchestration, persistence, recovery and client connection.
- **Interface.** Follow its left sidebar with threads, the thread view, Settings and Usage. Its right-hand panels stay out: that space holds Playstead's game preview and other game development tools.
- **Terms.** T3 Code's terms name every coding-agent concept. Playstead's own terms cover making games and never redefine a T3 Code term.
- **Inspired, never copied.** Study T3 Code, then write Playstead's own code from what you learned. Cite the T3 Code path and commit an idea came from, in the issue or pull request.

## What is followed

Paths are in T3 Code's repository. The review reads commits under them.

| Area | T3 Code paths |
| --- | --- |
| Providers and permissions | `apps/server/src/orchestration-v2/Adapters/`, `apps/server/src/provider/`, `apps/server/src/process/`, `packages/provider-*`, `packages/effect-codex-app-server/`, `packages/effect-acp/`, `packages/contracts/src/providerPolicy.ts`, `docs/internals/providers.md`, `docs/internals/adding-a-provider.md`, `docs/user/providers-*.md`, `docs/user/permission-modes.md` |
| Architecture | `apps/server/src/orchestration-v2/` (outside `Adapters/`), `apps/server/src/persistence/`, `apps/server/src/ws.ts`, `apps/server/src/server.ts`, `apps/server/src/serverRuntimeStartup.ts`, `packages/contracts/src/orchestrationV2.ts`, `packages/contracts/src/rpc.ts`, `packages/client-runtime/`, `packages/shared/`, `docs/orchestration-v2/`, `docs/internals/overview.md`, `docs/internals/effect-services.md`, `docs/internals/connection-runtime.md`, `docs/internals/glossary.md` |
| Interface: left sidebar | `apps/web/src/components/sidebar/`, `apps/web/src/components/Sidebar*.tsx`, `apps/web/src/components/AppSidebarLayout.tsx` |
| Interface: thread view | `apps/web/src/components/chat/`, `apps/web/src/components/ChatView*.tsx`, `apps/web/src/components/ThreadRouteView.tsx`, `apps/web/src/routes/_chat*.tsx` |
| Interface: Settings | `apps/web/src/components/settings/`, `apps/web/src/routes/settings*.tsx` |
| Interface: Usage | `apps/web/src/components/usage/`, `apps/web/src/routes/usage.tsx`, `apps/server/src/usage/` |
| Interface: components and themes | `apps/web/src/components/ui/`, `apps/web/src/index.css` |
| Desktop app | `apps/desktop/` |

Not followed for now: the right-hand panels (diffs, files, browser preview, terminal), the mobile app, marketing, T3 Connect and relay, source control hosts and pull requests, scheduled tasks, devices, voice, HTML renders and snap-shot. The founder moves an area in by adding it to the table.

## The weekly review

A scheduled task in T3 Code runs this review every Monday at 09:00 in a new thread of the Playstead project. Anyone can also run it by hand.

- **Reference clone:** `~/.cache/playstead/t3code`, a partial clone made with `git clone --filter=blob:none https://github.com/pingdotgg/t3code.git ~/.cache/playstead/t3code`. It stays outside this repository.
- **Last reviewed commit:** the `to` commit in the title of the newest issue labelled `t3-review`. Before the first review it is `2577baf8b0dc541283fa93d6919b0e354effadf4` (2026-10-15).

Steps:

1. Make the clone if it is missing, then `git fetch`. `from` is the last reviewed commit and `to` is `origin/main`.
2. For each area, list `git log --no-merges <from>..<to> -- <paths>`. T3 Code makes hundreds of commits a week, so read subjects first and open the diffs of changes that look significant.
3. Sort what changed into four groups:
   - **Provider behaviour to match:** provider protocol changes, workarounds, version support, permission and sandbox changes.
   - **Architecture to consider.**
   - **Interface to consider**, for the followed parts only.
   - **Not relevant:** a count only, including changes under the paths [ARCHITECTURE.md](ARCHITECTURE.md#left-out) leaves out.
4. Open one issue in softhatgames/playstead, titled `T3 Code review: <from, 7 characters>..<to, 7 characters>` and labelled `t3-review`. Summarise each group by theme, with what changed, why it matters to Playstead and links to the T3 Code commits. End with proposed follow-ups as a checklist for the founder. When nothing is relevant, say so and close the issue at once, so the next review starts from `to`.

The review's only output is that issue; the founder decides what Playstead adopts.
