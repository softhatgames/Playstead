# Game harness contract

The harness connects the coding agent, the person and the running game through discoverable tools and attributable results. It supports fast prototypes while making clear what changed, what ran and what was assessed.

**Status: confirmed responsibilities; runtime integration is not implemented.** The wire format, transport and adapter mechanisms remain open. The client-to-host protocol already in the repository is a separate boundary.

Read [PRODUCT.md](PRODUCT.md) for the creative workflow and [ARCHITECTURE.md](https://github.com/softhatgames/playstead-v0/blob/v0/docs/ARCHITECTURE.md) for ownership and authority.

## Discover and connect a game project

When a game project is added, the agent investigates its existing instructions, design records, source, assets, languages, dependencies, version control, build and run commands, checks and game project tools. It identifies technical preferences and existing work before proposing changes.

Discovery also records the game's language and target platforms, and how its code maps onto engine, tools, gameplay and content, without reorganising it. A game built on an off-the-shelf engine is outside what Playstead supports ([decision 0019](https://github.com/softhatgames/playstead-v0/blob/v0/docs/adr/0019-code-first-games-on-supported-stacks.md)); discovery says so.

Produce a capability assessment: what can be used now, what remains unknown or unsupported, and which integrations would enable useful Playstead features. Explain the work and its effect on the game project. Obtain the required authority before applying that integration plan.

The plan includes a **copy setup** for prototypes: the command that prepares a fresh copy, such as installing dependencies, and the ignored files a copy needs, such as local environment files. It belongs to the game project and works without Playstead. Discovery also records the game's version control and the branch that is the game; a game project without Git is offered it, as [ARCHITECTURE.md](https://github.com/softhatgames/playstead-v0/blob/v0/docs/ARCHITECTURE.md#prototype-copies-and-version-control) describes.

Preserve the game project's organisation. Prefer adapters around useful existing commands and tools. A game project can gain capabilities gradually; opening it does not require conversion to a universal game architecture.

Discovery is complete when the agent can explain the available workflow, its limits and the proposed next step. A command's presence alone does not establish that an integration works.

## Terms and boundaries

A **game project** contains the game's durable work. **The game** is what has been kept so far; a **prototype** tries an idea in its own copy and changes as the person refines it. A **run** is a particular execution of the game, a prototype or a tool. A **scenario** is a named starting situation a run can start from. A **revision** is the exact source identity a running game reports having loaded. The [glossary](https://github.com/softhatgames/playstead-v0/blob/v0/GLOSSARY.md) defines these terms.

A **capability** is an operation the integration exposes with stated conditions and limits. The game project owns its game concepts. Playstead owns the common way to discover operations, invoke them and receive progress and results.

A game project tool should remain usable without Playstead. Its integration can wrap an ordinary command or interface. Generated editors and previews follow the isolation boundary in [ARCHITECTURE.md](https://github.com/softhatgames/playstead-v0/blob/v0/docs/ARCHITECTURE.md#game-integration).

## Connect a running game

Each supported stack provides a connection library, copied into the game as source and compiled only into development builds ([decision 0019](https://github.com/softhatgames/playstead-v0/blob/v0/docs/adr/0019-code-first-games-on-supported-stacks.md)). It sends the game's frames to the preview and delivers the person's and the agent's input into the game's normal input handling. It also reports the loaded revision and carries pausing, inspection, scenario setup and reloading. Pausing lets the person draw over a frozen frame and keep the game paused while they talk to the agent ([PRODUCT.md](PRODUCT.md#live-iteration-and-playtesting)). The game registers its own operations through it. Release builds contain none of it, and the game builds and runs without Playstead. A game in another language implements the same connection from this contract.

The preview runs a debug development build, so code changes can load into the running game where the stack supports it. Play runs an optimised development build with the in-game tools hidden: close to what players get, while still reporting its revision and marking moments. Release builds, which may be compiled ahead of time for phones and consoles, are checked when releasing. Evidence records which build ran ([decision 0020](https://github.com/softhatgames/playstead-v0/blob/v0/docs/adr/0020-native-games-send-frames-to-the-preview.md)).

Tools that edit or inspect the running game are drawn over it in development builds, so they appear wherever it runs; command-line tools serve batch work. Every operation a tool offers a person is also available to the agent.

## Describe operations

A connected tool describes:

- Its purpose and accepted inputs.
- Its effects, including inspection, file or state changes, interruption and restart.
- Preconditions, supported versions and relevant limits.
- How it reports progress, completion, failure or an unsupported request.
- Which game project, prototype and run its results concern.
- The evidence and durable outputs it produces.

This small contract supports game-specific operations, such as starting a race with selected conditions or simulating factions for a fixed number of turns. It does not define the game's internal state model.

Effect descriptions inform planning. Actual authority comes from the [host and provider integration](https://github.com/softhatgames/playstead-v0/blob/v0/docs/ARCHITECTURE.md#authority-and-limits), not a tool's assertion that it is safe.

Capabilities can cover build, run, stop, input, state inspection, scenario setup, preview focus such as hiding the HUD, pause or step, marking moments during play, captures, recordings, logs, profiling, editing and live application. Expose those that the game project supports. Report missing capabilities explicitly and propose additions when useful.

## Exercise the game faithfully

People, agents and scripted play should use the same authoritative game operations for equivalent actions. An action may be exposed through normal input or a game API. Direct invocation tests the game operation; a claim about keyboard, touch or controller usability also needs evidence from that input path.

Development tools may spawn entities, grant items, load a custom state or skip progression to set up a scenario. Record that preparation separately from the subsequent play. A boss spawned in an arena can help assess its attacks; it does not establish that progression reaches the boss with suitable equipment.

Agents can run the game out of sight for checks while the person plays something else. Such runs are never reported as the person's play.

Use the real implementation for the property being assessed. Rendering evidence needs the actual rendering path. State inspection alone cannot establish appearance, and a screenshot alone cannot establish a rule.

## Apply changes to a running game

Before applying a change, establish its effect on the current run: compatible live application, a state migration, a reset or a core change and rebuild. The game project defines compatibility; a file extension alone cannot establish it.

Respect the selected [iteration or playtest mode](PRODUCT.md#live-iteration-and-playtesting). Confirm the affected source and running revision before applying work. Preserve intervening manual edits; reconcile clear overlaps and surface conflicting intentions. Each prototype has its own copy; threads on the same game or prototype share it.

After application, establish which revision the runtime accepted and whether its state was preserved, migrated or reset. Keep pending edits distinct from loaded changes. When an integration cannot establish that a change loaded, report that limitation.

Keep the last working result recoverable. A failed application reports what happened to source, process and runtime state. Repair within the authorized task or return to a working result while preserving unrelated edits. Restoring a build does not by itself prove that the previous play state was restored.

## Identify evidence

Results connect the requested operation to what actually ran. Record the game project, prototype, run, relevant source and content identity, and observed running revision. Include uncommitted changes when they affect the result. A commit identifier alone is insufficient for a dirty working tree.

Record conditions relevant to the claim: scenario or save, whether it was played in the preview or in Play, setup actions, inputs, seed where applicable, time or tick, camera, viewport, platform, build configuration or rendering backend. The exact schema remains open; its purpose is to make the result attributable and its comparison meaningful.

Captures, state reports, measurements and feedback refer to those identities. Claim synchronized state and imagery only when the integration can establish that they describe the same moment. Keep comparison conditions visible and identify differences between runs.

Check requested outputs and their provenance before reporting success. A successful process exit does not establish that a capture exists, a requested scenario ran or the expected revision loaded. Distinguish a failed check, an unsupported capability, pending work and an unassessed property.

Performance conclusions identify the workload, conditions and measurement used. Distinguish simulation time, rendering cost and presented frame rate. An accelerated recording is not evidence of interactive frame rate.

## Declare reproducibility

Support the guarantees the game project can establish:

- **Exact replay:** recorded operations reproduce the promised behaviour under specified conditions.
- **Repeatable setup:** a save or scenario restores a known starting situation; subsequent outcomes may vary.
- **Recorded evidence:** captures and recordings preserve what happened for review.

Test and state the relevant limits, such as build, platform or simulation conditions. Do not infer exact replay from a seed or an action log alone. Playstead requires no universal deterministic simulation model.

If stronger reproducibility would make an investigation more useful, propose the integration and its trade-offs. Use the available evidence honestly while that work remains open.

## Retain useful work

[Game project memory](PRODUCT.md#living-game-project-memory) defines what is retained. Store durable source, tools, prototypes with their lessons, scenarios and selected evidence in locations the game project owns. Include setup and invocation information so their use does not depend on a Playstead session.

Temporary outputs can use the game project's disposable folder. Before treating a result as retained, ensure its only useful copy is not disposable. Keep the reference required for a pending gameplay comparison available.

## Verify the integration

Checks should exercise the contract's claims. Useful cases include stale runtime identity, missing or partial outputs, an interrupted operation, unsupported replay and a failed live application. An integration must report those conditions accurately.

For a real prototype, retain evidence connecting the request, actual execution, result and limits of assessment. Apply [purpose-specific verification](PRODUCT.md#judge-the-right-thing); additional instrumentation should earn its place by answering a development question.
