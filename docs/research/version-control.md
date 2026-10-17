# Version control

- **Question:** Which version control system should Playstead build slice 4 on, and the prototypes after it: Git, as T3 Code does, or another, such as Jujutsu? ([Version control for Playstead: Git or another system](https://github.com/softhatgames/playstead/issues/86))
- **Date:** 2026-10-17. All sources were accessed on this date.
- **Outcome:** a recommendation; the founder decides. Build slice 4 on Git, driven through its command line as T3 Code does: checkpoints as hidden refs, Initialize, the changed-files card, **Edit from here** with file revert, and worktrees. Give each prototype a worktree too, filled by a copy-on-write clone of the game's files where the volume supports it and by Git's own checkout elsewhere. Keep art and sound in plain Git for 0.1's small games, without Git LFS. Jujutsu is not ready to build on: it calls itself experimental, its command line is not stable for programs, it has no Git LFS and by default leaves new files over 1 MiB untracked, and T3 Code's support for it is an unapproved draft. A colocated Jujutsu repository is still a Git repository, so the choice can be revisited without moving any game project.
- **Versions:** T3 Code at `2577baf`, checked against `origin/main` at `db5919d`. Git 2.56.0, Git for Windows 2.56.0.windows.2, Git LFS 3.8.0, Jujutsu 0.46.0, Sapling 0.2.20260929, Node.js 24.15.0 with libuv 1.51.0, .NET runtime source at `v10.0.0`, Linux source at `v6.17`.
- **Local evidence:** timing and disk checks on a macOS 26.6.2 (Apple silicon, APFS) development computer, in a scratch folder under `/tmp` that was then deleted. They used Apple's Git 2.50.1, .NET SDK 10.0.103, Node.js 24.15.0, and a MonoGame DesktopGL 3.8.6 project of 42 C# files with 300 MB of incompressible assets. Other builds were running on the computer, so times are indicative; disk use was read with `df` over short windows. Jujutsu, Git LFS, Windows and Linux were not run.

Labels: **Documented** (official documentation, source code, release notes and maintainers' statements), **Observed** (the local checks), **Inference** (reasoning, not a source) and **Unconfirmed** (not established).

## T3 Code's model

- **Git as a separate program (Documented).** Every operation spawns `git -C <folder> …`; no Git library is a dependency ([GitVcsDriver.ts][t3-git-driver], [VcsProcess.ts][t3-vcs-process]). Settings probes `git --version` and shows an install hint when Git is missing ([SourceControlDiscovery.ts][t3-discovery]).
- **Checkpoints (Documented).** A checkpoint is "a saved workspace state used for diffs and restore, stored as a hidden Git ref" ([glossary][t3-glossary]). Capture copies the index to a temporary file, then runs `read-tree`, `add -A`, `write-tree`, `commit-tree` with HEAD as parent, and `update-ref` under `refs/t3/orchestration-v2/checkpoints/`, flushing objects and refs to disk ([GitVcsDriver.ts][t3-git-driver], [CheckpointService.ts][t3-checkpoint-service]). The person's staging area, HEAD and branch are untouched.
- **What a checkpoint holds (Observed).** The same commands in the scratch game captured a new untracked asset and left out the ignored `bin/` and `obj/`. After two 5 MB assets changed, the checkpoint added 10 MB to the repository; with nothing changed, `add -A` took 0.01 s.
- **Restore (Documented, Observed).** `git restore --source <checkpoint> --worktree --staged`, then `git clean -fd`, which keeps ignored files ([GitVcsDriver.ts][t3-git-driver]). In the scratch game, `git restore` took 0.07 s; with `git clean` it reverted a source edit and removed a stray file, and `bin/` survived.
- **Without Git (Documented).** In a folder that is not a Git repository, checkpoints are marked missing ([CheckpointService.ts][t3-checkpoint-service]). Threads without a project work in `~/.t3/scratch`, which is not a Git repository ([thread-sidebar.md][t3-threads]).
- **Slice 4's features (Documented).**
  - The changed-files card lists the turn's own files: a numstat diff between consecutive checkpoints, without the files a pull, merge or rebase brought in ([source-control.md][t3-source-control], [CheckpointService.ts][t3-checkpoint-service]).
  - Initialize runs `git init`. Status polls `git status --porcelain=2 --branch`, every 30 seconds by default ([GitVcsDriver.ts][t3-git-driver], [GitVcsDriverCore.ts][t3-git-core], [VcsStatusBroadcaster.ts][t3-status]).
  - In **Edit from here**, file restore "is only offered for threads running in a worktree, and it is refused when another thread or agent session also uses that directory"; a thread in the project's own folder rewinds the conversation only ([composer.md][t3-composer], [CheckpointRestoreSafety.ts][t3-restore-safety]).
  - A worktree is `git worktree add -b <branch> <T3 home>/worktrees/<repository>/<branch>`, followed by submodules and any `t3.json` script marked `runOnWorktreeCreate`, which receives `T3CODE_PROJECT_ROOT` and `T3CODE_WORKTREE_PATH` ([GitVcsDriverCore.ts][t3-git-core], [t3ProjectFile.ts][t3-project-file], [projectScripts.ts][t3-project-scripts]). The worktree folder can move to another drive. Cleanup can remove a worktree while "Branches and thread history stay; starting another turn recreates the checkout" ([project-settings.md][t3-project-settings]).
  - On Windows every Git call sets `core.longpaths`, because without it "deep worktrees fail to check out and fail midway through removal" ([GitVcsDriverCore.ts][t3-git-core]).
- **The `VcsDriver` abstraction (Documented).** Drivers have the kinds `git`, `jj` and `unknown`, but only Git is registered. A project can ask for a kind in `.t3code/vcs.json`, and Settings probes `jj --version` marked `implemented: false` ([vcs.ts][t3-vcs-contract], [VcsDriverRegistry.ts][t3-registry], [VcsProjectConfig.ts][t3-project-config], [SourceControlDiscovery.ts][t3-discovery]). The pull request that added the abstraction calls it "a core rearchitecture we can add `JJ`, `GitLab`, `BitBucket` on top of later" ([#2435][t3-2435]). Its plan asked that "a Jujutsu driver does not have to pretend to be Git" ([plan][t3-plan]). Nothing on `main` reads the capability flags ([#18468][t3-18468]).
- **Work toward Jujutsu (Documented).** The maintainer closed earlier attempts, the last "for missing approval of the current direction and scope" ([#2461][t3-2461], [#13816][t3-13816]). A proposal awaits approval: colocated repositories only, where "diffs, checkpoint refs and hosting keep using git" ([#18468][t3-18468]). Eight draft pull requests opened on 2026-10-17 require Jujutsu 0.46. Their checkpoints stay raw `refs/t3/` refs, restored with `jj restore`, and they had "No manual run in a real client or Windows testing" ([#20749][t3-20749], [#20750][t3-20750]).
- **Since `2577baf` (Documented).** Up to `db5919d`, `vcs/` received two refactors and the model is unchanged ([73d70a4][t3-73d70a4], [8e0d5e5][t3-8e0d5e5]).
- **Agents (Documented).** Under `workspace-write`, Codex keeps `.git` read-only, including the Git folder a worktree's `.git` file points to; it does not mention `.jj` ([Codex][codex-protected]). Inference: an agent in that sandbox cannot commit, so the host writes checkpoints and commits, as [interface concepts](interface-concepts.md#decisions) decided.

## Candidates

### Git

- **Platforms (Documented).**
  - macOS: "Apple ships a binary package of Git with Xcode Command Line Tools"; Homebrew and MacPorts also have it ([git-scm][git-mac]). Observed: this computer's Git is 2.50.1 (Apple Git-155), without `git lfs`.
  - Windows: Git for Windows 2.56.0.windows.2 has installers for x64 and arm64 ([release][gfw-release]). Its installer adds Git LFS and sets `core.autocrlf=true` by default ([install.iss][gfw-installer]).
  - Linux: distribution packages, such as 2.34.1 on Ubuntu 22.04, 2.43.0 on 24.04, 2.53.0 on 26.04 and 2.47.3 on Debian 13 ([Ubuntu][ubuntu-git], [Debian][debian-git]), all systems .NET 10 supports ([.NET 10][dotnet-os]).
  - Bundling: GitHub Desktop's dugite-native builds Git for all six platforms, under GPL-2.0 ([dugite-native][dugite]).
- **Driving it (Documented).** Plumbing commands are "meant to be a lot more stable than Porcelain level commands, because these commands are primarily for scripted use" ([git(1)][git-doc]). `git status --porcelain` output "will remain stable across Git versions and regardless of user configuration" ([git-status][git-status]).
- **Licence and pace (Documented).** GPL version 2 only ([COPYING][git-copying]); T3 Code runs it as a separate program. A release comes every 10 to 13 weeks, from 2.52.0 on 2025-11-17 to 2.56.0 on 2026-09-28 ([tags][git-tags]). "Minor releases will not break backwards compatibility unless there is a very strong reason to do so". Git 3.0 has "no planned release date"; it will default new repositories to SHA-256, reftable and the branch name `main` ([BreakingChanges][git-breaking]).
- **Worktrees and sparse checkouts (Documented).** A worktree shares the repository "except per-worktree files such as `HEAD`, `index`, etc."; refs under `refs/` are shared, so every worktree sees every checkpoint ([git-worktree][git-worktree]). The same page says "Multiple checkout in general is still experimental, and the support for submodules is incomplete." The `git sparse-checkout` page says "THIS COMMAND IS EXPERIMENTAL" ([git-sparse-checkout][git-sparse]).
- **The person's tools (Documented).** "Visual Studio Code has built-in Git support", using an installed Git ([VS Code][vscode-git]). Visual Studio has a Git interface and suggests Git for Windows for the command line ([Visual Studio][vs-git]).

### Jujutsu

- **Platforms and licence (Documented).** 0.46.0 ships binaries for macOS, Windows and Linux on arm64 and x64 ([release][jj-release]), under Apache-2.0. The installation page lists Homebrew, MacPorts, winget, scoop, Arch, Fedora COPR and others, and no Debian or Ubuntu package ([installation][jj-install]). 0.46.0 needs the `git` command at 2.42.0 or later ([changelog][jj-changelog]), newer than Ubuntu 22.04's.
- **Maturity (Documented).** "Jujutsu is an **experimental version control system**. While Git compatibility is stable, and most developers use it daily for all their needs, there may still be work-in-progress features, suboptimal UX, and workflow gaps that make it unusable for your particular use." "There *will* be changes to workflows and backward-incompatible changes to the on-disk formats before version 1.0.0" ([README][jj-readme]). It releases monthly. Eleven of the twelve releases from 0.35.0 (2025-11-05) to 0.46.0 (2026-10-07) list breaking changes, 53 in all ([changelog][jj-changelog]).
- **Driving it (Documented).** Its FAQ says "`jj-lib` is not a stable API" and "The CLI is not stable either, so you may need to make your tool detect the different versions and call the right command" ([FAQ][jj-faq]). JSON from its templates is "usually stable across jj versions, but the backward compatibility isn't guaranteed" ([templates][jj-templates]); 0.46.0 itself changed what `List.get()`, `.first()` and `.last()` return ([changelog][jj-changelog]). An RPC API for tools is on the roadmap without a date ([roadmap][jj-roadmap]). Inference: the library is Rust, so Playstead's Node server would need a native module; the command line is the practical route.
- **Beside Git (Documented).** `jj git init` colocates by default: `.jj` and `.git` share one working copy, and Git usually sees a detached HEAD ([Git compatibility][jj-git]). Git LFS ([#80][jj-80], open since 2022), `.gitattributes`, hooks, submodules, partial clones, Git's sparse checkout and Git's own worktrees are listed as unsupported. Since 0.46.0, `jj workspace add` can colocate a workspace by creating a Git worktree ([changelog][jj-changelog]). Without colocation, the Git repository sits inside `.jj` and has no branches, or outdated ones, unless exported ([Git compatibility][jj-git]).
- **Windows (Documented).** Jujutsu reads neither `core.autocrlf` nor `.gitattributes`, and its Windows page asks users to keep `working-copy.eol-conversion` in step with `core.autocrlf` ([Windows][jj-windows]). Git for Windows sets `core.autocrlf=true` by default ([install.iss][gfw-installer]).
- **The working copy is a commit (Documented).** "Most `jj` commands you run will commit the working-copy changes if they have changed" ([working copy][jj-working-copy]). `jj undo` and `jj op restore` undo whole operations, including the effects of Git commands ([Git compatibility][jj-git]).
- **Large files (Documented).** By default Jujutsu refuses to start tracking a new file larger than 1 MiB (`snapshot.max-new-file-size`) ([config][jj-config], [misc.toml][jj-misc]). Its roadmap lists "Better support for large files" without a date ([roadmap][jj-roadmap]).
- **The person's tools (Documented).** Git tools work in a colocated repository. Jujutsu's own list includes the GG interface, VisualJJ and Jujutsu Kaizen for VS Code, and a plugin for IntelliJ IDEA ([community tools][jj-tools]).

### Other systems

- **Sapling (Documented).** GPL-2.0. Its release of 2026-09-29 ships Linux arm64 and x64, Windows x64 and a macOS arm64 Homebrew bottle, so Windows arm64 and Intel Macs are missing ([releases][sapling-releases]). A T3 Code inquiry about it closed without a reply ([#4327][t3-4327]).
- **Perforce P4 (Documented).** A server-based system that "is free for up to 5 users and 20 workspaces" ([Perforce][p4-free]). Inference: it needs a server and an account, and 20 workspaces would cap a game project's copies.
- **No real case (Inference).** Sapling misses two of the six platforms and P4 needs a server; T3 Code supports neither.

## What game projects ask of it

### A copy per prototype

- **Git's checkout (Observed).** `git worktree add` of the scratch game took 0.17–0.21 s and used 301 MiB, the full size of the files. Inference: Git writes each file from its object store, so a checkout cannot share disk blocks with the game's files.
- **A copy-on-write clone (Observed).** The other route adds a worktree with `--no-checkout`, clones the game's files into it with `cp -c -R`, and loads the index with `git reset`. The clone took 0.08–0.09 s and no disk space; `git reset` took 0.9 s, hashing the 300 MB again. `git status` was then clean, and the copy's tree id matched the game's commit. For 1 GiB, `cp -c -R` took 0.03–0.13 s and no space; plain `cp -R` took 0.31 s and 1,024 MiB.
- **What a clone carries (Inference).** A clone copies the game's folder as it is: uncommitted changes, and ignored files such as local settings and build output. A checkout starts from a commit, so the copy setup must bring the ignored files a copy needs.
- **Building in a copy (Observed).** A cold `dotnet build` in a fresh worktree took 0.86 s with the build servers already running, and 1.75 s with `--disable-build-servers`. A clone that carried the game's `bin/` and `obj/` still recompiled, in 1.61 s, after restore ran again for the new path; only the next build skipped the compiler, in 0.50 s. Carrying `obj/` across buys little. MonoGame's content pipeline was not part of the test.
- **Build output is cloned too (Documented, Observed).** .NET 10's `File.Copy` tries `clonefile` on macOS and `FICLONE` on Linux ([TryCloneFile.OSX.cs][dotnet-clone-osx], [pal_io.c][dotnet-pal-io]). The first build copied the 300 MB of assets into `bin/` and used about 1 MiB of disk.
- **Where clones work (Documented).**
  - macOS: APFS is "the default file system for Mac computers using macOS 10.13 or later" ([Disk Utility][apple-apfs]). `clonefile` and `cp -c` clone within one volume, and `cp -c` falls back to copying when "the source and target are on different filesystems" ([clonefile(2)][apple-clonefile], [cp(1)][apple-cp]).
  - Windows: ReFS block cloning needs both files "on the same ReFS volume", and "Starting with Windows 11 24H2 and Windows Server 2025 builds, block cloning occurs natively in supported Windows copy operations" ([block cloning][ms-block-cloning]). A Dev Drive is a ReFS volume; it needs Windows 11 build 22621.2338 or later, 50 GB, administrator rights, and cannot be drive C: ([Dev Drive][ms-dev-drive]). Inference: on the usual NTFS drive every copy is full.
  - Linux: the `FICLONE` ioctl, since Linux 4.5 ([ioctl_ficlone(2)][linux-ficlone]). In Linux 6.17, Btrfs and XFS implement it and ext4 does not ([ext4][linux-ext4], [XFS][linux-xfs], [Btrfs][linux-btrfs]). `cp` has defaulted to copy-on-write since coreutils 9.0 ([NEWS][coreutils-news]), and Fedora's desktops default to Btrfs since Fedora 33 ([Fedora][fedora-btrfs]).
- **Node cannot clone on macOS (Observed, Documented).** In Node.js 24.15.0 on APFS, `fs.copyFile` with `COPYFILE_FICLONE_FORCE` failed with `ENOSYS`, and with `COPYFILE_FICLONE` it copied the full 1 GiB. libuv 1.51.0 clones only through Linux's `FICLONE`, and on Windows it calls `CopyFileW` ([unix/fs.c][libuv-unix], [win/fs.c][libuv-win], [fs][node-fs]). Inference: Playstead's server would call `cp -c` on macOS, or a helper.
- **Sparse checkouts and partial clones (Inference).** A prototype has to build and play the whole game, so a copy without some assets does not fit. Partial clones fetch missing files from a remote, which a local game project may not have.

### Keeping and discarding

- **Where history lives (Inference).** Refs and objects live in the game project's `.git`, and copies in Playstead's data, as interface concepts chose. Losing Playstead's home loses copies and the work since their last checkpoint, not the history.
- **Kept (Inference).** A prototype with its own Git branch can take the game's later commits in its own worktree, then go into the game as one merge. Git cannot merge binary assets line by line, so the agent picks a side. Jujutsu would rebase automatically and record conflicts in commits ([README][jj-readme]).
- **Keeping undone (Inference).** A keep made as one merge can be reverted, or the game's branch moved back if nothing followed it.
- **Discarded (Documented).** A ref keeps everything reachable from it. `git gc` prunes unreachable objects after two weeks and stale worktree records after three months, and reflog entries expire after 30 or 90 days ([gc][git-gc-config]). Inference: removing a discarded prototype's worktree frees its disk, and playing it again re-creates the copy and rebuilds, as T3 Code re-creates a cleaned worktree.

### Revisions, large files and upgrades

- **A revision with uncommitted changes (Documented, Observed).** T3 Code's capture turns any state of the files into a commit without touching HEAD or the staging area. Its tree id names the content, because an object "is uniquely identified by the SHA-1 of its contents" ([glossary][git-glossary]). Two copies with the same files gave the same tree id. Ignored files are outside it.
- **Large binaries in Git (Observed, Documented).** Staging 300 MB of incompressible assets took 5.4 s and grew the repository by 301 MB, so the assets sit on disk twice. Files over `core.bigFileThreshold`, 512 MiB by default, skip delta compression ([core][git-core-config]). GitHub warns above 50 MiB, blocks files over 100 MiB, and recommends repositories under 1 GB ([GitHub][github-large-files]).
- **Git LFS (Documented).** MIT-licensed, with builds for all six platforms ([release][lfs-release], [licence][lfs-licence]). Git for Windows installs it by default ([install.iss][gfw-installer]); Apple's Git lacks it (Observed). Its local store defaults to `.git/lfs` ([config][lfs-config]), and `git lfs dedup` turns working files into clones of that store ([dedup][lfs-dedup]). Inference: every version still lives on the local disk, so LFS saves no local space; 0.1's small 2D games fit plain Git, and LFS matters when a file nears a host's limit.
- **Undoing an upgrade "through Git" (Inference).** If each game project upgrade is one commit, `git revert` undoes it with or without Playstead, as [the compatibility promise](../ROADMAP.md#compatibility-from-01) asks. With Jujutsu alone the promise would need rewording.

## Recovery without Playstead

- **Git (Documented).** `git worktree list`, `repair` and `prune` find copies, reconnect them and clear stale ones. Worktrees link with absolute paths by default, so moving the game project needs `git worktree repair` ([git-worktree][git-worktree]). `git for-each-ref` lists hidden refs, and `git fsck --lost-found` writes out dangling commits ([git-fsck][git-fsck]). Inference: Git tools list branches, not hidden refs, so a prototype is easiest to find as a branch.
- **Jujutsu (Documented).** `jj op log`, `jj undo` and `jj op restore` return to any earlier state, and refs under `refs/jj/` keep its commits from Git's garbage collection ([Git compatibility][jj-git]). Inference: the operation log needs jj; Git alone sees only the commits.
- **Folders without Git (Documented, Inference).** Git's `--git-dir` and `--work-tree` keep a repository outside the folder it tracks ([git(1)][git-doc]), so the shadow repository in [interface concepts](interface-concepts.md#decisions) is possible with Git. T3 Code captures no checkpoints in such a folder. Every game project 0.1 creates has Git, so a shadow repository can wait for adding existing games after 0.1.

## Comparison

| Need                              | Git, as T3 Code                     | Jujutsu, colocated                   | Jujutsu alone                | Sapling                       | Perforce P4                   |
| --------------------------------- | ----------------------------------- | ------------------------------------ | ---------------------------- | ----------------------------- | ----------------------------- |
| Slice 4 as T3 Code builds it      | Yes                                 | Unapproved draft                     | No                           | No                            | No                            |
| Six platforms                     | Yes                                 | Yes, with Git 2.42 or later          | Yes                          | No Windows arm64 or Intel Mac | Not checked                   |
| Driven by a program               | Stable plumbing and porcelain       | Command line and library not stable  | Not stable                   | Not checked                   | Not checked                   |
| Licence                           | GPL-2.0, run as a separate program  | Apache-2.0                           | Apache-2.0                   | GPL-2.0                       | Proprietary, with a free tier |
| Large art and sound               | Full copy per version; LFS optional | No LFS; new files over 1 MiB skipped | Same                         | Not checked                   | Not checked                   |
| Copy per prototype                | Worktree, or a clone in a worktree  | Workspace as a Git worktree (0.46)   | Workspace                    | Not checked                   | Workspace; 20 free            |
| Revision with uncommitted changes | Checkpoint commit and tree id       | The working copy is a commit         | The working copy is a commit | Not checked                   | Not checked                   |
| Recovery without Playstead        | Git and every Git tool              | Jujutsu; Git sees the commits        | Jujutsu only                 | Sapling                       | P4 client and server          |
| An upgrade undone "through Git"   | Yes                                 | Through the colocated Git            | No                           | No                            | No                            |

## Open points

- Copies on Windows: whether `CopyFileW`, and so Node's `fs.copyFile`, block-clones on a Dev Drive under Windows 11 24H2; what 23H2 does; how long a full copy takes on NTFS with Defender on.
- Copies on Linux: Node's `COPYFILE_FICLONE` on Btrfs and XFS, and full copies on ext4.
- MonoGame's content pipeline in a fresh copy: its time, and whether carried-over output stays valid at a new path. **Creating a new game project** (#93) asks how soon a copy is playable.
- Whether a running game holding files open on Windows blocks restoring or removing its copy (Unconfirmed).
- Git LFS with checkpoints: clean filters on every capture, and whether `git lfs prune` respects hidden refs.
- For **Prototypes: making, keeping and discarding** (#96): whether a prototype starts from the game's last commit or from its folder as it is; how prototypes are named in Git, as branches or hidden refs; and how long checkpoints are kept.
- Whether the maintainer approves the Jujutsu stack ([#18468][t3-18468]); the weekly review should flag it.
- Git 3.0's SHA-256 and reftable defaults: whether Git LFS, editors and Jujutsu read such repositories before Playstead creates one.
- Jujutsu under Codex's sandbox, which protects `.git` but not `.jj` (Unconfirmed).

[t3-git-driver]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/apps/server/src/vcs/GitVcsDriver.ts
[t3-git-core]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/apps/server/src/vcs/GitVcsDriverCore.ts
[t3-vcs-process]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/apps/server/src/vcs/VcsProcess.ts
[t3-registry]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/apps/server/src/vcs/VcsDriverRegistry.ts
[t3-project-config]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/apps/server/src/vcs/VcsProjectConfig.ts
[t3-status]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/apps/server/src/vcs/VcsStatusBroadcaster.ts
[t3-vcs-contract]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/packages/contracts/src/vcs.ts
[t3-discovery]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/apps/server/src/sourceControl/SourceControlDiscovery.ts
[t3-checkpoint-service]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/apps/server/src/orchestration-v2/CheckpointService.ts
[t3-restore-safety]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/apps/server/src/orchestration-v2/CheckpointRestoreSafety.ts
[t3-project-file]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/packages/contracts/src/t3ProjectFile.ts
[t3-project-scripts]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/packages/shared/src/projectScripts.ts
[t3-glossary]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/docs/internals/glossary.md
[t3-source-control]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/docs/user/source-control.md
[t3-project-settings]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/docs/user/project-settings.md
[t3-composer]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/docs/user/composer.md
[t3-threads]: https://github.com/pingdotgg/t3code/blob/2577baf8b0dc541283fa93d6919b0e354effadf4/docs/user/thread-sidebar.md
[t3-2435]: https://github.com/pingdotgg/t3code/pull/2435
[t3-plan]: https://github.com/pingdotgg/t3code/blob/6d7fe2eeb7d2731da3f7f69988056ff7a5d3b921/.plans/19-version-control-phase-1-vcs-driver-foundation.md
[t3-2461]: https://github.com/pingdotgg/t3code/pull/2461
[t3-13816]: https://github.com/pingdotgg/t3code/pull/13816
[t3-18468]: https://github.com/pingdotgg/t3code/discussions/18468
[t3-20749]: https://github.com/pingdotgg/t3code/pull/20749
[t3-20750]: https://github.com/pingdotgg/t3code/pull/20750
[t3-4327]: https://github.com/pingdotgg/t3code/issues/4327
[t3-73d70a4]: https://github.com/pingdotgg/t3code/commit/73d70a444b70c735d990252b453d9b7a4ca63e17
[t3-8e0d5e5]: https://github.com/pingdotgg/t3code/commit/8e0d5e5e4dafb2e9fb9b35190eda456ffed07a18
[codex-protected]: https://learn.chatgpt.com/docs/agent-approvals-security#protected-paths-in-writable-roots
[git-mac]: https://git-scm.com/install/mac
[git-doc]: https://github.com/git/git/blob/v2.56.0/Documentation/git.adoc
[git-status]: https://github.com/git/git/blob/v2.56.0/Documentation/git-status.adoc
[git-copying]: https://github.com/git/git/blob/v2.56.0/COPYING
[git-tags]: https://github.com/git/git/tags
[git-breaking]: https://github.com/git/git/blob/v2.56.0/Documentation/BreakingChanges.adoc
[git-worktree]: https://github.com/git/git/blob/v2.56.0/Documentation/git-worktree.adoc
[git-sparse]: https://github.com/git/git/blob/v2.56.0/Documentation/git-sparse-checkout.adoc
[git-gc-config]: https://github.com/git/git/blob/v2.56.0/Documentation/config/gc.adoc
[git-core-config]: https://github.com/git/git/blob/v2.56.0/Documentation/config/core.adoc
[git-glossary]: https://github.com/git/git/blob/v2.56.0/Documentation/glossary-content.adoc
[git-fsck]: https://github.com/git/git/blob/v2.56.0/Documentation/git-fsck.adoc
[gfw-release]: https://github.com/git-for-windows/git/releases/tag/v2.56.0.windows.2
[gfw-installer]: https://github.com/git-for-windows/build-extra/blob/43a5d8a015a8aefa6ff15c043aa1b9b89f60e615/installer/install.iss
[ubuntu-git]: https://packages.ubuntu.com/search?keywords=git&searchon=names&exact=1&suite=all&section=all
[debian-git]: https://packages.debian.org/search?keywords=git&searchon=names&exact=1&suite=all&section=all
[dotnet-os]: https://github.com/dotnet/core/blob/main/release-notes/10.0/supported-os.md
[dugite]: https://github.com/desktop/dugite-native/releases/tag/v2.53.0-4
[vscode-git]: https://code.visualstudio.com/docs/sourcecontrol/overview
[vs-git]: https://learn.microsoft.com/visualstudio/version-control/git-with-visual-studio
[lfs-release]: https://github.com/git-lfs/git-lfs/releases/tag/v3.8.0
[lfs-licence]: https://github.com/git-lfs/git-lfs/blob/v3.8.0/LICENSE.md
[lfs-dedup]: https://github.com/git-lfs/git-lfs/blob/v3.8.0/docs/man/git-lfs-dedup.adoc
[lfs-config]: https://github.com/git-lfs/git-lfs/blob/v3.8.0/docs/man/git-lfs-config.adoc
[github-large-files]: https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github
[jj-release]: https://github.com/jj-vcs/jj/releases/tag/v0.46.0
[jj-readme]: https://github.com/jj-vcs/jj/blob/v0.46.0/README.md
[jj-changelog]: https://github.com/jj-vcs/jj/blob/v0.46.0/CHANGELOG.md
[jj-faq]: https://github.com/jj-vcs/jj/blob/v0.46.0/docs/FAQ.md
[jj-templates]: https://github.com/jj-vcs/jj/blob/v0.46.0/docs/templates.md
[jj-roadmap]: https://github.com/jj-vcs/jj/blob/v0.46.0/docs/roadmap.md
[jj-git]: https://github.com/jj-vcs/jj/blob/v0.46.0/docs/git-compatibility.md
[jj-windows]: https://github.com/jj-vcs/jj/blob/v0.46.0/docs/windows.md
[jj-working-copy]: https://github.com/jj-vcs/jj/blob/v0.46.0/docs/working-copy.md
[jj-config]: https://github.com/jj-vcs/jj/blob/v0.46.0/docs/config.md
[jj-misc]: https://github.com/jj-vcs/jj/blob/v0.46.0/cli/src/config/misc.toml
[jj-install]: https://github.com/jj-vcs/jj/blob/v0.46.0/docs/install-and-setup.md
[jj-tools]: https://github.com/jj-vcs/jj/blob/v0.46.0/docs/community_tools.md
[jj-80]: https://github.com/jj-vcs/jj/issues/80
[sapling-releases]: https://github.com/facebook/sapling/releases
[p4-free]: https://www.perforce.com/products/helix-core/free-version-control
[apple-apfs]: https://support.apple.com/guide/disk-utility/file-system-formats-dsku19ed921c/mac
[apple-clonefile]: https://github.com/apple-oss-distributions/xnu/blob/xnu-12377.121.6/bsd/man/man2/clonefile.2
[apple-cp]: https://github.com/apple-oss-distributions/file_cmds/blob/file_cmds-479/cp/cp.1
[ms-block-cloning]: https://learn.microsoft.com/windows-server/storage/refs/block-cloning
[ms-dev-drive]: https://learn.microsoft.com/windows/dev-drive/
[linux-ficlone]: https://man7.org/linux/man-pages/man2/ioctl_ficlone.2.html
[linux-ext4]: https://github.com/torvalds/linux/blob/v6.17/fs/ext4/file.c
[linux-xfs]: https://github.com/torvalds/linux/blob/v6.17/fs/xfs/xfs_file.c
[linux-btrfs]: https://github.com/torvalds/linux/blob/v6.17/fs/btrfs/file.c
[coreutils-news]: https://github.com/coreutils/coreutils/blob/v9.0/NEWS
[fedora-btrfs]: https://fedoraproject.org/wiki/Changes/BtrfsByDefault
[dotnet-clone-osx]: https://github.com/dotnet/runtime/blob/v10.0.0/src/libraries/System.Private.CoreLib/src/System/IO/FileSystem.TryCloneFile.OSX.cs
[dotnet-pal-io]: https://github.com/dotnet/runtime/blob/v10.0.0/src/native/libs/System.Native/pal_io.c
[libuv-unix]: https://github.com/nodejs/node/blob/v24.15.0/deps/uv/src/unix/fs.c
[libuv-win]: https://github.com/nodejs/node/blob/v24.15.0/deps/uv/src/win/fs.c
[node-fs]: https://github.com/nodejs/node/blob/v24.15.0/doc/api/fs.md
