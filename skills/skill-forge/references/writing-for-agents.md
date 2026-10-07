# Writing for agents — the levers that make an asset predictable

Applies to every text an agent consumes: a skill, a reference, a command, an agent prompt, a
`CLAUDE.md`. The goal is not the same output every run but the same **process** every run. Adapted
from the `writing-for-agents` skill in `mattpocock/skills` (MIT).

## Context pointers

A **context pointer** is an always-loaded line that names out-of-context material and the condition
for reaching it: a skill description, a `## References` line, a `CLAUDE.md` line naming a doc. The
pointer's wording — not the target's content — decides whether the material is ever read.

| Rule | Why |
|------|-----|
| Front-load the trigger word | the first words do the matching |
| One trigger per **branch** (a distinct case the material handles) | synonyms of one branch are one branch written twice — collapse them |
| Cut identity the body already carries | every word of an always-loaded pointer costs on every turn |
| A must-read target behind a weak pointer → sharpen the wording first | inline the material only if sharpening fails |

## The two loads

| Load | Paid by | Cost |
|------|---------|------|
| **Context load** | the model, every turn | always-loaded lines: descriptions, `CLAUDE.md`, routing lines |
| **Cognitive load** | the human | knowing which asset exists and when to call it |

Material behind a pointer pays only the pointer's line. Material with no pointer at all is reached
only if the human remembers it — spend that load where human judgement matters (explicit-trigger
commands), remove it where it does not.

## Information hierarchy

| Rung | Content | Where |
|------|---------|-------|
| 1 | **Steps** — what the agent does, in order | in the file, at the top |
| 2 | **In-file reference** — rules and facts consulted on demand | in the file, below the steps |
| 3 | **Disclosed reference** — needed only by some branches | a `references/*.md` behind a pointer |

**Disclosure test:** inline what every branch needs; push behind a pointer what only some branches
reach. Reference left in-file buries the steps and makes following them a coin flip.

**Co-location:** a concept's definition, rules and caveats sit under one heading. Scattered meaning
is as bad as duplicated meaning.

**Sprawl:** a file too long even when every line is live. The cure is the ladder, not trimming
substance (that is the kit's "split, never shrink" rule).

## Completion criteria

Every step ends on a condition that tells the agent it is done.

| Property | Weak | Strong |
|----------|------|--------|
| **Clarity** — can done be told from not-done? | "understanding reached" | "one command that goes red on this bug, already run once" |
| **Demand** — how much it requires | "produce a change list" | "every modified model accounted for" |

A vague criterion invites **premature completion**: the visible next steps pull attention away from
the current one. Sharpen the criterion first; split the sequence across a real context boundary (a
subagent, a hand-off) only if the rush persists — an inline call clears nothing.

## Leading words

A **leading word** is a compact concept the model already knows that anchors a whole behaviour in
one token: *frontier*, *tracer bullet*, *red* (a loop that goes red on the bug), *tight* (a loop
that is fast, deterministic, low-overhead), *blast radius*, *seam*.

- Repeat the **token**, never the sentence: it builds a distributed definition at no cost.
- Prefer a pretrained word to a coined one — a coined word recruits no priors and must be defined.
- Hunt for passages that spell the same triad out at several sites; collapse them into the word.

## Positive phrasing

A prohibition drags the forbidden behaviour into context and makes it *more* available ("don't think
of an elephant"). State the target behaviour instead: "write one-line comments", not "don't write
long comments". A prohibition earns its place only as a hard guardrail with no positive form — the
`Never` line of a command — and even then pair it with the positive target.

## Pruning

| Smell | Test | Move |
|-------|------|------|
| **Duplication** | the same meaning in two places | keep one source of truth, route to it |
| **Cache** | the text restates what one file or one command shows (`package.json`, `--help`, the folder layout) | delete it and point at the lookup; keep only what no lookup reveals — the unwritten convention, the why, the gotcha |
| **No-op** | does the sentence change behaviour versus the model's default? | no → delete the **whole** sentence, not words from it |
| **Weak word** | the word is too mild to beat the default ("be thorough") | replace it with a stronger leading word ("relentless") |
| **Sediment** | a stale layer nobody dares remove | delete; a shorter file is easier to keep true |

The no-op test is model-relative, not reader-relative: settle a disagreement by running the asset
(an eval prompt), not by debate.

## Checklist before calling an asset finished

1. Every pointer front-loads its trigger and lists one trigger per branch.
2. Every step has a clear, demanding completion criterion.
3. Every prohibition either has a positive form or is a hard guardrail.
4. No sentence is a no-op, a cache, or a duplicate of another asset.
5. Reference that only some branches need sits behind a pointer.
