# Interface concepts

**Status: decided.** The founder chose among these concepts on 2026-10-15, in a design interview. The choices are confirmed design, not implemented, and none has been tried with people. [PRODUCT.md](../PRODUCT.md), the [glossary](https://github.com/softhatgames/playstead-v0/blob/v0/GLOSSARY.md) and decisions [0014](https://github.com/softhatgames/playstead-v0/blob/v0/docs/adr/0014-prototypes-the-game-and-lessons.md) to [0018](https://github.com/softhatgames/playstead-v0/blob/v0/docs/adr/0018-enforcing-an-approvals-scope.md) hold the current rules. This note keeps the options, the choices and the interface parts that follow from them; [interface prior art](interface-prior-art.md) holds the evidence.

- **Question:** What should Playstead's interface become once it is about making a game, rather than talking to Codex in a folder?
- **Date:** 2026-10-15.
- **Basis:** the product design, [harness contract](../HARNESS.md), [architecture](https://github.com/softhatgames/playstead-v0/blob/v0/docs/ARCHITECTURE.md), [milestone 1](https://github.com/softhatgames/playstead-v0/blob/v0/docs/ROADMAP.md#milestone-1-work-with-a-developer-on-a-running-game), the current interface, the prior-art note and the founder's answers.
- **Limits:** the wireframes describe structure and words, not visual design. "Tower Hop", its prototypes and its numbers are illustrative. Previews, scenarios, marks and captures depend on game integrations that do not exist yet.

## Where the interface starts

The current interface is a conversation workspace: a list of conversations beside the open one, with streamed activities, permission request cards, queued messages, model choice and Codex's status. It is calm, readable and works at phone size. Nothing in it is about the game yet. The glossary now calls a conversation a **thread**; the code still uses the old name.

## What the interface must show

These follow from the product design and harness contract:

1. Whether the person is looking at the game or a prototype, which revision is loaded, and whether source is ahead of it ([live iteration and playtesting](../PRODUCT.md#live-iteration-and-playtesting)).
2. Whether the preview is live or held for a playtest, and what Play is running.
3. Feedback in the person's exact words, tied to what was played, where and from which scenario, with the agent's interpretation kept separate ([game project memory](../PRODUCT.md#living-game-project-memory)).
4. Prototypes as provisional until kept, and discarded prototypes as recoverable ([prototypes and the game](../PRODUCT.md#prototypes-and-the-game)).
5. What was assessed and by whom. An agent's check is not a play review ([judge the right thing](../PRODUCT.md#judge-the-right-thing)).
6. The difference between a permission request for one action and an approval of a bounded task, and what declining leaves unchanged.
7. The state of the work after a disconnect, restart or failure, with uncertain actions marked ([recovery](https://github.com/softhatgames/playstead-v0/blob/v0/docs/ARCHITECTURE.md#work-lifetime-and-recovery)).
8. The game project's source, diffs and diagnostics for a developer, with their own edits visibly preserved.

## Principles

1. **Name what is running wherever the game appears.** No product examined documents a version label on its live preview; engines signal the running copy unmistakably ([prior art: pointing](interface-prior-art.md#pointing-at-the-running-product), [running copy](interface-prior-art.md#the-running-copy-and-the-source)).
2. **One record, several depths.** Each turn reads first as its effect on the game, then as a list of changes, then as the work itself. Depth is a person's setting, not a separate product for novices and experts ([activity](interface-prior-art.md#activity), [two audiences](interface-prior-art.md#two-audiences-in-one-product)).
3. **Prototypes are things, not branches of a chat.** Each has an idea, a copy, threads, feedback, a status and a lesson ([parallel work](interface-prior-art.md#parallel-work), [comparison](interface-prior-art.md#3-alternatives-and-comparison)).
4. **Compare from the same start.** Use one scenario, one control to switch, a list of differences in game terms, and destroy nothing until it is explicitly deleted. A version judged alone is rated too kindly.
5. **Feedback carries its moment.** It records what was played, the scenario, the time, the capture or clip, marks and exact words, plus the agent's labelled reading ([feedback tied to a build](interface-prior-art.md#feedback-tied-to-a-build)).
6. **Approve tasks; answer actions.** The approval is the main authority surface; a permission request is small and exact. Claude Code users approve 93–97% of per-action prompts, and plans must never lapse into consent ([oversight](interface-prior-art.md#4-oversight-uncertainty-and-provenance), [authority](interface-prior-art.md#authority)). This presents [decision 0005](https://github.com/softhatgames/playstead-v0/blob/v0/docs/adr/0005-user-authority-and-recoverable-work.md) rather than changing it.
7. **Say states in words.** "Not yet played by you", "Agent checked: dash available within 3 frames", "Edited, not loaded", "Uncertain: interrupted during the build". No percentages or confidence scores.
8. **Interrupt only for what needs the person.** Use five states: **Needs you**, **Question**, **Working**, **Ready to play** and **Problem**. Notify only for Needs you and Ready to play ([supervision from a phone](interface-prior-art.md#supervision-from-a-phone)).

## Concepts considered

Three layouts were proposed:

- **Logbook:** the conversation as the game's logbook, with result cards and a game bar, and the game in its own window. It cost least and was the same on phone and desktop, but kept the game out of view and let comparisons scroll away.
- **Stage:** the running game in the centre, the conversation as a rail beside it and a strip of versions below. It was closest to play-in-editor, but needed embedding and isolated origins.
- **Bench:** experiments as the home screen, with a board and a side-by-side comparison from one start state. It filled the clearest gap in prior art, but needed the host to model experiments and versions.

The proposal recommended the Logbook as milestone 1's spine. The founder chose differently:

- The Stage's game beside the conversation became the desktop layout, as the **preview**. **Play** opens the full game in its own window.
- The Bench's experiments became **prototypes**, and they organise the interface: the sidebar lists the game, then prototypes grouped by idea. Comparison switches the one preview between prototypes from the same scenario instead of showing them side by side.
- The Logbook's result cards remain inside each thread.
- The phone keeps a design of its own.

## Decisions

| Topic              | Decision                                                                                                                         | Recorded in              |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Top level          | The game project; one in view at a time, with counts and notifications from every game project                                   | PRODUCT                  |
| Adding a project   | The person chooses its folder; discovery is the first work done in the game                                                      | PRODUCT, glossary        |
| Experiments        | Renamed prototypes: attempts at an idea, refined in place, each in its own copy                                                  | 0014, glossary           |
| The game           | Everything kept so far; clear instructions and clear fixes change it directly                                                    | 0014                     |
| Versions           | No numbered versions; Playstead records what was played, and the revision is the technical identity                              | Glossary                 |
| Rewrites           | Made as prototypes, with the game as the reference; no separate playable reference                                               | 0014                     |
| Not kept           | Discarded and recoverable until deleted; keeping or discarding records a lesson                                                  | 0014                     |
| Overlap            | Flagged early in game terms; the agent combines; a combination is a prototype to play                                            | 0014                     |
| Later in the game  | Scenarios: named starting situations kept in the game project                                                                    | Glossary, PRODUCT        |
| Ideas              | Each prototype names its idea; the list groups prototypes by idea                                                                | Glossary                 |
| Alternatives       | Build one prototype; offer one or two other directions with their expected usage                                                 | PRODUCT                  |
| Threads            | Conversations renamed; several per item; the record holds context; settle when long                                              | Glossary, PRODUCT        |
| Concurrent threads | Threads on one item work at once, reconciling compatible changes                                                                 | PRODUCT                  |
| Preview and Play   | A focused live preview inside Playstead; Play opens the full game in its own window                                              | Glossary, PRODUCT        |
| Where Play starts  | From the prototype's scenario in a prototype; from the beginning in the game                                                     | Glossary, PRODUCT        |
| Running games      | One shown at a time; agents' checks run out of sight                                                                             | PRODUCT, ARCHITECTURE    |
| First game         | Native C# on the default stack; the game sends its frames to the preview (supersedes browser-rendered, 0015)                     | 0020, 0021               |
| Phone              | Needs you and Ready to play first; review through clips; keeping marked as not played                                            | PRODUCT                  |
| Technical detail   | A per-person switch asked at first run; token use and a usage screen with it on                                                  | PRODUCT                  |
| Look               | T3 Code's stack, themes and status colours; a dark preview surround; violet for a held playtest                                  | 0016                     |
| Copies and history | The host does all Git work; a worktree per prototype in host data; commits only its own changes; a shadow repository without Git | 0017, ARCHITECTURE       |
| Approvals          | Limits shown as enforced, checked when kept or the agent's commitment; needed for core changes and work over standing limits     | 0018, ARCHITECTURE       |
| Denial reasons     | Optional; added to the running turn after Deny, held after Deny and stop                                                         | ARCHITECTURE             |
| Milestone 1        | Two parallel prototypes for one idea, compared from a scenario, then kept and discarded                                          | [ROADMAP](https://github.com/softhatgames/playstead-v0/blob/v0/docs/ROADMAP.md) |

## The interface

### Desktop

The sidebar lists the game project's items, the preview is in the middle and the open thread is on the right.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Tower Hop ▾   Dash dodge   ● Live   from Boss phase 2   1 change not loaded  │
├──────────────────────┬──────────────────────────────────┬────────────────────┤
│ The game             │ ┌──────────────────────────────┐ │ You: the dash is   │
│                      │ │                              │ │ late after I land. │
│ Boss dodge           │ │                              │ │                    │
│ ▸ Dash dodge working │ │     preview: Dash dodge      │ │ ┌ Result ────────┐ │
│   Parry        ready │ │     Boss phase 2, no HUD     │ │ │ Dash buffered  │ │
│                      │ │                              │ │ │ after landing  │ │
│ Jump feel            │ │                              │ │ │ Not played yet │ │
│   Heavier       kept │ │                              │ │ │ [Play] [Keep]  │ │
│                      │ └──────────────────────────────┘ │ └────────────────┘ │
│ Discarded (3)        │ Pause  Restart  Mark  Capture    │ [Say something...] │
│ + New prototype      │ Scenario: Boss phase 2 ▾ [Play]  │                    │
└──────────────────────┴──────────────────────────────────┴────────────────────┘
```

- **The sidebar** shows the game first, then prototypes under their ideas, then discarded prototypes. Each item shows its status pill and, when open, its threads.
- **The preview** is set up by the prototype's agent: here it starts in "Boss phase 2" and hides the HUD. Controls appear only for capabilities the game's integration exposes; a missing capability is stated, not shown disabled.
- **Play** opens the full game in its own window, from the prototype's scenario, with nothing from Playstead over it.
- **Switching** to Parry restarts the preview from the same scenario, after warning about anything that will be lost.
- **Developers** with technical details on also see a work drawer with Changes, Terminal, Files and Open in editor.

### Game bar

Always visible above the preview, on every screen and device:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Tower Hop ▾   Dash dodge   ● Live   from Boss phase 2   1 change waiting │
└──────────────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────────────┐
│ Tower Hop ▾   Dash dodge   ■ Held   from Boss phase 2   2 changes ready  │
└──────────────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────────────┐
│ Tower Hop ▾   Dash dodge   ■ Playing in its own window, held             │
└──────────────────────────────────────────────────────────────────────────┘
```

- Live has no colour. A held playtest, in the preview or in Play, is violet, and the preview's frame turns violet too.
- "Not loaded" and "ready" stay until the change loads or is dropped, so pending work cannot be forgotten.
- Opening the bar shows the revision, including uncommitted changes, and whether the game's state was kept, migrated or reset. With technical details on, the revision is shown directly.
- When the integration cannot establish what loaded, the bar says "Loaded state unknown" instead of guessing.

### Result card

Ends each turn that changed the game or a prototype. The first lines are for everyone; the expander opens the activity rows with commands, file changes and diffs.

```
┌ Result   Dash dodge ─────────────────────────────────────────────┐
│ Dash buffered after landing                                      │
│ A dash pressed during the landing squash now starts as soon as   │
│ the squash ends, instead of being dropped.                       │
│ [capture]  [8 s clip from Boss phase 2]                          │
│ Loaded in the preview, state kept                                │
│ Agent checked: dash available within 3 frames of landing         │
│ Not yet played by you                                            │
│ > 2 files changed, 1 build, 3 commands                           │
│ [Play]  [Keep this...]  [Discard]                                │
└──────────────────────────────────────────────────────────────────┘
```

### Other directions

For an open gameplay question, the agent builds the most promising prototype and offers others:

```
┌ Other directions for Boss dodge ─────────────────────────────────┐
│ Parry: a timed block that opens the boss to a counter            │
│ About the same usage as Dash dodge                       [Start] │
│ Jump over: a higher jump that clears the sweep                   │
│ About half the usage of Dash dodge                       [Start] │
└──────────────────────────────────────────────────────────────────┘
```

Near a rate limit, the card says so, and nothing starts until the person taps.

### Keeping

When the game has changed since the prototype started, keeping first brings the prototype up to date in its own copy:

```
┌ Keep Dash dodge? ────────────────────────────────────────────────┐
│ The game changed since you played this: you kept Heavier landing │
│ on Tuesday. Both change falling. I combined them in Dash dodge's │
│ copy; checks pass. Dashing right after a landing now waits for   │
│ the squash (3 frames). You haven't played this.                  │
│ [Play combined from Boss phase 2]  [Keep without playing]        │
│ [Not now]                                                        │
└──────────────────────────────────────────────────────────────────┘
```

- A prototype nobody has played in full says "Not yet played in full" and offers Play.
- If combining fails, the game stays as it is; the card offers keeping one prototype and restarting the other from the new game, carrying its lessons.
- Keeping can be undone, which returns the game to what it was before.
- Keeping or discarding records the lesson, with the person's feedback quoted exactly and the agent's summary correctable.

### Feedback

Captured from the preview, from Play through the integration's mark key, or from a clip. The person's words are quoted exactly; the agent's reading is labelled and correctable.

```
┌ Feedback   Dash dodge   Play   from Boss phase 2   0:41 ──────────┐
│ [frame with mark 1]                                               │
│ "The dash comes out late after I land."          You, exact words │
│ Agent's reading: a dash pressed during the landing squash is      │
│ dropped.                                           [Correct this] │
│ Played after "shorter dash", 21:14            Idea: Boss dodge    │
└───────────────────────────────────────────────────────────────────┘
```

### Approval

A bounded task, stated in game terms. The person can change the scope before approving, and the card never approves itself on a timer.

```
┌ Approval needed   Slope physics ─────────────────────────────────┐
│ Rebuild the physics core so slopes keep momentum                 │
│ Why: the core snaps to flat ground; slopes need a new solver.    │
│ Keep intact: the jump timing you kept; reach on tower 3          │
│ Enforced: changes stay in the Slope physics copy until you keep  │
│ it; 45-minute limit; network only to registry.npmjs.org          │
│ Checked when you keep: changes outside src/physics are flagged   │
│ Agent's commitment: asks before touching rendering or audio      │
│ If you decline: nothing starts and nothing changes               │
│ [Approve]  [Change scope]  [Not now]                             │
└──────────────────────────────────────────────────────────────────┘
```

The card sorts its limits into what is enforced, what is checked when the prototype is kept and what is the agent's commitment ([decision 0018](https://github.com/softhatgames/playstead-v0/blob/v0/docs/adr/0018-enforcing-an-approvals-scope.md)). The host answers network requests to the named hosts itself and sends every other request to the person. Approvals are needed before core changes, rewrites and optimisations start, and for work expected to exceed standing limits; ordinary prototypes start without one.

### Permission request

Today's card with four additions: why the provider asks, where it is working, a count when several wait, and an optional reason for a denial.

```
┌ Codex asks   1 of 2 ─────────────────────────────────────────────┐
│ Download a font from fonts.example.com                           │
│ Why it asks: network access is off in this thread                │
│ During: Title screen, in the game                                │
│ If you deny, why? (optional) ______________________________      │
│ [Allow once]  [Deny]  [Deny and stop]                            │
└──────────────────────────────────────────────────────────────────┘
```

Codex's replies carry only a decision, so the reason travels separately. After Deny, the host adds it to the running turn with `turn/steer`, or queues it if the turn cannot be steered. After Deny and stop, it waits as a held message. The answer is always sent first.

### Problem

A failed or interrupted change reports source, the running game and game state separately, as the [harness contract](../HARNESS.md#apply-changes-to-a-running-game) requires.

```
┌ Problem   Slope physics ─────────────────────────────────────────┐
│ The new solver failed to load.                                   │
│ Source: 3 files changed in Slope physics' copy; the game and     │
│ your edit to level3.json are untouched                           │
│ Preview: still running Slope physics from before the change      │
│ Game state: unchanged                                            │
│ [Repair within the approval]  [Undo the change]                  │
└──────────────────────────────────────────────────────────────────┘
```

After a host restart, the same card names the interrupted turn, its last recorded activity and what is uncertain. Nothing continues until the person decides.

### Settling a thread

```
┌ This thread is getting long ─────────────────────────────────────┐
│ The agent may start losing details. Settle it and start a new    │
│ one? Anything that matters goes into Dash dodge's record first.  │
│ [Settle and start new]  [Keep going]                             │
└──────────────────────────────────────────────────────────────────┘
```

A small bar in the thread fills as its context is used. With technical details on, it shows the token counts the provider reports and when it compacted.

### Phone

The phone is not a smaller desktop. It shows attention first, then the game and its prototypes, and it reviews through clips rather than play.

```
┌───────────────────────────────┐
│ Tower Hop                   ▾ │
├───────────────────────────────┤
│ Needs you                     │
│  Slope physics: approval      │
│  Moss Garden: Codex asks      │
│ Ready to play                 │
│ ┌───────────────────────────┐ │
│ │ [8 s clip]                │ │
│ │ Dash dodge                │ │
│ │ Agent checked, not played │ │
│ │ [Note]  [Thread]  [Later] │ │
│ └───────────────────────────┘ │
├───────────────────────────────┤
│ The game                      │
│ Boss dodge                    │
│  Dash dodge           working │
│  Parry                  ready │
│ Discarded (3)                 │
└───────────────────────────────┘
```

- **On the phone:** threads; answers to permission requests and questions; approvals within standing limits, including the rebuild milestone 1 requires; progress; clips, frames, checks and changes in game terms; feedback on clips in exact words, recorded as "from clip". Keeping is allowed and marked as not played.
- **At the computer, or after a further identity check:** raising standing limits or authority, credentials and provider settings, and large diffs. Publishing and spending need explicit approval of a concrete proposal under the [campaign policy](../PRODUCT.md#marketing-and-release); where that approval may happen is open.
- **Notifications:** only Needs you and Ready to play, from every game project and naming the game. Status never arrives as a question, and notifications are suppressed while the person is at the computer.
- **Context:** every phone card carries the same context as its desktop card, and each answer binds to its specific request. The first answer counts, as today.

### Look

The interface takes [T3 Code](https://github.com/pingdotgg/t3code)'s stack and look ([decision 0016](https://github.com/softhatgames/playstead-v0/blob/v0/docs/adr/0016-t3-code-web-stack.md)): Tailwind CSS 4, Base UI components ported from T3 Code, lucide icons, its zinc and neutral tokens, and light and dark themes that follow the system.

| State         | Colour                         |
| ------------- | ------------------------------ |
| Needs you     | Amber                          |
| Question      | Indigo                         |
| Working       | Sky, pulsing                   |
| Ready to play | Emerald                        |
| Problem       | Red                            |
| Kept          | Muted, with a check            |
| Discarded     | Muted, with a cross            |
| Held playtest | Violet frame and game bar pill |

The preview's surround is dark neutral in both themes, so the game's colours are always judged against the same background. Live, the normal state, has no colour.

## Milestone 1

Milestone 1 proves two prototypes for one idea, built in parallel, compared in the preview from a scenario, then one kept and one discarded with their lessons. The [roadmap](https://github.com/softhatgames/playstead-v0/blob/v0/docs/ROADMAP.md#milestone-1-work-with-a-developer-on-a-running-game) holds its scope. These follow it:

- Combining two prototypes that overlap, and the early overlap warning.
- Settling threads and the "getting long" bar; Codex's own compaction covers long threads until then.
- Several threads working at once on one game or prototype.
- The usage screen.
- Notifications across game projects; the switcher's counts come first.
- Previews for browser-rendered games, and Play on a phone.
- The agent's alternative cards, if they need more than instructions to the agent.

## Open questions

- The cost of copying a large game's working files for each prototype: sparse checkouts or copy-on-write cloning ([decision 0017](https://github.com/softhatgames/playstead-v0/blob/v0/docs/adr/0017-prototype-copies-and-version-control.md)).
- Recovery through other version control systems' own tools, beyond the shadow repository.
- Whether one working thread per item in milestone 1 makes the game's thread crowded enough to need topics sooner.
- Playing on a phone, for a game with touch controls, through a remote preview.

## Next step

Write milestone 1's interface work as a specification with [to-spec](../../dev/skills/to-spec/SKILL.md), then split it with [to-tickets](../../dev/skills/to-tickets/SKILL.md). A stub-data prototype of the desktop layout and phone home, following the [prototype skill](../../dev/skills/prototype/UI.md), can settle proportions before building.
