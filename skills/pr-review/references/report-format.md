# Review report format — the summary tables go last

Shared by `/pr-review`, `/code-review`, the built-in `/review` and `/security-review`, ad-hoc
reviews and merged runs. The user reads the table first, then scrolls up to the rows that matter,
so every report **ends** with the summary tables, after all the detail.

## Who reviews, on which model

| Request | Agents |
| --- | --- |
| any review (`/pr-review`, `/code-review`, an ad-hoc "review this") | `code-reviewer` subagent, never inline — a review command loaded into the main thread delegates too |
| effort `high` or above | also `review-security` and `review-performance`, in parallel, one message, merged |
| "security review" / "performance review" | that specialist alone |
| the built-in `/security-review` | only when the user names it; its output stays separate (different format) |

`model` for **every** review subagent: nothing said → omit it (agent frontmatter); "advanced"
agents → the current session family explicitly (opus | sonnet | haiku | fable); "agent {model}" →
that exact model.

## Fields (emitted by the agents, values verbatim)

| Field | Values |
| --- | --- |
| `priority` — impact if not fixed | **P1** blocks the merge (CONFIRMED security, data loss, crash, broken contract) · **P2** before release · **P3** improvement |
| `risk` — what applying the fix can break | `alto` behaviour, data or a public contract · `medio` localized logic, verifiable by tests · `basso` cosmetic |
| `effort` | **S** minutes, one place · **M** a few files · **L** design change or migration |
| `status` | `todo` → **Da fare**; `done` → **Già fatti** (fixed by a later commit in scope, a PR thread resolved **with a fix**, or this session; by-design threads are dropped) |

## Order and tables

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
