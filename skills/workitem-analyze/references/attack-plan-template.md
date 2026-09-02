# The attack plan — shape, length, and a worked example

## What it is for

One artefact that lets someone — you tomorrow, or a reviewer today — see what the item really
involves without re-reading it. It is short on purpose: a page, not a design document. If the plan
grows past a page the verdict was probably **needs a plan**, and `plan-work` owns the rest.

Write it to a file so it survives the session. A plan that lives only in chat gets re-derived from
scratch after the next comment.

## The shape

```markdown
# <id> <title> — attack plan

**Verdict:** implementable | needs a plan | needs splitting | blocked | not ready
**Type / state / iteration:** <type> · <state> · <iteration>
**Parent:** <id> <title>

## What the item asks for
- [S] "<quoted criterion or requirement>"
- [S] "<quoted criterion>"  — superseded by the discussion of <date>: <what was decided instead>

## What the code looks like today
- [D] <behaviour> is decided in `<path>:<line>`
- [D] <caller> reaches it through `<path>:<line>`
- [D] no <thing the item assumes> exists — searched <where>

## Changes, by place
| # | Where | Change | Why |
| - | --- | --- | --- |
| 1 | `<path>` | <what changes> | [S] <criterion> |
| 2 | `<path>` | <what changes> | [D] <call site that forces it> |
| 3 | <tests> | <what is covered> | the criteria above |

## Out of scope
- <thing a reader would assume is included, and is not> — owned by <item / nobody yet>
- <thing the parent covers but this item does not>

## Assumptions
- [A] <decision made, and why> — implementation-only, reversible

## Questions that must be answered first
1. [BLOCKING] <closed question>  Recommendation: <option>. Consequence: <what changes>.
2. [non-blocking] <closed question>  Recommendation: <option>.

## Route
<the next asset: the domain skill, `plan-work`, `workitem-create`, or nothing until Q1 is answered>
```

## The rules that make it useful

| Section | Rule |
| --- | --- |
| Verdict | first line, always. It is the thing a reader needs in five seconds. |
| What the item asks for | quoted, tagged **S**, and it names where a discussion overrode the description |
| Code today | every line has a `file:line`, or it is not a **D** and does not belong here |
| Changes by place | one row per place, and each row's "why" points at an S or a D — never at a feeling |
| Out of scope | never empty. An empty exclusion list means the boundary was never drawn. |
| Assumptions | only implementation-level ones survive here; anything observable is a question |
| Questions | at most three, closed, each with a recommendation, blocking ones first |
| Route | exactly one next step, named |

Two things the plan never contains: an estimate in hours, and code. An estimate belongs to whoever
commits to the sprint, and code belongs after the verdict.

## Worked example

```markdown
# 4711 Export the invoice list to CSV — attack plan

**Verdict:** implementable
**Type / state / iteration:** User Story · New · Sprint 42
**Parent:** 4690 Invoice management

## What the item asks for
- [S] "A user viewing the invoice list can download the same rows as a CSV file."
- [S] "The export respects the filters currently applied on screen."
- [S] "The file name contains the export date."
- Discussion, 3 comments in: the separator must be a semicolon, because the finance team opens the
  file in a locale where the comma is the decimal mark. Not in the description.

## What the code looks like today
- [D] The list is served by `InvoiceQueryHandler.Handle` in `src/Api/Invoices/InvoiceQueryHandler.cs:34`,
  which already takes the filter object the screen sends.
- [D] Paging is applied in the same method at `:58` — the export must bypass it, not reuse it.
- [D] `src/Web/src/pages/Invoices/InvoiceList.tsx:120` holds the filter state the export needs.
- [D] No CSV writer exists anywhere in the solution; searched `src/Api` and `src/Shared`.

## Changes, by place
| # | Where | Change | Why |
| - | --- | --- | --- |
| 1 | `src/Api/Invoices/` | an export endpoint taking the same filter object, unpaged, streaming | [S] same rows, same filters |
| 2 | `src/Api/Invoices/` | a CSV writer: semicolon separator, invariant number and date formats | discussion decision |
| 3 | `src/Web/src/pages/Invoices/InvoiceList.tsx` | a download action passing the current filter state | [D] filter state lives here |
| 4 | tests | filter equivalence against the list endpoint, separator, empty result | the criteria above |

## Out of scope
- Excel (`.xlsx`) output — the item says CSV; nobody owns xlsx yet.
- Scheduled or e-mailed exports — the parent mentions them, this item does not.
- Changing the list endpoint's own paging — item 1 adds a path, it does not alter the existing one.

## Assumptions
- [A] The export streams rather than buffering, because the filter can match the whole table.
  Implementation-only and reversible.

## Questions that must be answered first
1. [non-blocking] Does the export include the columns hidden on screen, or only the visible ones?
   Recommendation: only the visible ones, matching "the same rows as on screen".
   Consequence: changes the projection, not the shape of the work.

## Route
`dotnet-backend` for items 1 and 2, `react` for item 3, `dotnet-testing` for item 4, then `done-check`.
```

Note what the example does: it quotes, it cites lines, it says out loud that the discussion beat the
description, it excludes three things a reader would have assumed, and it asks one question rather
than five. That is the standard — and it fits on a page.
