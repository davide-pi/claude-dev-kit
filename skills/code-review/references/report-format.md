# Review report format — the summary table goes last

Shared by `/code-review`, the built-in `/review` and `/security-review`, ad-hoc
reviews and merged runs. The user reads the table first, then scrolls up to the blocks that matter,
so every report **ends** with the summary table, after all the detail.

## Who reviews, on which model

| Request | Agents, spawned in one message |
| --- | --- |
| any review (`/code-review`, an ad-hoc "review this"), effort `low` / `medium` | `code-reviewer` subagent, never inline |
| effort `high` | `code-reviewer` A alone plus `review-security` and `review-performance`; merged |
| effort `xhigh` or above | `code-reviewer` ×2 with the **same brief** — reviewer A and reviewer B on two different models — plus `review-security` and `review-performance`; merged |
| "security review" / "performance review" | that specialist alone |
| the built-in `/security-review` | only when the user names it; its output stays separate (different format) |

`model` per agent:

| The request says | Reviewer A and specialists | Reviewer B |
| --- | --- | --- |
| nothing | omit `model` (frontmatter: sonnet) | `opus` |
| "advanced" agents | `opus`, explicitly | sonnet — B always runs on the model A does not |
| "agent {model}" | that exact model | `opus`, or sonnet if that is the model A runs on |

A and B get **one brief, built once**: the same text, differing only in `model`. A pair on one
model is a degraded review: say so in the verdict line.

Cross-model merge: same anchor and same defect from A and B → `CONFIRMED`, sorted first within its
priority; found by one model only → `PLAUSIBLE`, unless the finding quotes evidence (the line, the
failing call) that settles it.

A diff too large for one reviewer (30+ files) → offer the saved workflow `/review-pair` (two reviewers of the whole change,
A on Sonnet + B on Opus, one merger) and wait for the user's yes; never launch it unasked.

## Fields (emitted by the agents, values verbatim)

| Field | Values |
| --- | --- |
| `priority` — impact if not fixed | **P1** blocks the merge (CONFIRMED security, data loss, crash, broken contract) · **P2** before release · **P3** improvement |
| `risk` — what applying the fix can break | `high` behaviour, data or a public contract · `medium` localized logic, verifiable by tests · `low` cosmetic |
| `effort` | **S** minutes, one place · **M** a few files · **L** design change or migration |
| `status` | `todo` → **Findings**; `done` → **Already done** (fixed by a later commit in scope, a PR thread resolved **with a fix**, or this session; by-design threads are dropped) |

## Finding block — what every reviewer agent returns

`code-reviewer`, `review-security` and `review-performance` emit the same block, so a caller can merge
their reports without reading three prompts. Order: `todo` before `done`, P1 → P3, `CONFIRMED` before
`PLAUSIBLE`. A `done` block keeps title, anchor, category, status and `resolved by: <sha | thread id>`.

```text
### <n>. <one-line statement, chat language> — CONFIRMED | PLAUSIBLE
- anchor: <repo-relative/path>:<line in the working-tree file, never in the diff file>   (side: right | left)
- category: correctness | regression | security | completeness | concurrency | performance | api-contract | convention | clean-code | duplication | scope
- status: todo | done
- priority: P1 | P2 | P3            (todo only)
- risk: high | medium | low — <why, one line>   (todo only)
- effort: S | M | L — <why, one line>           (todo only)
- causedByChange: true              (optional: a defect outside the perimeter that this change causes)
- failure: <inputs/state → wrong outcome, the attack path, the cost and its scale, or the intent point with no code>
- evidence: <file:line read, blame, quoted rule or intent line; CONFIRMED quotes the failing line(s) verbatim>
- for the author: yes — "<short question, prComment language>" | no
- fix: <minimal change, or omit>
```

| Field | Meaning |
| --- | --- |
| `CONFIRMED` / `PLAUSIBLE` | failing path traced in the code, and `evidence` quotes the line(s) that fail, verbatim (a paraphrase is `PLAUSIBLE`) / depends on what the reviewer cannot see (caller, gateway, runtime config, scale) — say what would settle it |
| `anchor` | no leading slash; the line number of the **working-tree file** after the change (`right`; Read it, or `git show HEAD:<path>` for a committed range), pre-change for a deleted line (`left`); never the diff file's own line numbers — its hunk header `@@ -a,b +c,d @@` gives the start; a missing piece anchors where it belongs |
| `status: done` | only with a visible fix: a later commit in range, or a thread resolved **with a fix**; by-design is not a finding |
| `priority`, `risk`, `effort` | the values of the Fields table above, verbatim in every agent; `risk` and `effort` each end with a one-line why the reviewer writes (what breaks, how much work) |

**One defect per block — hard rule.** A title that needs "and", "also" or `(a) … (b) …` is two blocks,
each with its own anchor, priority and fix. Wrong: `### 3. null check mancante e cache mai invalidata`.
Right: `### 3. null check mancante` and `### 4. cache mai invalidata`, two blocks.

A specialist writes only its own `category` (`security` or `performance`) and ends with its verdict
line and one summary line (surface or hot paths); the generalist ends with the intent coverage.
Prose in the chat language; verbatim: `CONFIRMED`/`PLAUSIBLE`, anchors, category slugs, field values, anything
taken from the code.

## Order and tables

The mandatory skeleton — `/code-review` carries a byte-identical copy inline (the
validator compares them), and so does the `/review-pair` merger prompt; edit all together:

```text
Order: outcome line → Findings → Problems → Summary → footer (Verdict, Reply), the end. Never inside `> `
or a code fence.
Merge checklist, done by whoever writes the report (reviewer blocks are input, not output):
1. A block naming more than one defect → split it, one block per defect; renumber, keep each one's evidence.
2. Every file:line → Grep/Read the quoted code in the working tree and correct the line; note the
   corrections once in Verdict.
Findings (todo): after `---`, title `**Findings · n**` (a single one: no title, no `---`), one block each,
P1 → P3, CONFIRMED before PLAUSIBLE, clean-code last within its priority; `#F<n>` = finding number:
**#F<n> · <title>** — `file:line`
- Problem: what breaks and the scenario, one line
- Advice: the minimal fix, one line
- P1: one axis per line: `- Severity **P1** — why`, then Risk and Effort the same way
- P2, P3: one line: Severity P2: why · Risk low: why · Effort S: why
- To confirm: only a PLAUSIBLE finding (CONFIRMED writes nothing): what settles it
- Posted: only on a PR, thread or "chat only"
Problems · n (`#I`): after `---`; every Completeness gap (N points, covered N: partial, missing, wrong, scope creep) is one item, same shape.
Already done (done): rows in Findings, `#F<n> · <title>` — `file:line` — resolved by commit, thread or "session".
Summary · n: after `---`, 3+ items only, columns exactly:
| # | Item | Severity · Risk · Effort | For you |
One row per item, same order (`P1 · medium · M`, `ok F1`).
Footer: Verdict, criteria covered N of N, each agent, its model and effort (a blocked or missing worker is a gap); then
`Reply ok F3 F4 …`, the P1s and every P3 + low + S finding; apply nothing before the answer.
No findings → no sections: "nothing to report, verified: …".
```
At chat it: Findings=Rilievi, Problems=Problemi, Problem=Problema, Advice=Consiglio, To confirm=Da confermare, Severity=Gravità, Risk=Rischio, Completeness=Completezza, points=punti, covered=coperti, criteria=criteri, of=su, Already done=Già fatti, resolved by=risolto da, session=sessione, Summary=Riepilogo, Item=Voce, For you=Da te, Reply=Rispondi, Verdict=Verdetto, Posted=Postato, chat only=solo chat, high|medium|low=alto|medio|basso, "nothing to report, verified"="nulla da segnalare, verificato".

Rules around the skeleton:

- **Why lines**: `Risk` and `Effort` carry the reviewer's `risk` / `effort` why; `Severity`'s why is the
  block's `failure`, condensed. Always the word `Severity` (it: `Gravità`) before a severity code.
- Headers and section names exactly as written above (fixed kit vocabulary, English); at chat `it` the
  `At chat it:` line right after the skeleton gives the equivalents. Statements, why lines and the closing
  question in the chat language; verbatim: `file:line`, `CONFIRMED`/`PLAUSIBLE`, `P1|P2|P3`, `S|M|L`.
- A `done` finding is one line; no findings → no sections, say what was verified.
