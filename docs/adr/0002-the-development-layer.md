# The development layer

Every game Playstead builds has a development layer: the part of the game built only into its development builds that offers the game's capabilities to the person, the agent, in-game tools and command-line checks. Playstead reaches a running game only through it, and it works without Playstead. It exists while a development build runs; building and running the game, and its command-line tools, are the game project's own commands.

The running game is never the source. In-game tools write the game's own content files, the agent edits code, and the development layer loads both and reports what loaded. Its common shape is small: capabilities with stated effects and limits, and entities with parts and origins, named in the game's own terms. Every game has the same foundation from its first prototype: frames, actions, the loaded revision, inspection by query, snapshots, action timelines with fingerprints, pausing and stepping, and content reload. Everything else is a capability the game adds when it needs it.

Each supported stack's Playstead library carries the common parts. It is copied into the game as source and left out of release builds, so the shipped game holds nothing of Playstead. The protocol has versions and each game declares what it supports, so games keep working as Playstead changes. A native game sends its frames to the preview over a local connection and runs Play in its own window. Its build and run processes have the same permissions as the agent working on it.

## Considered options

- **A harness attached from outside**, through commands that start the game and leave files to read afterwards, or a connection added to an unchanged game. Neither lets the agent ask a running game what exists now. Most of what the agent needs, such as complete state, actions, snapshots and replay, depends on how the game is built, not on the link to it.
- **No common shape**, with each game describing its things only through its own operations. Pointing at the game, inspection and composer context would then need work in Playstead for every game.
- **A package dependency** for the library would need publishing and tie every game to a registry. **Writing the layer from instructions in each game** would repeat, game by game, the protocol work that honest reporting depends on.
- **Building to WebAssembly for a browser preview** means two builds that can behave differently, and only languages with a solid web target.

## Consequences

- Picking an entity under the pointer is optional. The person points at a frame, and the agent queries the entities there.
- [The development layer](../DEVELOPMENT-LAYER.md) holds the current rules.
