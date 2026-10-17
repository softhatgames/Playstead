# Game state in the games Playstead builds

Every engine the agent builds follows one structure. A sealed simulation advances the game state at a fixed tick rate the game chooses. Everything from outside enters as actions, setup or outside inputs, and everything going out leaves as signals. Game state is data, reachable from one root and copied as snapshots, and presentation reads it but never writes it. Actions are named in game terms, name the player who gave them and carry values in the game world, never screen positions; input mapping is the only place presentation may decide which actions are given.

An action timeline replays exactly on the same build on any desktop computer. Scenarios are setup in game terms, with a snapshot saved for each revision so later starts are quick. Players' saves are versioned and migrated, separately from snapshots. Agents script play with action timelines and with bots that read state and choose actions. Gameplay video is rendered offline from a replay, on the current build when its fingerprints still match.

Tests, scripted play, replay, video and live changes all depend on knowing the whole state and how it changes. Left to each game, they would work only where the agent happened to build that way, and adding snapshots to a finished game means rebuilding its state. This is a structure, not a model: each game names its own state, entities and actions, so it fits any genre.

## Considered options

- **Only a capability contract, with no required structure.** Any engine shape stays possible, but tests, replay and video depend on luck.
- **Replay on the same machine only** is cheaper. A recording then cannot move to another computer to be checked, compared or filmed.
- **Replay on every platform, phones included,** needs fixed-point maths or proven libraries everywhere.
- **Scenarios as snapshots only** start fastest, but every change to the shape of state breaks every scenario. **Setup only** survives changes, but replays the way there on every start.
- **Saves as snapshots with migrations** is one mechanism, but every refactor of state becomes a migration.
- **Live capture for video** works without exact replay, but its quality is limited by the computer, and each format needs another run.
- **Device events in timelines** break when the screen size or the controls change.

## Consequences

- The simulation bans platform-dependent maths, undefined iteration order and nondeterministic threads. A source check enforces this, and a replay check across desktop operating systems proves it.
- A physics library must allow snapshots and replay across machines.
- Existing games, supported later, adopt this structure gradually through discovery.
- [The development layer](../DEVELOPMENT-LAYER.md#how-a-game-is-built) holds the current rules.
