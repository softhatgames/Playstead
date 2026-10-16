# Matt Pocock's skills for developing Playstead

This is the complete collection shipped in Matt Pocock's pinned v1.3.1 plugin manifest: 20 engineering skills and 7 productivity skills. It develops Playstead itself. The [product's game-development skills](../../skills/README.md) remain a separate collection.

The skills retain Matt's original names, instructions, supporting files and invocation policies. **The only workflow adaptation is one grilling question at a time.** [SOURCES.md](SOURCES.md) records the exact source, licence and patch. No skills have a Playstead prefix.

## Use the workflow

Start a session in this checkout or a subdirectory. Codex discovers `.agents/skills`; Claude Code discovers `.claude/skills`. Both are links to this collection.

| Task                               | Codex              | Claude Code        |
| ---------------------------------- | ------------------ | ------------------ |
| Choose a workflow                  | `$ask-matt`        | `/ask-matt`        |
| Develop an idea and its documents  | `$grill-with-docs` | `/grill-with-docs` |
| Turn the agreed design into a spec | `$to-spec`         | `/to-spec`         |
| Split the spec into GitHub tickets | `$to-tickets`      | `/to-tickets`      |
| Build a ticket                     | `$implement`       | `/implement`       |
| Build the whole spec               | `$implement-spec`  | `/implement-spec`  |
| Review a session                   | `$retro`           | `/retro`           |

Add the task, issue or revision after the skill name. Use `/skills` to browse. Without a picker, ask the agent to use the repository's grill-with-docs skill. The [ask-matt guide](ask-matt/SKILL.md) explains branches, prototypes and handoffs. Choose the skills needed for the task.

User-invoked skills, including grill-with-docs and retro, keep their upstream Claude frontmatter and Codex policies. Other skills remain available for automatic selection. Grilling still uses Matt's design tree, recommendations, delegated fact-finding and final confirmation; it asks only one question before waiting for an answer.

## Repository setup

- [GitHub issue tracker](../../docs/agents/issue-tracker.md): specs, tickets, dependencies and tracker operations for softhatgames/playstead.
- [Triage labels](../../docs/agents/triage-labels.md): Matt's five default roles.
- [Domain documents](../../docs/agents/domain.md): one domain context, a root GLOSSARY.md created when terms are resolved, and existing decisions in `docs/adr/`.

Setup is complete using Matt's templates and the agreed choices. The engineering skills read these files through the shared agent instructions. Edit `docs/agents/*.md` directly when needed; run setup again to switch trackers or start over.

## Discovery and personal installations

Original names can collide with personal installations. Codex may list both copies; choose the repository path. Claude gives personal skills priority for a shared name. To load only this project's settings and skills in Claude Code, start it with `claude --setting-sources project`. For other clients, the repository's AGENTS.md tells the agent to read the local file when its loader chooses a personal copy. See the [official OpenAI documentation](https://learn.chatgpt.com/docs/build-skills) and [Claude Code skill guide](https://code.claude.com/docs/en/skills).

After pulling updates, restart Codex if skills do not appear. In Claude Code, run `/reload-skills` or start a new session. A client such as T3 Code controls its own picker. Symbolic links must work in the checkout; otherwise read the canonical files directly. Windows checkout behaviour and T3 Code's picker remain unassessed.

## Catalogue

| Skill                                                                   | Purpose                                                      |
| ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| [ask-matt](ask-matt/SKILL.md)                                           | Choose a skill or workflow for the current situation.        |
| [diagnosing-bugs](diagnosing-bugs/SKILL.md)                             | Build a feedback loop, reproduce, diagnose and verify a fix. |
| [grill-with-docs](grill-with-docs/SKILL.md)                             | Interview while maintaining a glossary and ADRs.             |
| [triage](triage/SKILL.md)                                               | Turn incoming issues into actionable work.                   |
| [improve-codebase-architecture](improve-codebase-architecture/SKILL.md) | Find opportunities to deepen modules.                        |
| [setup-matt-pocock-skills](setup-matt-pocock-skills/SKILL.md)           | Configure the tracker, triage labels and domain documents.   |
| [tdd](tdd/SKILL.md)                                                     | Develop behaviour through a test-first loop at agreed seams. |
| [to-spec](to-spec/SKILL.md)                                             | Turn an agreed design into a spec in the issue tracker.      |
| [to-tickets](to-tickets/SKILL.md)                                       | Split a spec into tickets and blocking relationships.        |
| [wayfinder](wayfinder/SKILL.md)                                         | Map decisions for an effort too large for one session.       |
| [implement](implement/SKILL.md)                                         | Build a ticket or scoped task through testing and review.    |
| [implement-spec](implement-spec/SKILL.md)                               | Build a spec through parallel ticket work and integration.   |
| [prototype](prototype/SKILL.md)                                         | Answer a design question with a throwaway prototype.         |
| [research](research/SKILL.md)                                           | Delegate primary-source research and record findings.        |
| [domain-modeling](domain-modeling/SKILL.md)                             | Sharpen terms, maintain the glossary and record decisions.   |
| [codebase-design](codebase-design/SKILL.md)                             | Design deep modules, interfaces and seams.                   |
| [code-review](code-review/SKILL.md)                                     | Review standards and spec through parallel agents.           |
| [pr](pr/SKILL.md)                                                       | Write a pull-request description with evidence and risk.     |
| [retro](retro/SKILL.md)                                                 | Review a session and suggest environment improvements.       |
| [wizard](wizard/SKILL.md)                                               | Guide a person through steps only they can perform.          |
| [grill-me](grill-me/SKILL.md)                                           | Interview without maintaining local design documents.        |
| [grilling](grilling/SKILL.md)                                           | Stress-test an idea, one question at a time.                 |
| [handoff](handoff/SKILL.md)                                             | Prepare context for another session or workspace.            |
| [teach](teach/SKILL.md)                                                 | Teach a concept through a persistent learning workspace.     |
| [to-questionnaire](to-questionnaire/SKILL.md)                           | Prepare questions for someone outside the session.           |
| [wait-what](wait-what/SKILL.md)                                         | Explain a confusing message with its missing context.        |
| [writing-for-agents](writing-for-agents/SKILL.md)                       | Write skills and documents agents consume.                   |

Writing-for-agents links to the [single shared copy](../../skills/writing-for-agents/SKILL.md) in the product collection. Retro reaches it by its original name.

## Maintain the collection

Keep upstream files intact except for the documented grilling patch. Preserve all licences and credits, including third-party attribution bundled with individual skills. Review upstream changes against the pinned revision before adopting them.

This is a checked-in, pinned collection exposed through the providers' discovery folders. It is maintained in this repository; Matt's plugin and the `skills` installer do not manage its updates. The project's Claude settings (`.claude/settings.json`) turn Matt's plugin off, so its drifted copies cannot stand in for these.

Imported folders are excluded from automatic formatting so source comparisons remain useful. Check metadata, references, helper scripts and provider discovery directly. Packaging checks do not establish the quality of an agent's decisions on real tasks.
