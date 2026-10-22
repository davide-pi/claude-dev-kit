# Review report format — the summary tables go last

Shared by `/pr-review`, `/code-review`, the built-in `/review` and `/security-review`, ad-hoc
reviews and merged runs. The user reads the table first, then scrolls up to the rows that matter,
so every report **ends** with the summary tables, after all the detail.

## Who reviews, on which model

| Request | Agents, spawned in one message |
| --- | --- |
| any review (`/pr-review`, `/code-review`, an ad-hoc "review this"), effort `low` / `medium` | `code-reviewer` subagent, never inline |
| effort `high` or above | `code-reviewer` ×2 with the **same brief** — reviewer A and reviewer B on two different models — plus `review-security` and `review-performance`; merged |
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

A diff too large for one reviewer (30+ files) → offer the saved workflow `/review-large` (one
reviewer per group of files, at most 8, same ladder, one merger) and wait for the user's yes; never launch it unasked.

## Fields (emitted by the agents, values verbatim)

| Field | Values |
| --- | --- |
| `priority` — impact if not fixed | **P1** blocks the merge (CONFIRMED security, data loss, crash, broken contract) · **P2** before release · **P3** improvement |
| `risk` — what applying the fix can break | `alto` behaviour, data or a public contract · `medio` localized logic, verifiable by tests · `basso` cosmetic |
| `effort` | **S** minutes, one place · **M** a few files · **L** design change or migration |
| `status` | `todo` → **Da fare**; `done` → **Già fatti** (fixed by a later commit in scope, a PR thread resolved **with a fix**, or this session; by-design threads are dropped) |

## Finding block — what every reviewer agent returns

`code-reviewer`, `review-security` and `review-performance` emit the same block, so a caller can merge
their reports without reading three prompts. Order: `todo` before `done`, P1 → P3, `CONFIRMED` before
`PLAUSIBLE`. A `done` block keeps title, anchor, category, status and `resolved by: <sha | thread id>`.

```text
### <n>. <one-line statement, Italian> — CONFIRMED | PLAUSIBLE
- anchor: <repo-relative/path>:<line in the working-tree file, never in the diff file>   (side: right | left)
- category: correctness | regression | security | completeness | concurrency | performance | api-contract | convention | clean-code
- status: todo | done
- priority: P1 | P2 | P3            (todo only)
- risk: alto | medio | basso        (todo only)
- effort: S | M | L                 (todo only)
- failure: <inputs/state → wrong outcome, the attack path, the cost and its scale, or the intent point with no code>
- evidence: <file:line read, blame, quoted rule or intent line; CONFIRMED quotes the failing line(s) verbatim>
- for the author: yes — "<short Italian question>" | no
- fix: <minimal change, or omit>
```

| Field | Meaning |
| --- | --- |
| `CONFIRMED` / `PLAUSIBLE` | failing path traced in the code, and `evidence` quotes the line(s) that fail, verbatim (a paraphrase is `PLAUSIBLE`) / depends on what the reviewer cannot see (caller, gateway, runtime config, scale) — say what would settle it |
| `anchor` | no leading slash; the line number of the **working-tree file** after the change (`right`; Read it, or `git show HEAD:<path>` for a committed range), pre-change for a deleted line (`left`); never the diff file's own line numbers — its hunk header `@@ -a,b +c,d @@` gives the start; a missing piece anchors where it belongs |
| `status: done` | only with a visible fix: a later commit in range, or a thread resolved **with a fix**; by-design is not a finding |
| `priority`, `risk`, `effort` | the values of the Fields table above, verbatim in every agent |

**One defect per block — hard rule.** A title that needs "and", "also" or `(a) … (b) …` is two blocks,
each with its own anchor, priority and fix. Wrong: `### 3. null check mancante e cache mai invalidata`.
Right: `### 3. null check mancante` and `### 4. cache mai invalidata`, two blocks.

A specialist writes only its own `category` (`security` or `performance`) and ends with its verdict
line and one summary line (surface or hot paths); the generalist ends with the intent coverage.
Prose in Italian; verbatim: `CONFIRMED`/`PLAUSIBLE`, anchors, category slugs, field values, anything
taken from the code.

## Order and tables

The mandatory skeleton — `/code-review` and `/pr-review` carry a byte-identical copy inline (the
validator compares them), and so does the `/review-large` merger prompt; edit all together:

```text
Order: Rilievi → Completezza → Da fare → Già fatti → Fix rapidi → Verdetto. Tables last; after
Verdetto at most one short question.
Merge checklist, done by whoever writes the report (reviewer blocks are input, not output):
1. A block naming more than one defect → split it, one block per defect; renumber, keep each one's evidence.
2. Every file:line → Grep/Read the quoted code in the working tree and correct the line; note the
   corrections once in Verdetto.
Rilievi: a full block per P1/P2 todo (what breaks, scenario, file:line, minimal fix), one defect per
block; the P3s under one "Miglioramenti" block, one line each.
Completezza: N punti — coperti N, then each partial, missing or wrong point, and scope creep.
Da fare (status: todo), columns exactly:
| # | Priorità | Categoria | Posizione | Rilievo | Verdetto | Rischio | Sforzo |
Già fatti (status: done, one line each), columns exactly:
| # | Categoria | Posizione | Rilievo | Risolto da |
Sort: P1 → P3, CONFIRMED before PLAUSIBLE, clean-code last within its priority; rows keep the finding
numbers; every finding gets a row. Posizione = file:line, Rilievo ~80 chars, Risolto da = commit,
thread or "sessione". Findings posted on a PR add a "Postato" column to both tables.
Fix rapidi: #n, #n — every P3 + basso + S finding, one "ok" applies them.
Verdetto: one line naming each agent, its model and effort; a blocked or missing worker is a gap.
No findings → no tables: "nulla da segnalare, verificato: …".
```

The same rules, in full:

0. **Blocks, top to bottom**: **Rilievi** (the findings that matter first: a full block per P1 and
   P2 `todo` — what breaks, the scenario, `file:line`, the minimal fix; the P3s grouped under one
   `Miglioramenti` block, one line each; `done` one line) · **Completezza** (`N punti — coperti N`, each
   partial, missing or wrong point, scope creep) · the tables · `Verdetto` naming each agent that
   ran, its model and effort, and any worker that was blocked or missing (a gap, never a pass).

1. **Sort**: P1 → P3, `CONFIRMED` before `PLAUSIBLE`, `clean-code` last within its priority. Rows
   keep the findings' numbers (`#3` = block `3.`). A `done` finding is one line.
2. **Da fare** columns: `#`, `Priorità`, `Categoria`, `Posizione` (`file:line`), `Rilievo` (~80
   chars), `Verdetto`, `Rischio`, `Sforzo`.
3. **Già fatti** columns: `#`, `Categoria`, `Posizione`, `Rilievo`, `Risolto da` (commit, thread,
   "sessione"). Add `Postato` to both when findings went onto a PR.
4. **Fix rapidi**: one line with the `#` of every P3 + `basso` + `S` finding, approvable with one "ok".
5. Every finding gets a row. After the tables: at most a one-line verdict and one short question.
6. No findings → no table; say what was verified.
7. Italian headers and statements; verbatim: `file:line`, `CONFIRMED`/`PLAUSIBLE`, category slugs,
   `P1|P2|P3`, `S|M|L`.
