# Unknowns, questions, and the implementability verdict

## What counts as an unknown

An unknown is a gap that **changes the code depending on how it resolves**. That test is the whole
filter, and it cuts both ways: something you are unsure about but which produces the same code
either way is not an unknown, and something you feel confident about but never saw written down is.

| Kind | Example shape | Who can answer |
| --- | --- | --- |
| Undefined behaviour | what happens on an empty result, a duplicate, a concurrent edit | the requester |
| Undecided rule | which rounding, which timezone, which precedence between two rules | the requester |
| External contract | the shape a third party returns, the field that is optional | a document, or the other side |
| Missing decision | which of two components owns the change | the team |
| Stale evidence | a mock that no longer matches the UI, a criterion written against an old flow | the requester |
| Absent code | the item assumes a service, table or endpoint that does not exist | you, from the investigation |
| Non-functional silence | expected volume, latency, retention, who may see it | the requester |

The last row is the one most often skipped and most expensive to discover late: an item that says
"export the report" and nothing about volume is two different implementations.

## Turning a gap into a question worth someone's time

A good question is answerable in one line by the person you are asking, and its answer visibly
changes the plan. Four properties:

1. **Closed where it can be.** Offer the options. "Should a duplicate import row be skipped or should
   the whole file be rejected?" beats "how should duplicates be handled?".
2. **Carrying your recommendation.** Name the option you would take and why. A question with a
   default gets a yes; an open one gets postponed.
3. **Stating the consequence.** One clause on what changes either way. That is what makes someone
   answer today instead of next week.
4. **Blocking or not, explicitly.** Say whether work can start without it.

Cap it at three questions. Beyond three, either the item is not ready — say that instead — or some
of the questions are not real unknowns and you should decide them yourself, tag them **A** and note
the decision in the plan.

```text
1. [BLOCKING] Duplicate rows in the import: skip them, or reject the file?
   Recommendation: skip and report, so a 5000-row file is not lost to one bad row.
   Either answer changes the parser's error path and the criteria QA will test.
2. [non-blocking] Does the export need the archived records too?
   Recommendation: no — the current screen excludes them, so keep it consistent.
```

## Assumptions that stay assumptions

Not every gap deserves a question. A gap you resolved yourself becomes a line in the plan's
assumptions list, tagged **A**, with the choice made and the reason. It stays visible so that
whoever reads the plan can contradict it cheaply — which is the whole point.

The rule: **an A that affects observable behaviour becomes a question; an A that affects only the
implementation stays an assumption.** Which library, which folder, which internal name — yours.
What the user sees, what the API returns, what gets written to the database — theirs.

## The implementability rubric, in detail

Run it in order and stop at the first row that fires.

| # | Test | If it fires |
| - | --- | --- |
| 1 | Is the item live? (state, assignee, no live duplicate) | say so and stop; nothing else matters |
| 2 | Is it a symptom report with no reproduction? | `debug-systematic` first, then re-analyse |
| 3 | Does it have children? | it is a container — work a child, or propose a split |
| 4 | Is there a criterion, and can someone test it without asking you what it means? | **not ready** — propose criteria, get them confirmed |
| 5 | Is there an unresolved blocking dependency, or an A on observable behaviour? | **blocked** — questions first, no editor |
| 6 | Are there several independent deliverables in one item? | **needs splitting** — apply the split test below |
| 7 | Do three or more files need a new interface between them, or is there a new module, integration or schema change? | **needs a plan** — attack plan, then `plan-work` |
| 8 | Otherwise | **implementable** — attack plan, the domain skill, `done-check` |

Rows 4 and 5 are the ones worth defending against pressure. An item with untestable criteria will be
argued about at review time instead, which costs more.

## The split test

An item needs splitting when **any** of these holds:

- Two deliverables could ship on different days and each be useful alone.
- Two deliverables would be reviewed by different people, or land in different repositories.
- The acceptance criteria fall into groups with no overlap.
- One part is blocked and another is not — splitting unblocks the second half today.
- It is an epic or a feature: those are containers by definition and never worked directly.

It does **not** need splitting merely because it is large. A single coherent change across eight
files is one item with a plan, not four items. Splitting a coherent change creates items that cannot
be tested independently, which is worse than one big one.

When the verdict is a split, produce the proposal — type, title and one-line scope per proposed item,
plus which existing item is the parent — and hand it to `workitem-create`. Nothing here creates,
edits or comments on anything: the split is a proposal until someone confirms it.

## Re-analysis

An analysis is a file, not a conversation. When the item changes, a question gets answered, or the
investigation contradicts the plan:

- Update the plan in place, and note in one line what changed and why.
- Re-run the verdict, because an answered blocking question routinely moves an item from **blocked**
  to **implementable** — or reveals the split nobody saw.
- Do not re-read everything. Step 3 of the read pass, the discussion, is where new information
  arrives; the rest rarely moves.
