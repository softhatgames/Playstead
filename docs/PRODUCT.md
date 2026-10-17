# Product design

Playstead should feel like working with a game developer. Describe an idea, try it, discuss what happened and decide what deserves more work. The technical work should leave more room for the ideas, rules and feel that make the game yours.

**Status: confirmed design; the game development experience is not yet implemented.** [GitHub Issues](https://github.com/softhatgames/playstead/issues) track progress. This document defines the experience. [ARCHITECTURE.md](ARCHITECTURE.md) maps Playstead's structure, [the development layer](DEVELOPMENT-LAYER.md) defines how a game is built so the person and the agent can see, drive and change it, and the [glossary](../GLOSSARY.md) defines the terms.

## One workspace, different ways of working

Someone without programming experience should be able to guide development and judge results. The agent explains technical choices through their effect on the game. Threads with the agent, prototypes to play, comparisons and feedback form the everyday experience.

An experienced developer can inspect source, diffs, diagnostics and tools, and work in a preferred editor. Language, library, data structure and architectural preferences become game project constraints. The agent discusses changes to those constraints and preserves manual edits. A person can delegate one task and directly implement another within the same workspace.

Each person chooses whether to show technical details; Playstead asks once, at first run. Without them, results read in game terms, and every result can still show its work. With them, activities, diffs, loaded revisions and each thread's token use as the provider reports it appear by default, along with changes, a terminal, files and a usage screen. Approvals and permission requests stay in game terms either way.

Playstead runs the real Codex and Claude agents as providers, following [T3 Code](t3-code.md). Its custom interface adds game development context, tools and workflows around them. Provider capabilities and limitations remain visible. A person can explicitly hand work to another provider.

## The whole development process

The remit includes concept, gameplay, rules, controls, progression, pacing, narrative, visuals, audio, content, accessibility, performance, delivery and marketing. The work follows the needs of the game.

Prototypes can introduce new mechanics, state, actions and interfaces. They can explore a single interaction or an entire game.

The agent can use existing specialist tools and build editors, solvers, inspectors, importers or generators for a particular game project. People and agents should be able to use the tools' underlying operations. Some tools are temporary; others become maintained parts of the game. A tool that edits or inspects the running game, such as a tuning panel or a level editor, is built into the game's development builds and appears wherever the game runs. Batch work uses command-line tools; a separate editor is built only when a tool outgrows the game.

Playstead imposes no universal scene model or scripting language. The shipped game should depend only on the code and tools it needs. Optimisation follows evidence about the actual bottleneck.

## Code-first games

Games made with Playstead are written as code on proven libraries, without an off-the-shelf engine such as Unity, Godot or Unreal ([ADR 0004](adr/0004-code-first-games-starting-with-csharp.md)). Each game has its own **engine**: the reusable foundation its gameplay, tools and content run on. Gameplay holds the game's rules. Content, such as levels, tuning values, art and text, is data the engine can reload while the game runs. The engine holds no rules of the game, and changing it is a core change.

Every engine follows one structure, so the person and the agent can always see and change what the game is doing. The rules advance the game state tick by tick from players' actions; the state is data that can be inspected, copied and replayed exactly; and everything drawn or heard follows from it. Each game also carries a **development layer**, built only into development builds, through which Playstead, the agent and in-game tools inspect it, test it, script its play and record it. [The development layer](DEVELOPMENT-LAYER.md) defines both.

The game and its prototypes share one language; tools can use others where they fit. Playstead offers a few **supported stacks**, each a language with its libraries, skills and a Playstead library that carries the development layer's common parts. C# on .NET 10 is the first, and the default for people without a preference. A person can choose another language; the agent then builds the development layer from its contract, and Playstead says the support is shallower.

Each game project records its **target platforms**, such as desktop, iPhone or Android, and only stacks that reach them are offered. Every game also runs on the desktop computer where it is developed. The engine responds to actions, such as jump, rather than particular keys or touches, and lays out its screen for any size. The preview shows the game as it would appear on a chosen target; for a phone, mouse clicks act as touches. Touch feel is judged on a real phone and reported as unassessed until then.

## Independent game projects

Everything produced with Playstead must remain usable without it: source, assets, tools, skills, prototypes and development records. Retained tools and prototypes include enough setup information to use them independently.

For now, Playstead starts new games. Adding an existing code-first game comes later, by choosing its folder. Its first work, in the game, will be [discovery](DEVELOPMENT-LAYER.md#later): the agent explains what works already, identifies what is missing and proposes integration work. Until discovery is complete, the game project offers nothing to run. Discovery respects the game project's existing organisation and technical choices. A game built on an off-the-shelf engine is outside what Playstead supports, and discovery says so.

A new game starts from its idea, where people will play it and any technical preference; without one, it uses the default stack. It can start from a copy of another game's engine and tools, recording where they came from; the two games then change independently. Playstead creates its folder where the person chooses, with Git. The first work is a prototype of the idea: the engine grows from what prototypes need rather than being built first.

Portable, durable results belong to the game project. A game's `.playstead/` folder holds disposable working data. Deleting it preserves the game and valuable development records. Playstead's own threads, settings and credentials live in the Playstead home, outside every game project, with a separate lifetime ([ARCHITECTURE.md](ARCHITECTURE.md#identity)). Credentials never become game project files.

## Working in a game project

The interface shows one game project at a time. Within it, Playstead lists the game first, then prototypes grouped by idea, then discarded prototypes. The switcher between game projects shows how many items need the person in each. Notifications for work that needs the person or is ready to play come from every game project.

The game and each prototype hold one or more **threads** with an agent. Their record, not any thread, holds the durable context: idea, scenarios, feedback, lessons and decisions. New threads start briefed from it. When a thread grows long, Playstead suggests in plain words that the person **settle** it: the agent writes the thread's outcome into the record, and the thread becomes read-only. Threads on the same game or prototype can work at once. Agents recheck files, reconcile compatible changes and bring conflicting intent to the person as a gameplay question.

## Prototypes and the game

**The game** is everything kept so far in a game project. A clear instruction, or a fix to a clear mistake, changes it directly. “Try this” starts a **prototype**: an attempt at an idea, made in its own copy from the game and refined as the person plays it. Time spent and code written do not keep it. When a request is ambiguous, the agent says which it will do, and the person can redirect it.

Work that could change the game's feel unnoticed is made as a prototype even when clearly requested: rewrites, optimisations and core changes. The game remains the reference until the change is kept.

Each prototype names the **idea** it tries; an idea gathers the lessons of all its prototypes. Several prototypes can try one idea, and several can be built at once. For an open gameplay question, the agent builds the most promising prototype and offers one or two clearly different directions the person can start, each with its expected usage. Clear instructions get no alternatives. A game project can record a preference for building several by default.

“Keep this,” or another clear instruction, puts a prototype into the game. Interpret the person's intention rather than requiring a special phrase or separate document approval. The agent maintains the design and relevant decisions as part of the work. If the game has changed since the prototype started, the agent first brings the prototype up to date in its own copy. Playstead says when the result differs from what the person played and offers to play it from the same scenario; the person decides. Keeping a prototype nobody has played in full says so. Keeping can be undone.

When prototypes change the same thing, Playstead says so early, in game terms. The agent does the combining and brings design choices to the person as gameplay questions, playable where possible. A **combination** is itself a prototype, played before any of it goes into the game. If combining fails, the game stays as it is. Developers can inspect the overlap and resolve it themselves.

A prototype the person does not keep is **discarded**. It stays recoverable and playable from the game project's history until the person deletes it. Keeping or discarding records the prototype's **lesson**.

A kept prototype may be retained as it is, improved or translated into another implementation. Keeping does not automatically authorize a rewrite. The agent explains any further engineering work and its purpose.

Distinguish intended design from observed behaviour. When they disagree, investigate and recommend a resolution. Clear mistakes can be fixed within the agreed task. Ambiguous gameplay choices belong to the person; independent work can continue while a question remains open.

## Live iteration and playtesting

During **live iteration**, compatible changes within the approved scope appear in the **preview** as the agent works. Content and tuning load without a rebuild; code changes load into the running game where the stack can apply them, and otherwise the game restarts from the same scenario. The preview runs the game or a prototype inside Playstead, focused on what is being worked on: a prototype's agent can start it in the prototype's scenario and hide the HUD or other distractions, and the person can adjust that. Resets and restarts are announced and wait for a suitable point unless automatic restarts were authorized.

During a **playtest**, what is running stays fixed. **Play** opens the full game as a player would see it, in its own window or, for a phone target platform, on the person's phone: from the prototype's scenario in a prototype, or from the beginning in the game. Nothing from Playstead covers it; a key the game's development layer provides can mark moments for feedback afterwards. A playtest can also be held inside the preview for a quick check. The agent can prepare changes alongside a playtest; they wait until it ends. The person switches between them by asking the agent or with the preview's controls.

Playstead shows one running game at a time: the game or the prototype the person has open. Switching restarts from the same scenario where possible and warns about anything that will be lost. Agents can run hidden checks in the background; these never count as the person's play.

A **scenario** is a named starting situation, such as a boss's second phase with three hearts, kept in the game project. It is described as setup in game terms, so it outlives changes to the game, and a snapshot saved for each revision makes later starts quick. Prototypes, playtests and checks can start from one instead of replaying the game to that point. The agent makes scenarios with the game's capabilities, or proposes adding capabilities when those are missing. Anything played from a scenario records it, because a scenario skips the journey there. Scenarios that depend on changed content are marked as possibly outdated until checked.

Feedback remains attached to what the person actually played, and records whether it came from the preview, Play or a clip. Show which source changes exist and which revision the running game has loaded. An edited file is not evidence that the running game changed. [The development layer](DEVELOPMENT-LAYER.md#changing-the-game) governs application, state compatibility and recovery.

## Judge the right thing

Verification follows the purpose of the work. Exploration needs a usable scenario, focused checks and visible known problems. Keeping a change calls for checks of affected behaviour and integrations, updated records and an account of remaining work. Release work follows the game project's wider requirements. Reuse passing evidence while its relevant inputs remain unchanged.

A prototype may be rough. Distinguish readiness to explore from readiness to ship. Automated checks establish only the properties they actually assess.

Before a rewrite or optimisation that could affect gameplay, identify the qualities to preserve from accepted design and feedback. Input response, rhythm, readability or freedom to improvise may matter. Include them in the proposed task's acceptance criteria.

Make the replacement as a prototype and compare it with the game from the same scenario. Measurements and rule checks support comparison; a person or designated playtester judges qualities that depend on playing. A replacement can be technically implemented while gameplay acceptance remains pending. Other work can continue during that review.

## Living game project memory

Maintain portable records of the current design, decisions and reasons, ideas, prototypes and their lessons, scenarios, selected feedback, technical preferences, current work and known problems. Use existing locations; propose suitable homes where they are missing. These records should let a fresh agent or human continue without reconstructing months of threads.

Keep confirmed intentions and open questions distinct. Preserve selected player feedback in the person's exact words, linked to what was played and relevant evidence. Record the agent's interpretation separately and let the person correct it. A lesson quotes the feedback it rests on.

Full threads remain accessible and exportable. Adding them to game project files is optional. Durable application history lives outside the game's disposable folder.

Discarded prototypes keep their source, relevant assets, setup information and lesson, recoverable until the person deletes them. Deleting a prototype removes its source and assets; its lesson remains. Keep selected evidence and whatever a pending comparison needs. Scratch attempts, rebuildable outputs and incidental captures can be cleaned up. Users can retain more or explicitly delete material.

## Skills under user control

Playstead ships starter skills, including [writing-for-agents](../skills/writing-for-agents/SKILL.md). Users can inspect and edit them, or ask the agent to add, change or remove them. Show the active set.

New game projects start with current defaults. Existing game projects retain their chosen versions until updates are accepted. Explain proposed updates in plain language and expose their exact changes. Preserve customisations and removals. The user can delegate maintenance of particular skills or ask the agent to adapt an update.

Skills guide work; permission modes, which follow [T3 Code](t3-code.md), determine authority independently.

## Remote work and delegation

Initially, development runs on a computer under the user's control. A phone connects for threads, approvals, progress and evidence. It shows what needs the person and what is ready to play first, then the game and its prototypes. Review on the phone uses clips, frames, checks and descriptions in game terms; feedback given there records that it came from a clip. Keeping from the phone is allowed and marked as not played. Approved work continues when the interface closes or disconnects. Setup should become guided enough for non-programmers; packaged onboarding follows the first working proof.

Remote chat is essential. Local play with remote captures is sufficient; browser demos and streamed play are optional. Managed execution for people without a suitable computer is later work.

The user approves bounded work, including core changes and rebuilds, before it starts. Each approval says which of its limits are enforced, which are checked when the work is kept and which are the agent's commitment. They can set standing time and resource limits and override them for a task. When denying a permission request, the person can add a reason in their own words. After Deny the agent receives it at once; after Deny and stop it waits until the person continues. The agent surfaces useful results early. Permission modes, interruption and recovery follow [T3 Code](t3-code.md).

## Marketing and release

Marketing includes positioning, audience research, store pages, screenshots, trailers, campaigns and learning from player responses. Each game project defines its voice and communication rules. Those rules do not come automatically from another game's workflow.

The agent can research, draft and prepare assets within the agreed task. Gameplay video and screenshots are rendered from recorded play, the person's or a bot's, at any resolution, frame rate and aspect ratio, and say whose play they show ([gameplay video](DEVELOPMENT-LAYER.md#gameplay-video)). The agent can execute campaigns when the necessary tools are connected and the user has explicitly approved a concrete proposal. That proposal identifies content, destinations, timing and spending limits.

Approval can cover individual actions or a prepared batch. Carry out the approved schedule without asking again for each item. Material changes to content, destinations or spending require renewed approval. Publication and deployment follow the same explicit authority boundary.

The full remit guides the product; the first game work proves a smaller development loop first.
