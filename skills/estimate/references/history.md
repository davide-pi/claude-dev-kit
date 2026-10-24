# The team's recent history — phase 4

## 1. Before the script: types, never assumed

Type names come from the project's process (`azdo-cli` `work-item-roles.md`). Discover them, map the
three roles, and pass the names to `candidates.ps1`:

| Role | Typical names | Parameter |
| --- | --- | --- |
| grouping | `Feature` | `-FeatureType` (`''` when the process has none: no top-down, no inherited exclusion) |
| backlog item — the unit of work read | `Product Backlog Item`, `User Story`, `Issue` (Basic) | `-BacklogType`, several as `'A,B'` |
| time — the only type with hours | `Task` | `-TaskType` |

```powershell
az devops invoke --org $org --area wit --resource workItemTypes `
  --route-parameters project=$proj --query "value[].name" -o tsv
```

A role with no type in the project → say so and ask; never substitute the closest name.

## 2. What `candidates.ps1` fetches

Read-only, CLI only. Every WIQL repeats `[System.TeamProject] = '<project>'`. **Every** completed
backlog item of the last **3 months** — not a search for similar ones: the whole recent output of
the team is the evidence.

| Step | Rule |
| --- | --- |
| States | the type's states in the **Completed** category (`workItemTypeStates`); `Removed` never |
| Window | `Microsoft.VSTS.Common.ClosedDate` in the last 3 months; `System.ChangedDate` when the process lacks it — the summary warns |
| Exclusion | `estimation-excluded` filtered in the WIQL, counted by a complementary query, re-checked after the walk: on the Feature → all its items; on the item → the item; on a Task → only that Task |
| Tasks | children of the items, `Removed` dropped; an open Task with no `CompletedWork` dropped |
| Hours | per Task `CompletedWork`, else `OriginalEstimate` × the error factor (assignee's with ≥ 5 pairs, else overall, else 1.0; clamped 0.5-2.0); an item with no hours → `discarded` |
| Owner | the Task assignee holding more than half of the item's hours; otherwise none |
| Features | parents of the items; a completed Feature carries its **full** hours, every child included |
| Outliers | marked, not removed: team 10% lowest and 10% highest by hours (from 10 items), person 5% + 5% (from 20 items) |

## 3. The index — the file to read whole

`candidates.index.md`, one line per item:

```text
<id> | <age band> | <owner> | <hours>h (<share> cons.) | <outlier> | <area> | <tags> | <title> | tasks <n>: <titles>
```

| Field | Use |
| --- | --- |
| header | window, item count, team median and P25-P75 without outliers, the person's median — the first calibration |
| age band | more recent work reflects the current team and code: prefer it when two references compete |
| owner | the personal basis (`references/deduction.md` §3) |
| `cons.` share | how much of the hours are actuals; a reference at 0% cons. is an estimate, weigh it less |
| outlier | never a reference (`SKILL.md` rule) |
| Task titles | the structure of the work: what was built, tested, deployed — the basis of compreso / NON compreso |
| `## Features` | completed Features with total hours, for the top-down check |

`candidates.json` holds the same data plus descriptions and per-Task numbers: open it for an item
whose title is not enough.

## 4. Too little history

| Situation | Move |
| --- | --- |
| Fewer than 10 items in 3 months | rerun with `-Months 6` and say so in the report |
| Still fewer than 10 | proceed; the approximation gets the thin-history share (`references/deduction.md` §4) |
| No item at all (new project, empty board) | the estimate is a declared judgement throughout, at the scarce cap |
