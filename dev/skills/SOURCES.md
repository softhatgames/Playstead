# Matt Pocock's skills: source and local change

This collection is by [Matt Pocock](https://github.com/mattpocock/skills), under MIT. It follows the complete skill list in his [v1.3.1 plugin manifest](https://github.com/mattpocock/skills/blob/49dd158d1076134a641b33efb035946536778336/.claude-plugin/plugin.json) at commit [`49dd158d1076`](https://github.com/mattpocock/skills/commit/49dd158d1076134a641b33efb035946536778336), retrieved on 2026-10-14. That commit includes changes after the v1.3.1 release; the immutable commit is the source of truth.

All skill files and supporting resources retain their upstream contents except the single patch below. Original names, descriptions, display metadata and invocation policies are preserved. Each folder includes the upstream MIT licence with `Copyright (c) 2026 Matt Pocock`. Original CREDITS.md files are retained, including the PR skill's credit to Dex Horthy.

## One-question adaptation

Soft Hat Games adapts [grilling](grilling/SKILL.md) to ask one question at a time and wait for its answer. The [exact patch](patches/grilling-one-question.patch) changes the round instruction, example, dependency wording and parallel-research wording consistently. The design tree, recommendations, delegated fact-finding, exhaustive completion and final confirmation remain upstream's.

Apply this patch to the pinned upstream file when refreshing the collection. No other workflow changes are carried. The earlier Playstead rewrites and command prefixes have been removed.

## Packaging and setup

The provider discovery folders link to `dev/skills/`. Writing-for-agents links onward to the [shared product copy](../../skills/writing-for-agents/SKILL.md), which retains the upstream files and an added LICENSE. The [product catalogue](../../skills/README.md) also credits it.

Repository-specific setup belongs in [docs/agents/](../../docs/agents/issue-tracker.md), seeded from setup-matt-pocock-skills. It selects GitHub Issues, the default triage labels and a single domain context. Existing ADRs live at the upstream path, `docs/adr/`. These are project configuration and records, not edits to Matt's skills.

## Pinned sources

| Skill                         | Upstream folder                                                                                                                                                                         |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ask-matt                      | [skills/engineering/ask-matt](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/engineering/ask-matt)                                           |
| diagnosing-bugs               | [skills/engineering/diagnosing-bugs](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/engineering/diagnosing-bugs)                             |
| grill-with-docs               | [skills/engineering/grill-with-docs](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/engineering/grill-with-docs)                             |
| triage                        | [skills/engineering/triage](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/engineering/triage)                                               |
| improve-codebase-architecture | [skills/engineering/improve-codebase-architecture](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/engineering/improve-codebase-architecture) |
| setup-matt-pocock-skills      | [skills/engineering/setup-matt-pocock-skills](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/engineering/setup-matt-pocock-skills)           |
| tdd                           | [skills/engineering/tdd](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/engineering/tdd)                                                     |
| to-spec                       | [skills/engineering/to-spec](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/engineering/to-spec)                                             |
| to-tickets                    | [skills/engineering/to-tickets](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/engineering/to-tickets)                                       |
| wayfinder                     | [skills/engineering/wayfinder](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/engineering/wayfinder)                                         |
| implement                     | [skills/engineering/implement](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/engineering/implement)                                         |
| implement-spec                | [skills/engineering/implement-spec](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/engineering/implement-spec)                               |
| prototype                     | [skills/engineering/prototype](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/engineering/prototype)                                         |
| research                      | [skills/engineering/research](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/engineering/research)                                           |
| domain-modeling               | [skills/engineering/domain-modeling](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/engineering/domain-modeling)                             |
| codebase-design               | [skills/engineering/codebase-design](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/engineering/codebase-design)                             |
| code-review                   | [skills/engineering/code-review](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/engineering/code-review)                                     |
| pr                            | [skills/engineering/pr](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/engineering/pr)                                                       |
| retro                         | [skills/engineering/retro](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/engineering/retro)                                                 |
| wizard                        | [skills/engineering/wizard](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/engineering/wizard)                                               |
| grill-me                      | [skills/productivity/grill-me](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/productivity/grill-me)                                         |
| grilling                      | [skills/productivity/grilling](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/productivity/grilling)                                         |
| handoff                       | [skills/productivity/handoff](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/productivity/handoff)                                           |
| teach                         | [skills/productivity/teach](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/productivity/teach)                                               |
| to-questionnaire              | [skills/productivity/to-questionnaire](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/productivity/to-questionnaire)                         |
| wait-what                     | [skills/productivity/wait-what](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/productivity/wait-what)                                       |
| writing-for-agents            | [skills/productivity/writing-for-agents](https://github.com/mattpocock/skills/tree/49dd158d1076134a641b33efb035946536778336/skills/productivity/writing-for-agents)                     |

Review source changes before updating the pinned revision. Preserve the one-question patch and licence files. Formatting, metadata and discovery checks do not establish behavioural performance; report separately what has been exercised.
