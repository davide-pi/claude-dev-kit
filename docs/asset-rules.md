# Asset rules — why the kit looks the way it does

The enforced contract (folder, front matter, skeleton, caps, phrasing) has one normative copy: the
`skill-forge` skill, § 2 (`rules/kit-assets.md` keeps only the facts needed on every edit). This page holds the reasons behind it,
so a change to the contract starts from the problem the rule solves.

## The problem

One developer covers every role: analyst, backend, DBA, frontend, reviewer, release manager, ops. The kit
makes that possible by removing three costs, plus the routing that ties them together:

| Cost | What removes it | Level (README) |
| --- | --- | --- |
| Re-deciding | conventions written down once | Knowledge: skills |
| Re-discovering | context found without filling the main context window | Exploration: agents |
| Forgetting | steps that fire whether or not anyone remembers | Safety net: hooks, gates, the validator |
| Picking the owner | one table that says which asset owns a task | Routing: `CLAUDE.md`, `rules/` |

## What every turn pays

Cost is context size times turns: across a month, cache reads outweigh output tokens by orders of magnitude.
So the kit optimises what is paid every turn and what never enters the main context:

| Move | Mechanism |
| --- | --- |
| Structural delegation | noisy tools (SQL, logs, browser, CI logs) run only in a subagent or a `context: fork` skill; the main thread receives the conclusion |
| Load on touch | path-scoped `rules/`, skill bodies loaded on invocation, depth in `references/` |
| Enforce, don't narrate | a mechanical rule becomes a hook, a permission rule or a validator check, never a sentence in `CLAUDE.md` |

The byte caps on `CLAUDE.md`, the output style and `SKILL.md` follow from this: those files are paid on
every turn or every invocation.

## Principles

1. **80/20.** A fifth of the text carries most of the knowledge: tables and decision trees over prose.
   Over a cap, the depth moves to a reference file. Substance is never cut to fit.
2. **Version-agnostic.** An asset says how to detect a version (project file, manifest) or where to check
   it (the `microsoft-docs` plugin, official docs). It never encodes "in version N do X".
3. **CLI before MCP.** `az devops|boards|repos|pipelines`, `gh`, `dotnet`, `docker`, the database clients.
   An MCP server is a documented fallback for what the CLI lacks, and the asset says when.
4. **Opinionated on technique, anonymous on identity.** Real patterns, libraries and commands; placeholders
   only for org and project names, machine paths, addresses and tokens. The repository is public.
5. **Windows-native.** Examples in PowerShell 7; Bash only where it is clearly the better tool.
6. **No duplicated plugins.** An area a plugin owns gets one routing line (README, "What the kit
   deliberately does not cover").
7. **Italian for people, English for the model.** Asset prose is English and names the output language;
   see the README's opening paragraph.
8. **Say what an asset never does.** Anything that can write, post or delete states its limits in its
   contract line.
9. **One owner per fact.** Two assets saying the same thing drift apart. One owns it, the others route to it.

## Where each rule is checked

| Rule | Checked by |
| --- | --- |
| JSON parses, `settings.json` points at files that exist, front matter of agents, skills and rules | `tools/validate-assets.mjs` |
| no machine paths or secrets, cross-references resolve, triggering cases exist, environment variables documented | `tools/validate-content.mjs` |
| line and byte caps, body skeleton, contract line, no pinned versions, no real org names, relative imports, saved workflows | `tools/validate-contract.mjs` |
| hook and library behaviour, true and false positives | `tools/*.test.mjs` |
| phrasing, restatements, compaction order | review (`skill-forge` § 2, "Enforced by") |

`node tools/validate.mjs` runs the first three in order and prints one report.
