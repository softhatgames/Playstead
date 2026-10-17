# Where Codex and Claude find a project's skills and instructions

- **Question:** Where do Codex and Claude read a project's skills and agent instructions, and how can one game project carry a single set that both use on macOS, Windows and Linux? ([#85][ticket])
- **Date:** 2026-10-17. All sources were accessed on this date.
- **Outcome:** Codex reads a project's skills from `.agents/skills`, and Claude Code from `.claude/skills`; neither reads the other's folder. Codex reads `AGENTS.md`; Claude reads `CLAUDE.md`, and `AGENTS.md` only where no `CLAUDE.md` exists. One real skills folder, a relative link to it from the other provider's folder and a `CLAUDE.md` holding `@AGENTS.md` give both the same set; both followed the link on macOS. On Windows a committed link needs `core.symlinks=true` and Developer Mode or the link privilege; otherwise Git writes a small text file and the linked provider silently loses every project skill. A recommendation; the founder decides: keep the real folder at `.agents/skills`, link `.claude/skills` to it, give each skill a `name` equal to its folder and a `description`, and have Playstead check on Windows that the link works. Skills Playstead ships outside a game can reach both providers from one folder without links.
- **Versions:**
  - Codex: `codex-cli 0.163.0`, the latest stable release (2026-10-15, tag [`rust-v0.163.0`][codex-tag], commit `8308618`). Playstead's generated app-server schema comes from it, and Playstead marks 0.156.0 and later as supported. OpenAI's documentation has moved to learn.chatgpt.com; it carries no version and describes some things 0.163.0 lacks.
  - Claude: Claude Code 2.1.301, the local install, driven through `@anthropic-ai/claude-agent-sdk` 0.3.276, the version Playstead pins. Like T3 Code, Playstead gives the SDK the person's own `claude`. Playstead marks 2.1.280 and later as supported. Anthropic's documentation carries no version and names versions inline.
  - T3 Code at [`2577baf`][t3-tree], the commit Playstead follows.
  - The [Agent Skills specification][spec], which carries no version.
  - Git's [`core.symlinks`][git-config] documentation at Git 2.56.0. Git for Windows 2.56.0.windows.2 (2026-10-05), with [`compat/mingw.c`][gfw-mingw] at `d912ae6` and the [installer script][gfw-installer] at `43a5d8a`.
- **Local evidence:** runs on a macOS 26.6.2 (Apple silicon) development computer, in throwaway folders under `/tmp` that were then deleted, with their own `HOME`, `CODEX_HOME` and `CLAUDE_CONFIG_DIR`, signed out of both providers. Codex's `codex app-server` answered `initialize`, `skills/list`, `skills/extraRoots/set` and an ephemeral, read-only `thread/start`. For Claude, an SDK `query()` whose prompt never yields answered `initializationResult()` and `reloadSkills()`. No turn ran and no model was called. A Windows checkout without links was imitated by replacing each link with a text file holding its target. Nothing was run on Windows or Linux.

Labels: **Documented** (official documentation, specifications and source code at the versions above), **Observed** (the local runs), **Inference** (reasoning, not a source) and **Unconfirmed** (not established).

## Skills

### Where each provider looks

- **Codex (Documented).** OpenAI lists `.agents/skills` "in every directory from your current working directory up to the repository root", `$HOME/.agents/skills`, `/etc/codex/skills` and skills bundled with Codex ([build skills][codex-skills]). The 0.163.0 source adds three more ([host_roots.rs][codex-roots]):
  - `$CODEX_HOME/skills`, which the source calls deprecated and keeps for backward compatibility;
  - `.codex/skills` in each project configuration folder, which the documentation does not mention;
  - folders a client passes to `skills/extraRoots/set`, read as personal skills.
- **How Codex scans (Documented).** The project root is the nearest folder holding `.git` (`project_root_markers`). Codex follows linked folders in project, personal and admin roots, skips hidden folders inside a root, looks six levels deep and records each skill under its real path ([discovery.rs][codex-discovery], [loader][codex-loader]). Its walk drops linked files, so a `SKILL.md` that is itself a link is ignored ([local_file_system.rs][codex-walk]). Project skills load whether or not the project is trusted, since the scan also walks disabled configuration layers ([host_roots.rs][codex-roots]).
- **Codex (Observed).** With `.agents/skills` linked to a real `skills/` folder, `skills/list` returned every skill under its real path. `.codex/skills` loaded; `.claude/skills` did not. A linked skill folder loaded; a linked `SKILL.md` did not.
- **Claude Code (Documented).** Skills load from `.claude/skills` in the managed settings folder, from `~/.claude/skills`, from `.claude/skills` in the working folder "and in every parent directory up to the repository root", from `.claude/skills` inside folders added with `--add-dir`, from plugins as `/plugin-name:skill-name`, from the person's claude.ai account and from Claude Code itself ([skills][cc-skills]). Deeper `.claude/skills` folders load "the first time Claude reads or edits a file in that subdirectory". A skill folder may be a link, and Claude "loads the skill once even if several locations point at the same target". Nothing under `.agents/` is read ([memory][cc-memory]). In the SDK, the `user` and `project` setting sources decide what loads; `settingSources: []` loads no skills from disk ([SDK skills][cc-sdk-skills]).
- **Claude Code (Observed).** With `.claude/skills` linked to the same real folder, every skill loaded. A project with only a real `.agents/skills` had no project skills. Personal skills came from `$CLAUDE_CONFIG_DIR/skills` while `HOME` pointed elsewhere. Unlike Codex, Claude also loaded a linked `SKILL.md`.

### When two skills share a name

- **Codex lists both (Documented, Observed).** "If two skills share the same `name`, Codex doesn't merge them; both can appear in skill selectors" ([build skills][codex-skills]). `skills/list` put the project copy before the personal one. A plain `$name` mention selects a skill only when exactly one enabled skill has that name, so neither copy is used ([selection.rs][codex-selection]; test `collect_explicit_skill_mentions_skips_ambiguous_name`). A `skill` input item or a `[$name](path)` link picks one; OpenAI recommends sending the `skill` item ([app server][codex-as]).
- **Claude Code picks one (Documented, Observed).** "Enterprise over personal, and personal over project" ([skills][cc-skills]). In the run, the slash commands listed only the personal copy, while `reloadSkills()` returned both. A nested skill with a root skill's name gets a path prefix, such as `/apps/web:deploy`. Plugin skills carry the plugin's name and never clash.
- **The guide disagrees with both (Documented).** The Agent Skills client guide gives "project-level skills override user-level skills" as "the universal convention across existing implementations" ([client guide][spec-client]).
- **Inference.** A starter skill that shares a name with one of the person's own skills runs as their copy in Claude, and as neither copy in Codex when Playstead sends `$name`. Starter skills need names unlikely to clash, and Playstead can find clashes in both providers' lists.

### How each lists them

- **Codex `skills/list` (Documented, Observed).** It is on the stable surface in 0.163.0. It takes `cwds` and `forceReload` and returns, for each folder, every skill's `name`, `description`, `shortDescription`, `interface`, `dependencies`, real `path`, `scope` (`repo`, `user`, `system` or `admin`), `enabled` and `pluginId`, plus `errors` for skills that failed to load ([catalog_processor.rs][codex-catalog]). The run reported a missing `description` and missing front matter as errors. `skills/changed` signals changed files. OpenAI's documentation also describes `perCwdExtraUserRoots` and a `SKILL.json`; 0.163.0 has neither.
- **Claude Code through the SDK (Observed).** `initializationResult().commands` lists what the person can type: names, descriptions ending in `(user)` or `(project)` or starting with a plugin's name, argument hints and aliases. `reloadSkills()` lists what the model can invoke: it left out a `disable-model-invocation` skill and kept a `user-invocable: false` one. Neither gives a path.
- **T3 Code, which [$ skills][issue-68] (#68) follows (Documented).**
  - Codex: one `skills/list` call for the thread's folder, keeping that folder's entry ([CodexProvider.ts][t3-codex-provider]). A mention goes to Codex as plain `$name` text, never as a `skill` item ([CodexAdapterV2.ts][t3-codex-adapter]), so a clash leaves Codex with no skill.
  - Claude: `discoverClaudeSkills` reads `<config folder>/skills`, then `<cwd>/.claude/skills`; the first copy of a name wins, as in Claude ([ClaudeSkills.ts][t3-claude-skills]). It names each skill after its folder and reads `description`, `disable-model-invocation`, `user-invocable` and `skillOverrides` from up to five settings files. It does not read parent folders up to the repository root, nested folders, added folders, plugins or a front-matter `name`. On Windows it looks for managed settings under `%ProgramData%\ClaudeCode`, which Claude Code no longer reads ([managed settings][cc-managed]). Bundled skills reach its menu as provider commands.
  - Its comment says Claude publishes a skill under its folder name. Claude Code 2.1.301 published the front-matter `name` and kept the folder name as an alias (Observed).

## Instructions

- **Codex (Documented, Observed).** When a session starts, Codex reads `AGENTS.override.md` or `AGENTS.md` from `CODEX_HOME`. Then, in each folder from the project root down to the working folder, it reads the first of `AGENTS.override.md`, `AGENTS.md` and any `project_doc_fallback_filenames` ([AGENTS.md][codex-agents]). It joins them root first, skips empty files and stops at `project_doc_max_bytes`, 32 KiB by default. Links are allowed and there is no import syntax; each file is read as text ([agents_md.rs][codex-agents-md]). Folders below the working folder are never read, and an explicitly untrusted project gets none. In the run, `thread/start` reported `game/AGENTS.md`, then `game/sub/AGENTS.md` for a session in `game/sub`, and never a `CLAUDE.md`.
- **Claude Code (Documented).** Claude reads the managed `CLAUDE.md`, `~/.claude/CLAUDE.md`, and `CLAUDE.md`, `.claude/CLAUDE.md` and `CLAUDE.local.md` in the working folder and "every directory above it", past the repository root ([memory][cc-memory]). Files in subfolders load once Claude reads or edits a file there. `@path` imports resolve against the importing file, up to four hops; imports from outside the working folder need approval.
- **Claude Code and `AGENTS.md` (Documented).** From 2.1.277, Claude reads `AGENTS.md` and `.claude/AGENTS.md` only when no `CLAUDE.md`, `.claude/CLAUDE.md` or `CLAUDE.local.md` exists in the working folder or above. It then expands `@path` imports inside `AGENTS.md`. It never reads `AGENTS.override.md`. Some sessions cannot read `AGENTS.md` directly: versions before 2.1.277, a disabled built-in plugin, and some first sessions after an upgrade ([memory][cc-memory]).
- **One file for both (Documented).** Anthropic documents a `CLAUDE.md` beside `AGENTS.md` that imports it; "Keeping the import never makes Claude read `AGENTS.md` twice". It advises against a linked `CLAUDE.md` for anyone on Windows, where Git "checks a committed symlink out as a plain text file unless `core.symlinks` is enabled" ([memory][cc-memory]). This repository already uses the import.
- **Inference.**
  - `AGENTS.md` holds a game's instructions and `CLAUDE.md` holds `@AGENTS.md`. The import keeps working where direct reading does not, including after the person adds a `CLAUDE.local.md`.
  - `AGENTS.md` should not use `@path` imports itself: Claude expands them and Codex reads them as text. The whole should stay under 32 KiB.
  - Instructions belong at the game's root. Codex reads a subfolder's `AGENTS.md` only in sessions started there. Claude reads one only when no `CLAUDE.md` counts, so with a root `CLAUDE.md` it does not by default.
  - A `CLAUDE.md` in a folder above the game reaches Claude but not Codex.

## One set for both

### Links on macOS and Linux

- **Documented.** Codex "supports symlinked skill folders and follows the symlink target" ([build skills][codex-skills]). Claude follows linked skill folders ([skills][cc-skills]).
- **Observed.** On macOS both followed a whole linked `.agents/skills` and `.claude/skills` folder. Linux was not run; Codex uses the same code there (Inference).
- **Two layouts in use (Observed).** This repository links `.agents/skills` and `.claude/skills` to `dev/skills`, whose `writing-for-agents` entry is itself a link. T3 Code at `2577baf` keeps a real `.agents/skills` and links `.claude/skills` to `../.agents/skills` ([tree][t3-tree]).

### Windows without Developer Mode

- **Git (Documented).** With `core.symlinks` false, "symbolic links are checked out as small plain files that contain the link text". Adding such a file keeps its recorded type, so other platforms are unaffected ([git-config][git-config]). Git for Windows' built-in default is false ([mingw.c][gfw-mingw]). Its installer ticks "Enable symbolic links" by default only when Developer Mode is on, or when a test link succeeds for a user who is not an administrator. It writes the choice to the system configuration, and "existing repositories are unaffected" ([installer][gfw-installer]).
- **Windows (Documented).** Creating a link needs the `SeCreateSymbolicLinkPrivilege` privilege, which by default only elevated administrators hold, or Developer Mode from Windows 10 1703 ([Git for Windows][gfw-symlinks], [CreateSymbolicLinkW][ms-symlink]). Turning Developer Mode on "requires administrator access", and an organisation can disable it ([Developer Mode][ms-devmode]). Windows links are typed as file or folder. Folder junctions need no privilege ([Git for Windows][gfw-symlinks]); Git has no junction type (Inference).
- **The failure is silent (Observed).** With each link replaced by a text file holding `../skills`, Codex listed no project skills and reported no error. Claude listed none either.
- **Junctions (Inference, Unconfirmed).** Rust's standard library treats any reparse point carrying the name-surrogate bit as a link ([windows.rs][rust-std]), and a junction carries that bit ([MS-FSCC][ms-fscc]). Codex therefore probably follows a junction as it follows a linked folder. Whether Claude Code does is unknown.

### Copies, imports and configuration

- **Copies (Inference).** Two real folders work everywhere but drift once the person or an agent edits one. Both vendors offer one-time copies: Codex's `externalAgentConfig/import` copies `~/.claude/skills` to `~/.agents/skills` ([app server][codex-as]), and Claude's `/import` brings another agent's skills in ([memory][cc-memory]).
- **Imports (Documented).** Neither provider documents an import for skills. `@AGENTS.md` serves instructions only.
- **Pointing Codex at `.claude/skills` (Documented).** `skills/extraRoots/set` accepts any folder, but its folders apply to the whole app-server process and load as personal skills ([catalog_processor.rs][codex-catalog]). 0.163.0 has no setting that keeps such folders ([skills_config.rs][codex-skills-config]). T3 Code runs one process per provider instance, so one game's skills would appear in every thread (Inference).
- **Pointing Claude at `.agents/skills` (Documented, Observed).** No setting adds a skills folder, and an added folder must contain `.claude/skills`. The SDK's `plugins` option, given the game's `.agents` folder, loaded its skills as `.agents:<name>`, with the bare name as an alias where free. That works only in Playstead's sessions and outside `skillOverrides`. The SDK passes the folder as `--plugin-dir`, and Claude guards such folders against unapproved writes ([permission modes][cc-modes]).
- **A plugin manifest renames Codex's skills (Documented, Observed).** Codex treats a `.codex-plugin/plugin.json`, `.claude-plugin/plugin.json` or `.cursor-plugin/plugin.json` at or above a skills folder as a plugin, and prefixes each skill with the plugin's name ([namespace.rs][codex-namespace]). A game root holding `.claude-plugin/plugin.json` named `mygame` turned `plain-skill` into `mygame:plain-skill`.

### Editing skills under the permission modes

- **Documented.** Codex's `workspace-write` sandbox keeps `<writable_root>/.agents` read-only "when it exists as a directory" ([approvals and security][codex-sec]). Claude Code never auto-approves writes to `.claude` in `default` and `acceptEdits`; `bypassPermissions` allows them ([permission modes][cc-modes]).
- **Inference.** Under Full access, Playstead's default, an agent can change skills freely. In other modes, changing a skill under `.agents` or `.claude` needs the person's approval, unless the real folder lies elsewhere.

### Recommendation

A recommendation; the founder decides.

- Keep each game's skills in a real `.agents/skills/<name>/SKILL.md` and commit `.claude/skills` as a relative link to `../.agents/skills`, as T3 Code does. Codex then needs no link, and a checkout without links costs only Claude's skills. Playstead can detect that case: the path is a file whose text is the link target.
- Keep instructions in `AGENTS.md`, with a `CLAUDE.md` holding `@AGENTS.md`.
- On Windows, before Playstead creates or clones a game project, check that it can create links and set `core.symlinks=true` in that repository. When it cannot, explain Developer Mode as Playstead explains a missing .NET. **Creating a new game project** (#93) decides this; a junction is the fallback to try on the Windows laptop.
- If Windows without Developer Mode must work with no step at all, the alternatives are two copies that Playstead keeps equal, or the SDK `plugins` route for Claude, each with the costs above.

## Skills from outside the game project

- **Codex (Documented, Observed).**
  - `skills/extraRoots/set` takes absolute folders for the whole process. They are not saved, load as personal skills and are watched for changes ([app server][codex-as], [catalog_processor.rs][codex-catalog]). After the call, `skills/list` showed the extra folder's skill with scope `user`, and Codex sent `skills/changed`.
  - Plugins come from marketplaces. Installing copies a local plugin to `$CODEX_HOME/plugins/cache/<marketplace>/<plugin>/local/`, and that copy, not the source folder, is what loads ([plugins][codex-plugins], [store.rs][codex-store]). App server's `plugin/*` methods are "under development" ([app server][codex-as]). An edit to the source reaches Codex only after a reinstall.
  - `~/.agents/skills` is the person's own folder, read in every project and by other agents (Inference).
- **Claude Code (Documented, Observed).**
  - `additionalDirectories` passes folders as `--add-dir`. Their `.claude/skills` load "with live reload" through the `project` source, and the agent may read and edit those folders ([permissions][cc-permissions]). The run listed such a skill as `(project)`.
  - `plugins` loads a plugin folder in place for the session; it is never copied ([plugin loading][cc-plugin-loading]). Its skills are named `plugin:skill`, with the bare name as an alias where free (Observed), and `skillOverrides` does not affect them ([skills][cc-skills]).
  - The personal folder is the person's own: `$CLAUDE_CONFIG_DIR/skills` in the run.
- **One folder for both (Inference; each half Observed).** A folder laid out as `<folder>/.claude/skills/<name>/SKILL.md` serves both without links. Claude gets `<folder>` through `additionalDirectories`; Codex gets `<folder>/.claude/skills` through `skills/extraRoots/set`. The files stay where the person can open and edit them, and both providers watch them. T3 Code's discovery for Claude would not list them, so **$ skills** (#68) would need to add the folder.
- **Inference.** [PRODUCT.md][product] keeps each game's chosen skill versions, customisations and removals until the person accepts an update. Skills inside the game project fit that; a folder shared by all games changes every game at once.

## Frontmatter

| Field | Agent Skills | Codex 0.163.0 | Claude Code 2.1.301 |
| --- | --- | --- | --- |
| `name` | Required; at most 64 lowercase letters, digits and hyphens; equals the folder | Defaults to the folder, though the documentation requires it; at most 64 characters, unchecked | Optional; becomes the command, with the folder name as an alias |
| `description` | Required; at most 1,024 characters | Required: without it the skill fails to load | Optional; defaults to the first line of the body |
| `license`, `compatibility` | Optional | Ignored | Accepted, not acted on |
| `metadata` | Optional map of strings | Only `short-description`, as the short description | Accepted, not acted on |
| `allowed-tools` | Optional, experimental | Ignored | Pre-approves tools for the turn that invokes the skill |
| `disable-model-invocation`, `user-invocable`, `argument-hint`, `arguments`, `when_to_use`, `model`, `effort`, `context`, `agent`, `paths`, `hooks`, `shell`, `disallowed-tools` | Not defined | Ignored | Acted on |

Sources: [specification][spec], [parser.rs][codex-parser], [skills][cc-skills]; the `name` and `description` rows were also Observed.

- **Parsing (Documented, Observed).** Codex rejects a skill whose front matter is missing or whose YAML does not parse once unquoted colons are repaired, and reports it in `skills/list` ([parser.rs][codex-parser]). Claude loads a skill with unparsable YAML "with no fields set", treats a file without front matter as body, ignores unknown fields and accepts `yes`, `no`, `on`, `off`, `1` and `0` as booleans ([skills][cc-skills]). Neither checks the specification's name rules: both loaded `Bad_Name`.
- **Codex's own metadata (Documented).** An `agents/openai.yaml` beside `SKILL.md` holds `interface`, `dependencies` and `policy.allow_implicit_invocation` ([build skills][codex-skills]); Claude treats it as an ordinary file. `allow_implicit_invocation: false` hides a skill from Codex's model but keeps `$name` working ([provider/host.rs][codex-hidden]), as `disable-model-invocation: true` does in Claude. Codex has nothing like `user-invocable: false`.
- **Listing budgets (Documented).** Codex's list of skills takes at most 2% of the context window, or 8,000 characters when that is unknown, and shortens descriptions first ([build skills][codex-skills]). Claude's takes 1% and cuts each `description` with its `when_to_use` at 1,536 characters ([skills][cc-skills]).
- **Inference.** Front matter both honour: a `name` equal to the folder, in lowercase with hyphens, and a `description` of at most 1,024 characters that puts the key use first. Claude-only fields can stay, since Codex ignores them; a Codex-only policy goes in `agents/openai.yaml`.

## Where each provider reads skills and instructions

| Provider: what | macOS | Linux | Windows |
| --- | --- | --- | --- |
| Codex: project skills | `.agents/skills` in each folder from the working folder up to the project root; also `.codex/skills` | Same | Same |
| Codex: personal skills | `~/.agents/skills`; `~/.codex/skills` (deprecated) | Same | `%USERPROFILE%\.agents\skills`; `%USERPROFILE%\.codex\skills` |
| Codex: admin skills | `/etc/codex/skills` | `/etc/codex/skills` | `%ProgramData%\OpenAI\Codex\skills` |
| Codex: bundled skills | `~/.codex/skills/.system` | Same | `%USERPROFILE%\.codex\skills\.system` |
| Codex: instructions | `~/.codex/AGENTS.md`, then `AGENTS.md` from the project root down to the working folder | Same | `%USERPROFILE%\.codex\AGENTS.md`, then as on macOS |
| Claude: project skills | `.claude/skills` in the working folder and its parents up to the repository root; deeper ones once used | Same | Same |
| Claude: personal skills | `~/.claude/skills`, or `$CLAUDE_CONFIG_DIR/skills` | Same | `%USERPROFILE%\.claude\skills`, or under `CLAUDE_CONFIG_DIR` |
| Claude: admin skills | `/Library/Application Support/ClaudeCode/.claude/skills` | `/etc/claude-code/.claude/skills` | `C:\Program Files\ClaudeCode\.claude\skills` |
| Claude: instructions | `CLAUDE.md` in the managed folder, `~/.claude/CLAUDE.md`, then `CLAUDE.md` in the working folder and every parent; `AGENTS.md` only where none exists | Same | Same, with Windows paths |
| A committed link | Followed by both | Followed by both (Inference) | A link only with `core.symlinks=true` and Developer Mode or the privilege; otherwise a text file, and the linked provider sees no project skills |

`CODEX_HOME` moves `~/.codex`, and `CLAUDE_CONFIG_DIR` moves `~/.claude`. The Windows paths for Codex come from its source ([host_roots.rs][codex-roots], [config loader][codex-system-dir]); nothing was run on Windows.

## Open points

- Whether a fresh clone on Windows 11 23H2, with Developer Mode on and Git for Windows' defaults, gets working folder links, and whether both providers then load the skills.
- Whether Codex and Claude Code follow a folder junction on Windows, and what Git reports when Playstead puts a junction where Git wrote a text file.
- Linux was not run.
- Claude's instruction loading was not observed. No `InstructionsLoaded` hook fired before a turn, and a turn needs a sign-in.
- Whether a signed-out or first session reads `AGENTS.md` directly; the documentation ties some cases to fetched feature flags.
- Which name a Claude `skillOverrides` entry needs when a skill's front-matter `name` differs from its folder.
- Whether Codex honours `[[skills.config]]` passed in a thread's `config`, which would let Playstead turn a skill off for one game. 0.163.0 reads these rules only from the user layer and session flags.
- How Claude Code ranks a project skill against an added folder's skill of the same name.
- OpenAI's documentation describes `perCwdExtraUserRoots` and `SKILL.json`, which 0.163.0 lacks; check again when Playstead moves to a newer Codex.

[ticket]: https://github.com/softhatgames/playstead/issues/85
[issue-68]: https://github.com/softhatgames/playstead/issues/68
[product]: ../PRODUCT.md#skills-under-user-control
[codex-skills]: https://learn.chatgpt.com/docs/build-skills
[codex-agents]: https://learn.chatgpt.com/docs/agent-configuration/agents-md
[codex-as]: https://learn.chatgpt.com/docs/app-server
[codex-sec]: https://learn.chatgpt.com/docs/agent-approvals-security
[codex-plugins]: https://developers.openai.com/plugins/build/plugins
[codex-tag]: https://github.com/openai/codex/tree/rust-v0.163.0
[codex-roots]: https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/ext/skills/src/host_roots.rs#L73-L185
[codex-discovery]: https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/ext/skills/src/loader/discovery.rs#L54-L177
[codex-loader]: https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/ext/skills/src/loader/host.rs#L146-L182
[codex-walk]: https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/exec-server/src/local_file_system.rs#L803-L805
[codex-selection]: https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/skills/src/selection.rs#L166-L198
[codex-catalog]: https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/app-server/src/request_processors/catalog_processor.rs#L515-L611
[codex-skills-config]: https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/config/src/skills_config.rs#L39-L56
[codex-agents-md]: https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/core/src/agents_md.rs#L189-L270
[codex-namespace]: https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/ext/skills/src/loader/namespace.rs
[codex-parser]: https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/skills/src/parser.rs#L44-L92
[codex-hidden]: https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/ext/skills/src/provider/host.rs#L165-L167
[codex-system-dir]: https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/config/src/loader/mod.rs#L803-L813
[codex-store]: https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/core-plugins/src/store.rs#L86-L118
[cc-skills]: https://code.claude.com/docs/en/skills
[cc-memory]: https://code.claude.com/docs/en/memory
[cc-sdk-skills]: https://code.claude.com/docs/en/agent-sdk/skills
[cc-plugin-loading]: https://code.claude.com/docs/en/plugins/loading
[cc-permissions]: https://code.claude.com/docs/en/permissions
[cc-modes]: https://code.claude.com/docs/en/permission-modes
[cc-managed]: https://code.claude.com/docs/en/managed-settings
[spec]: https://agentskills.io/specification
[spec-client]: https://agentskills.io/client-implementation/adding-skills-support
[t3-tree]: https://github.com/pingdotgg/t3code/tree/2577baf8b0dc541283fa93d6919b0e354effadf4/.claude
[t3-claude-skills]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/apps/server/src/provider/Drivers/ClaudeSkills.ts#L100-L340
[t3-codex-provider]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/apps/server/src/provider/CodexProvider.ts#L277-L533
[t3-codex-adapter]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts#L414-L420
[git-config]: https://git-scm.com/docs/git-config#Documentation/git-config.txt-coresymlinks
[gfw-symlinks]: https://gitforwindows.org/symbolic-links
[gfw-mingw]: https://github.com/git-for-windows/git/blob/d912ae6dff614da7b460415bcc981baab8ff0771/compat/mingw.c#L3842-L3857
[gfw-installer]: https://github.com/git-for-windows/build-extra/blob/43a5d8a015a8aefa6ff15c043aa1b9b89f60e615/installer/install.iss#L1342-L1370
[ms-symlink]: https://learn.microsoft.com/windows/win32/api/winbase/nf-winbase-createsymboliclinkw
[ms-devmode]: https://learn.microsoft.com/windows/advanced-settings/developer-mode
[ms-fscc]: https://learn.microsoft.com/openspecs/windows_protocols/ms-fscc/c8e77b37-3909-4fe6-a4ea-2b9d423b1ee4
[rust-std]: https://github.com/rust-lang/rust/blob/1.95.0/library/std/src/sys/fs/windows.rs#L1187-L1195
