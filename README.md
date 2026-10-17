# Playstead

**Make something worth playing.**

Playstead is a workspace for making games with coding agents, on your own computer. Describe an idea, try it, talk about what happened and decide what deserves more work. The technical work should leave you more time for what makes a game yours: its ideas, its rules and the way it feels to play.

You bring the taste and direction. You can shape a game without knowing how to program, or work directly in the code with your own tools and technical choices. Either way, the game and the decisions that define it stay yours.

> **Status: early.** Playstead's first working slice runs: threads with Codex and Claude, in its desktop app or a browser on the same computer. The game development experience described below is designed and not yet built.

## Find the game through play

A game takes shape through choices about its rules, controls, pacing and feel. Playstead is designed around short cycles of trying those choices in the running game.

1. **Describe what you want to explore**, from a new idea to a small change in how a jump feels.
2. **Try a prototype.** The agent builds it in its own copy of the game and starts it where it matters, even late in the game.
3. **Play and give feedback.** Play beside the agent's thread, or in the game's own window as a player would. Point at a moment and say what feels right and what needs work.
4. **Compare and refine.** Try several prototypes of one idea from the same starting point.
5. **Keep what works.** A kept prototype goes into the game. The others are discarded, with what they taught recorded, and stay recoverable.

## Games the agent can understand

Every game Playstead builds is written as code with its own engine, on proven libraries, and follows one simple structure: the game's rules advance its state tick by tick from the players' actions, and everything you see and hear follows from that state. That structure lets the agent:

- see exactly what is happening in the running game, and change it while you play;
- test the game's rules in seconds, without drawing a frame;
- play the game itself, as a scripted run or as a bot, the way a real player would;
- replay any run exactly, on any desktop computer, to find where something went wrong;
- render gameplay video for trailers and store pages from a replay, at any resolution and format.

The development tools live only in development builds. The game you ship contains nothing of Playstead, and everything made with it, from source and assets to tools and design records, stays usable without it.

## Work your way

Someone new to programming can leave setup, code, checks and repairs to the agent, which explains its choices through their effect on the game. An experienced developer gets source, diffs and diagnostics, works in their own editor, and sets the languages, libraries and architecture the agent must respect. The agent can also build the tools a game needs, such as a level editor, a tuning panel or a dialogue editor, inside the game itself.

C# on .NET 10 is the first supported language. More will follow when real games need them.

## Built on T3 Code

Playstead's work with coding agents follows [T3 Code](https://github.com/pingdotgg/t3code): its providers, permissions, terms, architecture and parts of its interface. Playstead adds what making a game needs. [Following T3 Code](docs/t3-code.md) explains what is followed and how Playstead keeps up.

## Try it from source

You need Git, Node 24 and pnpm 11, plus [Codex](https://github.com/openai/codex) or [Claude Code](https://code.claude.com) installed and signed in. Playstead uses your own sign-ins.

```sh
git clone https://github.com/softhatgames/playstead.git
cd playstead
pnpm install
pnpm dev          # the server and interface; open the pairing link it prints
pnpm dev:desktop  # or the desktop app
```

Playstead keeps its data in `~/.playstead`, outside the checkout.

## Documentation

| Document                                           | What it covers                                                                                                                         |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| [Product design](docs/PRODUCT.md)                  | The intended experience, from the first idea to marketing                                                                              |
| [The development layer](docs/DEVELOPMENT-LAYER.md) | How each game is built so Playstead and the agent can see, drive, test and change it                                                   |
| [Glossary](GLOSSARY.md)                            | Playstead's terms for making games                                                                                                     |
| [Architecture](docs/ARCHITECTURE.md)               | How the application is structured, mapped onto T3 Code's                                                                               |
| [Following T3 Code](docs/t3-code.md)               | What Playstead follows from T3 Code, and the weekly review                                                                             |
| [Decisions](docs/adr/)                             | Why Playstead is built the way it is                                                                                                   |
| [Roadmap](docs/ROADMAP.md)                         | The versions, from the first public release, 0.1, and the milestones on the way                                                        |
| [Research](docs/research/README.md)                | Investigations into providers, Effect, game stacks and the interface                                                                   |
| [Game development skills](skills/README.md)        | The starter skills Playstead ships for making games                                                                                    |
| [Contributor skills](dev/skills/README.md)         | The engineering workflow used to build Playstead                                                                                       |
| [Issue tracker](docs/agents/issue-tracker.md)      | How work is tracked in GitHub Issues, with [triage labels](docs/agents/triage-labels.md) and [domain documents](docs/agents/domain.md) |
| [AGENTS.md](AGENTS.md)                             | Instructions for coding agents working on Playstead                                                                                    |

The decisions so far:

- [0001: Follow T3 Code](docs/adr/0001-follow-t3-code.md)
- [0002: The development layer](docs/adr/0002-the-development-layer.md)
- [0003: Game state in the games Playstead builds](docs/adr/0003-game-state-in-the-games-playstead-builds.md)
- [0004: Code-first games, starting with C#](docs/adr/0004-code-first-games-starting-with-csharp.md)

## Contributing

Playstead is built in the open. Bug reports and ideas are welcome in [GitHub Issues](https://github.com/softhatgames/playstead/issues). Before a larger change, read the [product design](docs/PRODUCT.md) and [AGENTS.md](AGENTS.md), which holds the rules for working on Playstead.

## Licence

Playstead is available under the [MIT licence](LICENSE).

---

A project by [Soft Hat Games](https://github.com/softhatgames).
