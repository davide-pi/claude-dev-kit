---
name: estimate
description: >-
  Estimate the hours a piece of work will take, from the request and the team's recent completed
  work on Azure DevOps. Explicit trigger: only when the user types /estimate.
disable-model-invocation: true
---

# estimate — hours for new work, deduced from the team's recent history

**Language.** This skill's prose is English. Everything the user reads — the sufficiency verdict,
the questions for the PO, the market checklist, the estimate tables, the reasoning, the "compreso /
NON compreso" summary, an optional comment on the work item — is **Italian**. Verbatim: `AB#<id>`,
type, state and field names, WIQL, script output.

## When

- The user types `/estimate`, with a work item id, a pasted request, a file, or a mix.
- Optional words in the invocation: a person ("per <nome>", a UPN) → personal basis; "analisi di
  mercato" / "market" → the market pass; "commenta" → also post the result on the work item;
  "<n>h/giorno" → hours per day (default 8).
- The input can be one small API or a whole new project, fully specified or close to empty.

Not for: writing or splitting the items themselves (`user-story-standard`, `workitem-create`);
judging whether an item is ready to build, or ordering its steps (`plan-work`); logging hours
(`worklog`). Never fires without the explicit trigger.

## Decide

### 1. Sufficiency gates everything

The request comes from a PO, not a developer: judge it on functional points only, and weigh first
whether code already exists for it — technical gaps are filled from the code or stated as
assumptions, never held against the PO. The checklist in `references/sufficiency.md` seeds the
verdict; judgement on top decides it.

| Level | Number given | Margin cap | Then |
| --- | --- | --- | --- |
| **Sufficiente** | yes | **≤ +20%** | estimate |
| **Scarso** | yes, declared imprecise | **≤ +40%** | estimate, list what is missing, suggest the market pass |
| **Insufficiente** | **no** — at most an order of magnitude (giorni / settimane / mesi), never hours | — | questions for the PO, ranked by how much uncertainty each removes; suggest the market pass |

The shape of every number: `50h – 60h (+20%) · 6,5 – 7,5 giorni` — central value, prudent value,
declared approximation, the total also in days. The margin is **built**, not picked
(`references/deduction.md` §4); above the cap the report says so instead of hiding it.

### 2. The pipeline

| Phase | What | Owner |
| --- | --- | --- |
| 1. Input | read the item or the text; resolve org and project from the working directory (`azdo-cli` decision 1), else ask | model |
| 2. Sufficiency | code check (`Explore`, sonnet) when a repository is at hand, then the level; insufficient → stop after the questions | `references/sufficiency.md` |
| 3. Market (opt-in) | only when asked; suggested when scarce or insufficient; a feature checklist, never hours | `references/sufficiency.md` |
| 4. History | `candidates.ps1`: **every** completed item of the last 3 months, with hours, owner, outliers marked | `references/history.md` |
| 5. Deduction | read the whole index, calibrate on it, decompose the request, size each component against the recent work it resembles in structure | `references/deduction.md` |
| 6. Report | the tables, the references cited, the approximation and its sources, compreso / NON compreso | `references/output.md` |

### 3. Fixed rules

| Rule | Detail |
| --- | --- |
| **`estimation-excluded`** | an item tagged so is dropped at once, in the WIQL and again after the walk; inherited Feature → backlog item → Task |
| Outliers never anchor | items marked `outlier` (10% per side on the team, 5% on the person) are read for context, never used as a reference |
| Every number has a reference | each component cites the recent items it was sized against (`AB#<id>`, their hours, the relation); a component with nothing comparable is a declared judgement |
| Sums with a command | totals, days and percentages computed with a one-line PowerShell expression, never in the head |
| Personal or team | a named person → their own items first (owner = more than half of the hours); fewer than 5 → the team's, **+5%** |
| One org, one project | CLI first; MCP only where `azdo-cli` `mcp-fallback.md` lists a gap, said once in chat |
| Read-only | the only writes: the history record, and the optional comment after the user confirms its text |

## Do

```powershell
$org = 'https://dev.azure.com/<org>'; $proj = '<project>'      # resolved from the path, never the default
# Type names are discovered (azdo-cli work-item-roles.md), then passed in; several as 'A,B'.
$dir = Join-Path $env:TEMP "estimate-$(Get-Date -f yyyyMMdd-HHmmss)"; New-Item -ItemType Directory $dir | Out-Null
pwsh -NoProfile -File "$HOME\.claude\skills\estimate\candidates.ps1" -Org $org -Project $proj `
  -BacklogType '<backlog type>' -TaskType '<task type>' -FeatureType '<feature type>' `
  -Person '<upn or omit>' -OutFile "$dir\candidates.json"      # also writes candidates.index.md
# Calibration, read-only: past estimates against the hours actually logged since.
pwsh -NoProfile -File "$HOME\.claude\skills\estimate\calibrate.ps1" -HistoryDir "$HOME\.claude\estimate\history"
```

Read `candidates.index.md` whole — it is the evidence; open `candidates.json` for a description or
a Task breakdown. After the report, write the history record (`references/output.md` §5).

## Traps

1. **A number for an insufficient request** — the user pressed for one → give the order of
   magnitude and the questions; an hour figure here is a guess wearing a decimal.
2. **Gut feeling dressed as deduction** — a component's hours cite no recent item → find the work
   it resembles in structure, or label the row **stima a giudizio** with its reason.
3. **A whole project sized as one item** — no decomposition → decompose into backlog-item-sized
   components first; Features in the index are the top-down cross-check.
4. **Anchoring on an outlier** — the closest-looking item is marked `outlier` → it was cut on
   purpose; use the next one, mention the outlier as context only.
5. **Excluded work leaking in** — the tag sat on the Feature → exclusion is inherited; the script
   re-checks after the walk.
6. **Analogs from the wrong customer** — the `az devops` default org was used → pass `--org` / `-p`.
7. **A tidy +20% over evidence that disagrees** — the references for one component spread wide →
   the margin is built from that spread; above the cap, say so.
8. **"Compreso" taken from habit** — test or deploy assumed included → read the Task titles of the
   references; what they do not show is NON compreso or `non rilevato`.
9. **Arithmetic in the head** — a total or a day count drifts → compute it with a command.

## References

- `references/sufficiency.md` — phases 2-3: who wrote the request, the code check, the checklist,
  the three levels, questions for the PO, the market pass.
- `references/history.md` — phase 4: types and states, what `candidates.ps1` fetches, exclusions,
  outliers, the index format.
- `references/deduction.md` — phase 5: calibrating on recent work, decomposing, sizing each
  component, personal or team basis, building the approximation.
- `references/output.md` — phase 6: the report shape, citations, compreso / NON compreso, the
  history record, the optional comment.
