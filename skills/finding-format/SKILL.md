---
name: finding-format
description: >-
  Use when a review agent writes its findings: the Finding block, one defect per block, the closing
  verdict line. Preloaded by code-reviewer, review-security and review-performance.
user-invocable: false
---

# finding-format — the block every reviewer agent returns

**Contract.** Finding blocks and a verdict line a caller merges across reviewers · never a second
dialect, never a field outside the block · prose in the chat language, field values verbatim.

## When

Preloaded through `skills:` by `code-reviewer`, `review-security` and `review-performance`; read by
the caller that merges their reports.

Not for: the merged report's order and tables (`code-review` `references/report-format.md` § Order
and tables); a structured-output schema in the call, which is the format instead.

## Decide

### Finding block

The canonical copy is `~/.claude/skills/code-review/references/report-format.md` § Finding block, with order and the
`risk` and `effort` values (§ Fields); the validator holds this one to it byte for byte. Order: `todo`
before `done`, P1 → P3, `CONFIRMED` before `PLAUSIBLE`. ≤ 12 lines each, no cap on the count.

```text
### <n>. <one-line statement, chat language> — CONFIRMED | PLAUSIBLE
- anchor: <repo-relative/path>:<line in the working-tree file, never in the diff file>   (side: right | left)
- category: correctness | regression | security | completeness | concurrency | performance | api-contract | convention | clean-code | duplication | scope
- status: todo | done
- priority: P1 | P2 | P3            (todo only)
- risk: high | medium | low         (todo only)
- effort: S | M | L                 (todo only)
- causedByChange: true              (optional: a defect outside the perimeter that this change causes)
- failure: <inputs/state → wrong outcome, the attack path, the cost and its scale, or the intent point with no code>
- evidence: <file:line read, blame, quoted rule or intent line; CONFIRMED quotes the failing line(s) verbatim>
- for the author: yes — "<short question, prComment language>" | no
- fix: <minimal change, or omit>
```

**One defect per block — hard rule.** A title that needs "and", "also" or `(a) … (b) …` is two blocks,
each with its own anchor, priority and fix. Wrong: `### 3. null check mancante e cache mai invalidata`.
Right: `### 3. null check mancante` and `### 4. cache mai invalidata`, two blocks.

### Closing verdict line

`Verdict: N findings (X todo, Y done · P1: N · CONFIRMED: N, PLAUSIBLE: N)`, written in the chat
language (the `Lang:` line), never a fixed one. A specialist names its pass (`N security findings`);
`code-reviewer` appends ` · security: N · completeness: N`. At chat `it`: Verdict=Verdetto,
findings=rilievi, Intent=Intento, points=punti, covered=coperti.

## Do

Write the blocks in order, then the agent's own closing fields (intent coverage, surface summary,
hot-path summary), then the verdict line last.

## Traps

1. Two defects share a title joined by "and" → the merger cannot rank them → split into two blocks.
