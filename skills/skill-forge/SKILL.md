---
name: skill-forge
description: >-
  How to create or change an asset of this kit — a skill, a command, an agent, a hook or a
  reference file. Use when adding a new asset, when an existing skill misfires or never fires, when
  one has outgrown its line cap and needs splitting, when choosing between a skill, a command, an
  agent and a hook, and before declaring any asset finished. Encodes this kit's own contract: the
  fixed body skeleton, the front-matter rules the validator enforces, the line caps, description
  craft, and the finish checklist. The skill-creator plugin covers generic skill authoring; this
  adds the kit's contract on top of it.
---

# skill-forge — the kit's asset contract, as a procedure

The `skill-creator` plugin already owns generic skill authoring — scaffolding, eval generation,
description optimization — so use it for the machinery. This skill adds what the plugin cannot
know: the shape rules, caps, skeleton and checks that make an asset belong to *this* kit. When the
two disagree, this contract wins.

## When

- A new asset is being added to the kit.
- A skill fires when it should not, or stays silent when it should fire.
- An asset is over its line cap, or a topic inside it needs its own file.
- The shape is unclear: skill, command, agent, hook, or reference.
- An asset is about to be called finished.

Not for: authoring machinery and eval runs, which the `skill-creator` plugin does better; skills
about a Microsoft technology, where `microsoft-skill-creator` can generate the research; project
documentation; changing settings, permissions or hook registration (that is `update-config`).

## Decide

### Which shape

Picking the wrong shape is the most common mistake in the kit. The question to answer is *when the
content has to be present*, not what it is about.

| The need | Shape | Test that confirms it |
|----------|-------|----------------------|
| A decision I keep re-making the same way | **Skill** | It answers "which way do we do X here?" |
| A fixed sequence whose decisions are already made | **Command** | It could be a script, except it needs judgement in the middle |
| Reading many files to produce a short answer | **Agent** | The value is the summary; the file dumps must not enter the main context |
| It must happen whether or not I remember | **Hook** | Forgetting it once already caused damage |
| Depth on one topic, needed occasionally | **Reference** inside the owning skill | The skill is complete without it, and better with it on demand |
| A value, a path, a permission | **Settings**, not an asset | Nothing to decide, only to configure |
| Something a plugin already covers | **A routing line**, not an asset | The plugin's own skill is better than a restatement |

Two shapes for one need is duplication: a command may *route to* a skill, never restate it.

### The skill contract

| Rule | Value | Enforced by |
|------|-------|-------------|
| Folder | `skills/<name>/SKILL.md`, plus `references/*.md` and `*.ps1` beside it | convention |
| `name` | Identical to the folder | validator, error |
| `description` | Third person, under 1024 chars, says **when** to use it and what it covers | validator, error |
| Explicit-trigger skill | The description must name its own slash trigger | validator, error |
| Body skeleton | `# name — purpose`, `## When` (ending in a "Not for:" line), `## Decide`, `## Do`, `## Traps`, `## References` — in that order | review |
| `SKILL.md` length | 150 lines maximum | cap |
| Reference length | 200 lines maximum, one topic each, self-contained | cap |
| Command length | 100 lines maximum, and a **Never** line in the body | cap |
| Style | Tables and decision trees; PowerShell examples; no version numbers | review |
| Identity | No organization names, no absolute machine paths, no addresses | validator, error |
| Cross-references | Name other assets by bare name; never link a file that does not exist yet | validator, error |

Over the cap, content is **split into a reference, never trimmed of substance**. The section that
earns a skill is `## Decide`; if that section is thin, the skill is not needed.

### Command, agent and hook contracts

| Shape | Front matter | Body must contain |
|-------|-------------|-------------------|
| Command | `description`, `argument-hint` | The procedure in order with exact CLI calls, then a **Never** line: what it must not do (post, force-push, drop, deploy) |
| Agent | `name` matching the filename, `description` saying when to spawn it, `tools` at least privilege, `model: sonnet` unless the job needs more | The **output contract** — the exact shape the caller receives — and, when read-only, that it never edits, posts or commits |
| Hook | — | Node when it runs on every tool call, pwsh when it needs Windows APIs; always exit 0 unless the block is deliberate; git state read from disk; every environment variable it uses documented in the README |

An agent no prose ever names is unreachable — the validator warns, and the fix is a routing line in
the skill or command that should spawn it.

### Where the content goes

| Symptom | Move |
|---------|------|
| `SKILL.md` over 150 lines | Pull the deepest topic into a reference; keep the routing line |
| A reference over 200 lines | Split by topic, not by size |
| Two skills answering the same question | Merge, or make one route to the other in a single line |
| A skill restating a plugin | Delete the restatement, keep one routing line |
| A skill nobody triggers | The description is the bug, not the body (`references/description-craft.md`) |
| Prose paragraphs explaining a choice | Convert to a table; if it will not fit a table, it is probably narrative and can go |

## Do

```powershell
# 1. Scaffold. The folder name is the skill name — the validator compares them.
New-Item -ItemType Directory -Path skills/<name>/references -Force
# Write SKILL.md with the six-heading skeleton; copy a shape from references/asset-templates.md.

# 2. Stay inside the caps, before anything else.
Get-ChildItem -Recurse -Path skills/<name> -Filter *.md |
  ForEach-Object { "{0}`t{1}" -f (Get-Content $_ -ReadCount 0).Count, $_.Name }

# 3. Self-check what the validator rejects. Replace each hit with a placeholder or a detection rule.
Select-String -Path skills/<name>/*.md, skills/<name>/references/*.md `
  -Pattern 'Users\\', 'Password\s*=', '\S+@\S+\.\w+', 'version \d' | Format-Table LineNumber, Line

# 4. Run the kit validator and fix every error.
node tools/validate.mjs

# 5. Add the two artefacts that make it real:
#    - a section in evals/skill-triggering.md with at least one MUST and one MUST NOT prompt;
#    - a row in the README asset table: | `skills/<name>/SKILL.md` | Skill | <one sentence>. |

# 6. Trigger check: paste the MUST prompt in a scratch session and confirm the skill loads, then
#    the MUST NOT prompt and confirm it stays out. Reworking a description? Use skill-creator.
```

**Finished means all five:** inside the caps, skeleton complete, validator clean, eval section
added, README row added. Four out of five is not finished.

## Traps

1. **A description written as a summary** — it says what the skill contains, not when to use it, so
   nothing triggers it. Rewrite it around situations.
2. **A description so broad it fires on everything** — the "Not for:" cases belong in it, in the
   words a user would actually type.
3. **A trigger-only skill whose description never names its trigger** — it fires unasked, and the
   validator rejects it.
4. **Shrinking a long skill instead of splitting it** — the substance that was dropped is exactly
   why the skill existed.
5. **A version number in prose** — the asset rots the day the version moves. Say how to detect the
   version, or route to the docs plugin.
6. **A markdown link to a file added in a later commit** — the validator fails the whole run. Name
   assets by bare name in prose.
7. **A reference file no skill routes to** — it is never read. Every reference gets a line in
   `## References` with the condition that sends you there.
8. **An org name, a machine path or an address in an example** — placeholders are allowed only for
   those three things, and required for them.
9. **MCP-first, or bash-first, instructions** — the CLI comes first (`az`, `gh`, `dotnet`, `docker`,
   `sqlcmd`) with the MCP fallback stated, and examples are PowerShell unless bash is genuinely the
   better instrument, which the asset then says.
10. **A command with no Never line** — nothing stops it from posting, dropping or deploying.
11. **An asset that duplicates an installed plugin** — check the README plugin coverage table first.

## References

- `references/description-craft.md` — writing a description that fires when it should and stays
  quiet otherwise, with the false-negative and false-positive patterns and how to test both.
- `references/asset-templates.md` — copy-paste skeletons for a skill, a command, an agent and a
  hook, plus the eval section and README row formats, and the finish checklist.
