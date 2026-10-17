# The development layer

Every game Playstead builds carries a **development layer**: the part of the game built only into its development builds. Through it the person, the agent, in-game tools and command-line checks see the game, drive it, inspect it, test it, record it and load changes into it. Playstead reaches a running game only through the development layer, and the layer works without Playstead. Release builds contain none of it.

**Status: decided design; not implemented.** [ADR 0002](adr/0002-the-development-layer.md) records the development layer, [ADR 0003](adr/0003-game-state-in-the-games-playstead-builds.md) the structure of game state and [ADR 0004](adr/0004-code-first-games-starting-with-csharp.md) the first stack. The [glossary](../GLOSSARY.md) defines the terms, and [PRODUCT.md](PRODUCT.md) the creative workflow they serve. For now Playstead starts new games; adding an existing code-first game comes [later](#later).

## How a game is built

The engine the agent builds for each game follows one structure, whatever the genre. It is a structure, not a scene model: the game names its own state, entities and actions.

- **A sealed simulation.** The **simulation** advances the **game state** one **tick** at a time, at a fixed rate the game chooses; a turn-based game may tick only when an action arrives. Everything from outside enters as **actions**, **setup** or **outside inputs**, and everything the simulation tells the outside leaves as **signals**, such as an achievement earned, a sound to play or a save to write. It reads no clock, file, network or environment, and calls no platform service.
- **State is data.** All game state is reachable from one root and can be copied as a **snapshot**. Nothing the rules read hides in rendering objects, static fields or a library's private internals.
- **Presentation reads and never writes.** Drawing, sound and **presentation state**, such as particles, animation blending and camera smoothing, follow the game state and the tick, so a replay looks and sounds the same. Animation the rules read, such as when a hitbox is active, is game state; the visible pose is presentation.
- **Players act through actions.** An action is named in game terms, such as jump, play a card or scoop soil at a point, and names the player who gave it; a single-player game says player one. It may carry values in the game world, never screen positions or device events. **Input mapping** turns keyboard, mouse, touch and controller input into actions. It is the only place where presentation, such as the camera, may decide which actions are given.
- **Randomness is seeded,** and the seed is part of the game state.
- **Replay holds across desktops.** The same actions, setup and outside inputs on the same build give the same game state on any desktop computer. The simulation uses no platform-dependent maths, such as built-in sine or power functions or fused multiply-add, iterates in a defined order and schedules any threads deterministically. A source check enforces these rules.
- **Content is data.** Levels, tuning values, art and text are files the engine reloads while the game runs, described by schemas. The engine holds no rules of the game ([PRODUCT.md](PRODUCT.md#code-first-games)).
- **The game describes its state:** its types and names, units, valid ranges, and which values come from content. The description carries a version, so tools, saves and the agent read state without guessing.
- **Entities.** Anything the development layer can address is an **entity**: an enemy, a HUD button, a tilemap or a faction, on screen or not. Each has a handle valid for its run, a kind mapped to the type in source that defines it, a name in game terms, its parent where it has one, and an **origin**: the content that placed it, the code that spawned it, the scenario setup that prepared it, or unknown. A **part** addresses a piece inside an entity, such as one tile of a tilemap.
- **Saves are their own.** A player's **save** has a form the game chooses and versions, and is migrated so that it loads after the game is updated. Snapshots belong to one revision and serve development.
- **Layers depend inward.** The simulation depends on nothing. Presentation, input mapping, platform code and the development layer depend on it. Replacing a renderer, an audio library or a platform service then changes no rule of the game.

## What the development layer offers

Each operation is a **capability**, with its stated effects, conditions and limits. Some are common to every game; the game registers its own, such as starting a race with chosen conditions or simulating factions for a fixed number of turns.

Every game has **the foundation** from its first prototype:

- frames for the preview, and actions from the person and the agent;
- the loaded **revision**;
- inspection of game state and entities by query, never by dumping all of it;
- snapshots, saved and loaded;
- **action timelines**, recorded and replayed, with a **fingerprint** at chosen ticks;
- pausing, and stepping one tick;
- content reload.

A game adds the rest when it needs them: code reload in a running game, **scenarios**, video rendering, **bots**, marking moments during play, profiling, and picking the entity under the pointer.

A capability describes:

- its purpose and accepted inputs;
- its effects, including inspection, file or state changes, interruption and restart;
- preconditions, supported versions and relevant limits;
- how it reports progress, completion, failure or an unsupported request;
- which game project, prototype and run its results concern;
- the evidence and durable outputs it produces.

Effect descriptions inform planning. Authority comes from Playstead's permission modes, which follow [T3 Code](t3-code.md), never from a capability's claim to be safe. A missing capability is reported as missing, not shown disabled, and the agent can propose adding it.

## The Playstead library

Each supported stack has a **Playstead library**: the development layer's common parts, copied into the game as source and compiled only into its development builds. It carries frames, actions, the revision, inspection, snapshots, timelines and reloading, and the game registers its own capabilities through it. A game in a language without a Playstead library implements the same contract from this document, and Playstead says that its support is shallower.

The protocol between the development layer and Playstead has versions. Each game declares the versions and capabilities it supports, so a game keeps working as Playstead moves on. A game keeps its copy of the library until the person accepts an update, as with [skills](PRODUCT.md#skills-under-user-control). The protocol's wire format and transport are open. It is separate from the RPC contract between Playstead's clients and its server ([ARCHITECTURE.md](ARCHITECTURE.md#clients)).

## Builds and where a game runs

- The **preview** runs a debug development build. The game draws off-screen and sends its frames to the preview over a local connection; the person's input in the preview enters the game's input mapping, and sound plays from the game process on the same computer.
- **Play** runs an optimised development build natively in its own window, with in-game tools hidden: close to what players get, while still reporting its revision and marking moments.
- **Release builds** contain nothing of the development layer and may be compiled ahead of time for phones and consoles. They are checked when releasing.
- Evidence records which build ran.

Playstead runs a game's build, watch and run processes with the same permissions as the agent working on it, so neither a build step nor code the agent wrote gains more authority than the agent.

Each game project records a **copy setup** for prototypes: the command that prepares a fresh copy, such as installing dependencies, and the ignored files a copy needs, such as local environment files. It works without Playstead.

## Reaching a running game

The person and the agent reach a running game only through Playstead: the preview, Play and the tools Playstead gives the agent. An agent never connects to a game by other means, so every result records its run and revision.

Each **run** has its own connection to its development layer. Agents run games out of sight for checks while the person plays something else, and those runs never count as the person's play. Playstead shows the person one running game at a time.

The person can point at a frame in the preview. The composer then carries the frame, the point and the loaded revision, and the agent asks the running game which entities are there. A game that adds picking resolves the point to entities and parts itself.

## Changing the game

The running game is not the source. A change goes into the game project's source and then loads:

- **Content.** In-game tools, such as a tuning panel or a level editor, write the game's content files themselves and reload them, as a manual edit would. They keep working without Playstead. The development layer reports which files changed and what loaded.
- **Code.** The agent edits source. The development layer loads it into the running game where the stack can, and otherwise the game restarts from the same scenario.
- **Setup.** A value changed only in the running game is setup: recorded, never durable, and it marks the run as prepared.

Before applying a change, establish its effect on the current run: a compatible live application, a state migration, a reset, or a core change and rebuild. The game project defines compatibility; a file extension alone cannot establish it. Respect the selected [iteration or playtest mode](PRODUCT.md#live-iteration-and-playtesting), and confirm the affected source and the running revision first.

Agents recheck files before writing, reconcile compatible changes and bring conflicting intent to the person as a gameplay question. That includes edits made through in-game tools while an agent works. Each prototype has its own copy; threads on the same game or prototype share it.

After applying a change, establish which revision the game accepted and whether its state was kept, migrated or reset. Keep pending edits distinct from loaded changes. When the development layer cannot establish that a change loaded, report that.

Keep the last working result recoverable. A failed application reports what happened to source, process and game state separately. Repair within the task or return to a working result, preserving unrelated edits. Restoring a build does not by itself prove that the earlier play state was restored.

## Testing and scripted play

- **Logic tests** run the simulation without drawing: start from a snapshot or a scenario, give actions, step ticks and check the game state.
- **Action timelines** replay a run exactly. A timeline belongs to the revision that recorded it.
- **Bots** read the game state each tick and choose actions, as a player would. A bot keeps working when a level changes, where a timeline would not.
- **Scenarios** are setup in game terms, such as a boss's second phase with three hearts, so they outlive changes to the game. The first start of a scenario on a revision saves a snapshot, and later starts load it.

People, agents, bots and scripted play use the same actions for the same play. Giving an action directly tests the game's rule; a claim about how keyboard, touch or controller input feels also needs evidence from that input path.

Setup prepares a situation; it does not prove the game reaches it. A boss spawned in an arena can show its attacks, but not that progression reaches the boss with suitable equipment. A run with setup records it and never counts as plain play.

Use the real implementation for the property being assessed. State inspection alone cannot establish appearance, and a screenshot alone cannot establish a rule.

## Replay

An action timeline holds the actions, setup and outside inputs given at each tick from a run's start or from a snapshot. Played on the same build, on any desktop computer, it reproduces the run exactly; fingerprints compared tick by tick find the first divergence. A replay check proves this across desktop operating systems: a timeline recorded on one replays to matching fingerprints on the others. Phones are not promised.

A capability can offer weaker guarantees: **repeatable setup**, where a scenario or save restores a known starting situation and later outcomes may vary, and **recorded evidence**, where captures preserve what happened. Say which guarantee a result has. Do not infer exact replay from a seed or an action log alone.

## Gameplay video

Gameplay video is rendered from a replay, not captured live. The game replays a timeline offline, tick by tick, at any resolution, frame rate and aspect ratio, with its sound rendered in sync and in-game tools hidden. Filming may change the camera and the speed of time, never what happens. Shots are marked by moments in the run, not by seconds, so they survive changes in timing.

When the game has changed since a recording, the replay runs on the current build so that the current look is filmed, checked against the recorded fingerprints. If it diverges, Playstead rebuilds the recorded revision from the game's history or runs the bot again. A video comes from the person's recorded play or from a bot, and says which. Live capture remains for runs whose replay does not hold. An offline render is not evidence of interactive frame rate.

## Identify evidence

Results connect the requested operation to what actually ran. Record the game project, prototype, run, relevant source and content identity, and the running revision. Include uncommitted changes when they affect the result; a commit identifier alone is insufficient for a dirty working tree.

Record the conditions relevant to the claim: scenario or save, whether it was played in the preview or in Play, setup, actions, seed, tick, camera, viewport, platform, build configuration and rendering backend. Captures, state reports, measurements and feedback refer to those identities. Claim that state and imagery describe the same moment only when they come from the same tick.

Check requested outputs and their provenance before reporting success. A successful process exit does not establish that a capture exists, a requested scenario ran or the expected revision loaded. Distinguish a failed check, an unsupported capability, pending work and an unassessed property.

Performance conclusions identify the workload, conditions and measurement used. Distinguish simulation time, rendering cost and presented frame rate.

## Retain useful work

[Game project memory](PRODUCT.md#living-game-project-memory) defines what is retained. Store durable source, tools, prototypes with their lessons, scenarios, action timelines worth keeping and selected evidence in locations the game project owns, with the setup and invocation information needed to use them without Playstead.

Temporary outputs, such as cached snapshots, can use the game's disposable `.playstead/` folder. Before treating a result as retained, ensure its only useful copy is not disposable. Keep what a pending gameplay comparison needs.

## Verify the development layer

Checks exercise the contract's claims: a stale revision, missing or partial outputs, an interrupted operation, a replay that diverges, a snapshot that no longer loads, a failed live application and a request for an unsupported capability. The development layer must report each accurately. Each Playstead library ships these checks, and every game runs them.

For a real prototype, retain evidence connecting the request, what actually ran, the result and the limits of assessment. Apply [purpose-specific verification](PRODUCT.md#judge-the-right-thing); more instrumentation earns its place by answering a development question.

## Futures the foundation must not block

The foundation is a few rules that are hard to change; everything else is a capability added later. Each future below was tested against those rules. When a new feature is considered, add a row. If a rule would block it, decide early, while the change is still small.

| Future                                                       | What serves it                                                         |
| ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| Online multiplayer, in lockstep or with rollback             | Replay across desktops, snapshots, and actions that name their player  |
| Local co-op                                                  | Actions that name their player                                         |
| Saves that load after updates                                | Versioned saves and a versioned description of state                   |
| Daily rewards, live events, networked or language-model play | Outside inputs recorded in the action timeline                         |
| Achievements, cloud saves and store services                 | Signals, which platform code acts on                                   |
| Rhythm and fighting games                                    | A tick rate the game chooses                                           |
| Hitboxes driven by animation                                 | Animation the rules read is game state                                 |
| Difficulty and accessibility options                         | Options that change the rules are game state; the rest is presentation |
| Thousands of entities, large worlds                          | Inspection by query                                                    |
| A multithreaded simulation                                   | Deterministic scheduling                                               |
| Another renderer, audio or physics library                   | Layers that depend inward                                              |
| Picking, code reload, rewind debugging                       | Entities with origins, and snapshots                                   |
| Modding, localisation, level sharing                         | Content as data                                                        |
| Playstead updating while games keep older libraries          | A protocol with versions, and capabilities each game declares          |

Not yet tested: split-screen, gameplay driven by audio, and profiling across a release build.

## Later

- **Existing code-first games.** Adding one starts with **discovery**: the agent investigates the game project's instructions, design records, source, assets, languages, dependencies, version control, build and run commands, checks and tools. It explains what can be used now, which parts of this structure are missing and the proposed next step, and gains the person's authority before integration work. The game's organisation is preserved, and capabilities are added gradually. A game built on an off-the-shelf engine is outside what Playstead supports, and discovery says so.
- **Browser-rendered games**, previewed in a sandboxed frame served from a separate origin.
- **Play on a phone**, and touch judged on a real device.

## Open

- The protocol's wire format and transport.
- Whether .NET's own maths functions give the same results on x64 and ARM64, or the simulation needs its own; and a physics library whose state can be snapshotted and replays across machines.
- The preview's frame delay, code reload inside a running game loop, and a GPU context, audio and input under each permission mode on macOS and Windows.
- How an origin stays valid when its content is edited and reloaded.
- How long cached snapshots and timelines are kept, and their size for large worlds.
