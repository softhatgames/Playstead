# Playstead

Playstead is a workspace for making games with coding agents on the person's own computer. Coding-agent concepts use [T3 Code's terms](https://github.com/pingdotgg/t3code/blob/main/docs/internals/glossary.md); these terms cover making games.

## Language

### Game projects

**Game project**:
The game's durable work: source, assets, maintained tools, design records, and prototypes with their lessons, in the game project's own locations. Every thread belongs to one.
_Avoid_: Project (alone), repository, game folder

**Discovery**:
The agent's investigation of an existing game project's instructions, source, tools and commands, ending in an account of what can be used now, what is missing and the proposed next step.
_Avoid_: Onboarding, import, setup

**Copy setup**:
A game project's recorded steps for preparing a fresh copy for a prototype: a setup command and the ignored files to copy.
_Avoid_: Bootstrap, install script

### The game and prototypes

**The game**:
Everything kept so far in a game project, from which each new prototype starts. It changes when a prototype is kept or the person clearly asks for a change.
_Avoid_: Main, trunk, main branch, baseline

**Idea**:
What one or more prototypes try for the game, such as "Boss dodge". It groups those prototypes and gathers their lessons; the agent names it and the person can rename it.
_Avoid_: Question, topic, feature, mechanic

**Prototype**:
An attempt at an idea for the game, in its own copy, refined as the person plays it until it is kept or discarded. Several can try the same idea, and several can be worked on at once.
_Avoid_: Experiment, branch, draft, spike

**Combination**:
A prototype that brings together two prototypes, or a prototype and later changes to the game, so the person can play them together before any of it goes into the game.
_Avoid_: Merge, rebase, conflict

**Kept**:
The outcome of a prototype the person chose to put into the game.
_Avoid_: Adopted, merged, accepted

**Discarded**:
The outcome of a prototype the person chose not to keep. It stays recoverable and playable from the game project's history until the person deletes it.
_Avoid_: Abandoned, archived, rejected

**Lesson**:
What a prototype taught, recorded in the game project's design records when it is kept or discarded. It quotes the person's feedback in their exact words and keeps the agent's summary separate.
_Avoid_: Finding, learning, takeaway

### Building and playing

**Engine**:
A game project's own reusable foundation, built on libraries, that its gameplay, tools and content run on. It holds no rules of the game.
_Avoid_: Framework, runtime

**Supported stack**:
A language and its libraries for which Playstead provides skills and a Playstead library, with the target platforms it reaches. One is the default for people without a preference.
_Avoid_: Template, toolchain, technology

**Target platform**:
A kind of device a game is made to be played on, such as desktop, iPhone or Android, recorded in the game project. Every game also runs on the desktop computer it is developed on.
_Avoid_: Game type, build target

**Preview**:
The game or a prototype running inside Playstead, focused on what is being worked on, such as starting in a prototype's scenario without the HUD. Changes load into it as the agent works.
_Avoid_: Stage, focus view, embed

**Play**:
The full game as a player would see it, in its own window or, for a phone target platform, on the person's phone: from the prototype's scenario in a prototype, or from the beginning in the game. It is always a playtest.
_Avoid_: Launch, full preview

**Playtest**:
Playing a state of the game or a prototype that stays fixed, so feedback attaches to what was actually played. Changes made meanwhile wait until it ends.
_Avoid_: Test, freeze

### The development layer

**Development layer**:
The part of a game built only into its development builds that offers the game's capabilities to the person, the agent, in-game tools and command-line checks. Playstead reaches a running game through it, and it works without Playstead.
_Avoid_: Harness, game harness, game connection, bridge, integration (alone)

**Capability**:
An operation the development layer offers, with its stated effects, conditions and limits. Some are common to every game, such as frames, actions and the loaded revision; others are the game's own, such as starting a race.
_Avoid_: Feature, command

**Playstead library**:
A supported stack's implementation of the development layer's common parts, copied into a game as source and left out of its release builds.
_Avoid_: Connection library, SDK, plugin, runtime

**Run**:
One execution of a development build of the game or a prototype, from start to stop, whether the person is playing it or the agent runs it out of sight.
_Avoid_: Session, instance, process

**Revision**:
The exact source identity, including uncommitted changes, that a running game reports having loaded.
_Avoid_: Version, commit, build

### Game state

**Simulation**:
The game's rules advancing the game state tick by tick. Everything from outside enters it as actions, setup or outside inputs, and everything it tells the outside leaves as signals; it depends on nothing else.
_Avoid_: Core, logic, model

**Game state**:
All the data that decides what happens next in a run: everything the simulation reads and changes, reachable from one place and savable as a snapshot. It excludes presentation state, assets and the engine's caches.
_Avoid_: World, scene, model, save

**Presentation state**:
What a game keeps only to draw and play the game state, such as particles, animation blending and camera smoothing. It never changes the game state.
_Avoid_: View state, render state

**Action**:
Something a player can do, named in the game's terms, such as jump, play a card or scoop soil at a point, together with the player who did it. It may carry values in the game world, never screen positions or device events.
_Avoid_: Command, input, event, gesture

**Setup**:
A change to a run's game state made outside play, such as setting a value or spawning a boss. It is recorded beside the actions, and a run with setup never counts as plain play.
_Avoid_: Cheat, debug command, developer call

**Outside input**:
A fact from outside the simulation that affects it, such as today's date, a network message or a language model's reply, recorded as it enters.
_Avoid_: External event, side input

**Signal**:
Something the simulation tells the outside, such as an achievement earned, a sound to play or a save to write. The simulation never calls the outside itself.
_Avoid_: Event (a T3 Code term), game event, callback, message

**Tick**:
One step of the game state forward in time, at a fixed rate the game chooses, taking the actions, setup and outside inputs given for it. A turn-based game may tick only when an action arrives.
_Avoid_: Frame, update

**Snapshot**:
A copy of the game state at one tick of a run, which the same build can load to continue from that tick.
_Avoid_: Save state, save, checkpoint

**Save**:
A player's saved progress, in a form the game chooses and versions so that it still loads after the game is updated.
_Avoid_: Snapshot, save state, save file (alone)

**Input mapping**:
The part of a game that turns keyboard, mouse, touch and controller input into actions. It is the only place where presentation, such as the camera, may decide which actions are given.
_Avoid_: Controls, bindings

**Action timeline**:
The actions, setup and outside inputs given at each tick of a run from its start or from a snapshot. Played again on the same build, on any desktop computer, it reproduces the run exactly.
_Avoid_: Macro, input recording, demo

**Fingerprint**:
A short value computed from the whole game state at one tick, so two runs can be compared tick by tick and the first divergence found.
_Avoid_: Checksum, hash (alone)

**Scenario**:
A named starting situation kept in the game project, such as a boss's second phase with three hearts, described as setup in game terms so it outlives changes to the game. A snapshot of the result may be saved for each revision so later starts are quick.
_Avoid_: Save state, checkpoint, slice, level

**Bot**:
Game code that plays the game by reading the game state each tick and choosing actions, as a player would.
_Avoid_: AI player, autoplayer, script

### Entities

**Entity**:
Something in a running game that the development layer can address, such as an enemy, a HUD button, a tilemap or a faction, named in the game's own terms. It need not appear on screen; the game decides what counts as one.
_Avoid_: Object, game object, thing, node, element

**Part**:
An addressable piece inside an entity that is not an entity itself, such as one tile of a tilemap or one bone of a skeleton.
_Avoid_: Sub-entity, child, component

**Origin**:
Where an entity came from in the game project: the content that placed it, the code that spawned it, the scenario setup that prepared it, or unknown. Every entity reports one.
_Avoid_: Source, provenance, placement
