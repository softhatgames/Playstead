# Working on Playstead

Playstead is a workspace for making games with coding agents on the person's own computer. Its first working slice, threads with Codex and Claude, is built; the game development features are designed and not yet built.

## Following T3 Code

Playstead follows [T3 Code](https://github.com/pingdotgg/t3code) for working with coding agents and for parts of the app around them, inspired by it and never copying its code. Read [docs/t3-code.md](docs/t3-code.md) before deciding or building anything about providers, permissions, architecture or the interface, or naming a concept: it holds the rules, the parts followed and the weekly review.

## Where things are

- [docs/adr/](docs/adr/): Playstead's decisions. Read the ADRs for the area you are deciding or building in.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): Playstead's structure, mapped onto T3 Code's, and what it leaves out. Read it before placing code, porting from T3 Code, writing tests or changing CI.
- [docs/PRODUCT.md](docs/PRODUCT.md) and [docs/DEVELOPMENT-LAYER.md](docs/DEVELOPMENT-LAYER.md): the intended experience, and how each game is built so Playstead and the agent can see, drive and change it. Read them before designing or building a game feature.
- [GLOSSARY.md](GLOSSARY.md): Playstead's terms for making games. Use them when naming a game concept in code, documents or issues.
- `.repos/effect-smol`: Effect's source at the version Playstead uses, vendored read-only. Read it, and its `LLMS.md`, before writing Effect code. Never edit or import from it; after bumping `effect`, run `vp run sync:repos`.
- [docs/research/](docs/research/README.md): Playstead's investigations into providers, Effect, game stacks and the interface. Read the note for the area you are deciding.
- [Contributor skills](dev/skills/README.md): Matt Pocock's workflow. Use the repository copy when a personal skill has the same name.
- [Issue tracker](docs/agents/issue-tracker.md), [triage labels](docs/agents/triage-labels.md) and [domain documents](docs/agents/domain.md): GitHub Issues in softhatgames/playstead.
- [writing-for-agents](skills/writing-for-agents/SKILL.md): use it when writing skills or agent instructions.

Keep credentials and private session data out of the repository. Publishing, deployment and repository visibility changes need the founder's explicit approval.
