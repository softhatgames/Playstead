# Working on Playstead

Playstead is a workspace for making games with coding agents on the person's own computer. It is being rebuilt from scratch: there is no application code yet, and the design is being decided before any is written. The first version is archived, read-only, at [softhatgames/playstead-v0](https://github.com/softhatgames/playstead-v0); its tag `v0` holds its code, documents and decisions.

## Following T3 Code

Playstead follows [T3 Code](https://github.com/pingdotgg/t3code) for working with coding agents and for parts of the app around them, inspired by it and never copying its code. Read [docs/t3-code.md](docs/t3-code.md) before deciding or building anything about providers, permissions, architecture or the interface, or naming a concept: it holds the rules, the parts followed and the weekly review.

## Where things are

- [docs/adr/](docs/adr/): Playstead's decisions. Read the ADRs for the area you are deciding or building in.
- [docs/PRODUCT.md](docs/PRODUCT.md) and [docs/HARNESS.md](docs/HARNESS.md): the intended experience and the game connection, carried from v0. Their terms predate the rebuild's glossary.
- [docs/research/](docs/research/README.md): what v0 learned about providers, Effect, game stacks and the interface. Read the note for the area you are deciding.
- [Contributor skills](dev/skills/README.md): Matt Pocock's workflow. Use the repository copy when a personal skill has the same name.
- [Issue tracker](docs/agents/issue-tracker.md), [triage labels](docs/agents/triage-labels.md) and [domain documents](docs/agents/domain.md): GitHub Issues in softhatgames/playstead.
- [writing-for-agents](skills/writing-for-agents/SKILL.md): use it when writing skills or agent instructions.

Keep credentials and private session data out of the repository. Publishing, deployment and repository visibility changes need the founder's explicit approval.
