# Asset templates and the finish checklist

Copy the shape, then fill it. The skeleton is the contract, not a style choice.

## Auto skill

````markdown
---
name: <same as the folder>
description: >-
  Use when <situation>, <situation> or <symptom the user types> — <file types, if the skill owns
  them>.            # ≤ 25 words, third person, trigger terms first
---

# <name> — <one-line purpose>

**Contract.** <what it produces> · <what it never does> · <output language>

## When

- <situation, in the user's words>
- <situation>

Not for: <neighbour case> (`<owner>`), <neighbour case> (`<owner>`).

## Decide

<The core: tables or a decision tree. This section earns the skill; it sits near the top because
a compacted body is cut from the bottom.>

## Do

```powershell
# Copy-pasteable PowerShell, real flags, verified with --help.
```

## Traps

1. <symptom> → <cause> → <fix>.        # never a restated Decide row

## References

- `references/<topic>.md` — <the condition that sends you there>.
````

## User-invoked skill

Same body, plus:

```yaml
description: >-
  Use when the user types /<name> [args] to <what one invocation does>.
disable-model-invocation: true
argument-hint: "[target] [effort]"
```

The contract line's "never" names the side effect it must not take unasked (post, merge, write
hours, change State). Keep a `/<name>` case in the evals: the flag's behaviour has changed between
builds.

## Fork skill

```yaml
description: >-
  Use when the user types /<name> <args> to <what comes back>.
context: fork
agent: <agent name | general-purpose>
background: false
model: sonnet            # allowed here: it sets the subagent's model, no main-thread cache miss
argument-hint: "<args>"
```

The fork sees **only** the body and its arguments — no conversation, no earlier tool results. The
body carries the house line ``Arguments: `$ARGUMENTS` `` right after the contract (it is substituted
at invocation, so never write the placeholder anywhere else in a `SKILL.md`), and states: the
argument grammar and how to parse it; every default the
conversation would have supplied; which skills to load with the Skill tool; and the exact report
shape, capped (≤ N lines), because that report is all the main thread receives.

## Rule

```markdown
---
paths: "**/*.ext,**/Folder/**"
---
# <topic> — facts

- <fact or gotcha, one line, true of every matching file>

Procedure: skill `<name>`.
```

≤ 25 lines. `paths` is one comma-separated **string** (a YAML list was silently ignored). Facts a
re-read recovers: after `/compact` a `paths` rule is summarised away until the next matching read.

## Agent

```markdown
---
name: <same as the filename>
description: >-
  Use proactively when <situation the caller is in>.      # ≤ 25 words
tools: Read, Grep, Glob          # least privilege
model: sonnet
effort: medium
maxTurns: 30                     # advisory, not enforced
omitClaudeMd: true               # when the body defines everything it needs
---

# <name> — <role in two lines>

## Ground rules (hard)
- <≤ 6 bullets>

## Method
<tables>

## Output — ≤ N lines, exactly these sections
<the exact shape; Italian prose, identifiers verbatim; what an empty result looks like>

## Never
- <edits, posts, commits, merges — whatever applies>
```

| Field | Rule |
| --- | --- |
| `memory: project` | only with Write or Edit in `tools` (otherwise nothing is ever written); scope resolves against the launch directory |
| `mcpServers` | an **inline** definition keeps the server out of the main thread; a name reference shares the parent's connection |
| `skills` | preload the stack skill the agent always needs |
| body | ≤ 110 lines; a routing line in some skill or `CLAUDE.md` names the agent, or nothing reaches it |

## Hook

| Decision | Rule |
| --- | --- |
| Type | command first; a `prompt` hook only where a regex cannot decide, and never on `SessionStart` |
| Runtime | Node when it runs on every tool call; pwsh when it needs Windows APIs |
| Exit | 0 unless the block is deliberate; quiet on the happy path |
| Context | plain stdout reaches Claude on `SessionStart` and `UserPromptSubmit` (and two rarer events); elsewhere `hookSpecificOutput.additionalContext` |
| `SessionStart` matcher | include `compact`, or the injected line vanishes after `/compact` |
| State | git state read from disk; every environment variable documented in the README |
| Tests | `tools/<hook>.test.mjs`, run with `node --test tools/*.test.mjs` |

Registration lives in `settings.json` (`update-config`).

## Eval section

```markdown
### `<name>` — <one-line contract>

| Prompt | Expected |
| --- | --- |
| "<natural phrasing, no keyword from the description>" | MUST load |
| "/<name> <args>" | MUST load (user-invoked skills) |
| "<near miss owned by a neighbour>" | MUST NOT (<why>) |
```

## README row

```markdown
| `skills/<name>/SKILL.md` | Skill | <one sentence: what it decides, and the two things it covers>. |
```

## Finish checklist

| # | Check | How |
| --- | --- | --- |
| 1 | Caps | SKILL.md ≤ 120, reference ≤ 200, rule ≤ 25, agent body ≤ 110 |
| 2 | Skeleton | contract line, the six headings in order, `Not for:` with ≤ 3 items |
| 3 | `## Decide` carries the substance | tables or a tree, in the top half |
| 4 | Description | ≤ 25 words, `Use when …`, triggers first; `/<name>` and the flag on a user-invoked skill |
| 5 | Fork skill self-contained | inputs, defaults and report shape restated; `background: false` |
| 6 | No restatement | of `CLAUDE.md`, a plugin, or another asset — one owner, routing lines elsewhere |
| 7 | Identity | placeholders only |
| 8 | Versions | detection rule instead of a number |
| 9 | CLI before MCP | fallback stated |
| 10 | Every reference reachable | a `## References` line with its condition |
| 11 | Limits | anything that writes, posts or deletes says what it never does |
| 12 | Validator and tests | `node tools/validate.mjs`; `node --test tools/*.test.mjs`; every new check seen failing once on a bad input |
| 13 | Eval section and README row | added |
| 14 | No shadowing | no project skill with the same name in the workspaces it serves |
