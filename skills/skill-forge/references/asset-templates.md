# Asset templates and the finish checklist

Copy the shape, then fill it. Deviating from the skeleton is a review rejection, not a style choice.

## Skill

````markdown
---
name: <same as the folder>
description: >-
  <What it decides, in one clause.> Use when <situation>, <situation>, <situation>. Covers
  <the concrete things>. <Trigger: /<name> [args] — only for a trigger-only skill.>
---

# <name> — <one-line purpose>

## When

- <situation>
- <situation>
- <situation>

Not for: <what it explicitly excludes, routing each exclusion to the asset or plugin that owns it>.

## Decide

<The core: a decision table or a decision tree. This section earns the skill; if it is thin, the
skill should not exist.>

## Do

```powershell
# Copy-pasteable PowerShell. Real flags, no pseudo-commands.
```

## Traps

1. **<symptom>** — <cause>. <fix>.
2. **<symptom>** — <cause>. <fix>.

## References

- `references/<topic>.md` — <the condition that sends you there>.
````

Caps: 150 lines for the skill, 200 per reference. Over the cap, split — never trim substance.

## Command

```markdown
---
description: <what one invocation does>
argument-hint: [target] [effort] [focus]
---

# /<name> — <one-line purpose>

<One paragraph at most: what it assumes is already decided.>

## Procedure

1. <step, with the exact CLI call>
2. <step>
3. <step, including what to report back and in what shape>

**Never:** <post, force-push, drop, deploy, delete — whatever this command must not do, even when
asked mid-run.>
```

Cap: 100 lines. A command assumes the decision is made; if it has to choose, it routes to a skill.

## Agent

```markdown
---
name: <same as the filename>
description: <when to spawn it, in the words the caller will use>
tools: Read, Grep, Glob
model: sonnet
---

# <name>

<What it is for, in two lines.>

## Input

<What the caller must provide, field by field. An agent that has to guess the intent returns noise.>

## Method

1. <step>
2. <step>

## Output contract

<The exact shape the caller receives — the fields, their order, and what an empty result looks
like. The caller parses this; it is the interface.>

**This agent never edits, posts, commits or merges.**  <!-- read-only agents only -->
```

`tools` is least privilege: a read-only agent gets `Read, Grep, Glob` and nothing else. `model:
sonnet` unless the job genuinely needs more. Add a routing line naming the agent in the skill or
command that spawns it, or nothing can reach it.

## Hook

| Decision | Rule |
|----------|------|
| Runtime | Node when it runs on every tool call; pwsh when it needs Windows APIs |
| Exit code | Always 0, unless the block is deliberate |
| Git state | Read from disk, never by shelling out |
| Environment variables | Every one it reads is documented in the README |
| Output | Quiet on the happy path; a hook that prints on every call becomes noise and gets disabled |

Registration lives in settings, and changing settings is `update-config`, not this skill.

## Eval section

Added to the kit's triggering evals for every new asset:

```markdown
### `<name>` — <one-line contract>

| Prompt | Expected |
|--------|----------|
| "<natural phrasing>" | MUST load |
| "<the trigger, if any>" | MUST load |
| "<superficially similar request owned by a neighbour>" | MUST NOT (<why>) |
```

## README row

One row per asset in the README table, matching the existing column shape:

```markdown
| `skills/<name>/SKILL.md` | Skill | <one sentence: what it decides, and the two things it covers>. |
```

## Language

An asset of this kit is **written in English** — its prose addresses the model, and this repository
is public — and it *says* "produce Italian" for everything a person reads: chat output, a
classification line, the questions asked, reports, tables, verdicts, an evidence summary, a Decision
Summary, the explanation of a diagnosis. State it once, near the top of the asset, and the exception
that applies to it where the asset produces one.

| Stays English | Why |
|---------------|-----|
| Source code, identifiers, code comments, test code | It lives with the code and follows the repository's conventions |
| A project's technical documentation tree (`docs/tech*`, architecture maps, flow docs, its own `CLAUDE.md`) | Technical reference an AI session consumes, not prose a person reads |
| Plan files and design specs | Technical artifacts a later session reads back |
| Machine identifiers: command names and flags, `file:line`, test names, `CONFIRMED`/`PLAUSIBLE`, exception and type names, log lines, tool output | They are the format; translated output stops being evidence |

An asset written *in* Italian is the failure mode this rule prevents — `worklog` is the one
deliberate exception, and it says so.

## Finish checklist

| # | Check | How |
|---|-------|-----|
| 1 | Inside the caps | Count the lines of the skill and every reference |
| 2 | Skeleton complete and in order | The six headings, `## When` ending in a "Not for:" line |
| 3 | `## Decide` carries real content | A table or a tree, not paragraphs |
| 4 | No identity leaks | No organization names, absolute machine paths or addresses |
| 5 | No version numbers | Detection rule or a docs-plugin route instead |
| 6 | CLI before MCP | `az`, `gh`, `dotnet`, `docker`, `sqlcmd` first; the fallback is stated |
| 7 | PowerShell examples | Bash only where it is genuinely better, and it says why |
| 8 | No duplication of a plugin | Checked against the plugin coverage table |
| 9 | Every reference reachable | A line in `## References` with its condition |
| 10 | No link to a file that does not exist | Bare names in prose |
| 11 | Validator clean | `node tools/validate.mjs` |
| 12 | Eval section added | At least one MUST and one MUST NOT |
| 13 | README row added | In the asset table |
| 14 | Limits stated | Any asset that can write, post or delete says what it never does |
| 15 | Output language stated | English prose that says "produce Italian", with the English exceptions named where the asset produces one |

Fourteen out of fifteen is not finished.
