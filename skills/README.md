# Game development skills

This directory holds the starter skills to ship with Playstead. They guide Codex and Claude as they develop games and their tools. Add a skill when a real experiment establishes a repeatable process worth sharing.

[Contributor skills](../dev/skills/README.md) for developing the application live separately in `dev/skills/`.

Users can inspect and edit skills directly, or ask the agent to add, change or remove them. Bundled skills are defaults. Existing game projects keep chosen versions; updates are proposed with an explanation and exact changes, preserving customisations and removals. Show the active set. [PRODUCT.md](../docs/PRODUCT.md#skills-under-user-control) defines the complete policy.

Skills describe how to work. Executable tools, permissions and durable state belong to Playstead's server or the game's [development layer](../docs/DEVELOPMENT-LAYER.md). Keep skills usable through the provider's supported loading mechanism, with the shared product rules in [PRODUCT.md](../docs/PRODUCT.md).

## Bundled skills

| Skill                                             | Purpose                                                                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| [writing-for-agents](writing-for-agents/SKILL.md) | Write clear skills and agent instructions with useful context pointers, completion criteria and shared references. |

`writing-for-agents` includes its skill mechanics reference and Codex display metadata. It was written by [Matt Pocock](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/productivity/writing-for-agents) and is packaged for Playstead by Soft Hat Games. The skill, mechanics reference and display metadata match that pinned source. The packaging adds the upstream LICENSE file; attribution is recorded here. The original [MIT licence and copyright](writing-for-agents/LICENSE) are included. The repository agent guide points to it, so Codex and Claude use it when working on Playstead's own agent documents.

Application loading, editing and update preservation are not built yet. The file being bundled does not yet provide that runtime integration. Further candidates are preparing an experiment, reviewing a playable result and recovering a failed change.
