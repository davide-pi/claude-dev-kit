---
name: plan-work
description: Writes an implementation plan file for multi-step work — concrete tasks, named files, explicit interfaces, and one verification command per task — sized to the change so a small job gets three tasks instead of a document. Use before touching code on work that spans several files, several sessions or several agents, when a spec or work item has to become an ordered list of steps, when resuming half-finished work, or when deciding whether a plan is worth writing at all.
---

# plan-work — a plan file with verifiable tasks, sized to the change

**Language.** The plan file is written in **English**, because a later session or another agent
reads it back as a technical artifact, next to the code it describes. Everything this skill says
**in chat** while producing it — the proposal, the sizing question, the confirmation — is
**Italian**.

## When

- The work spans more than a couple of files, or more than one session.
- A spec, work item or design doc has to become an ordered list of steps.
- The work will be handed to subagents and they need one shared target.
- Order matters: something must exist before something else compiles or runs.
- Returning to half-finished work whose next step is no longer obvious.

Not for: a single-file change, a spike, a bug (that is `debug-systematic` — the reproduction is the
plan), or work that will be finished before the plan is read.

## Decide

### 1. Is a plan worth writing?

| Situation | Plan? |
| --- | --- |
| One file, one behaviour, tests already exist | **no** — do it, then `done-check` |
| 2-4 files, one obvious order, one session | **no file** — say the steps in chat and go |
| A new interface between components, or 5+ files | **yes** |
| Migration plus code plus tests, where order matters | **yes** |
| Work will pause and resume, or another agent executes it | **yes** — the file is the handoff |
| Requirements still unknown | **no** — a plan over unknowns is fiction; probe first (`dev-loop`) |

### 2. Size it to the change

| Change | Tasks | Length |
| --- | --- | --- |
| bounded feature in existing code | 3-5 | under a page |
| new module or integration | 6-12 | one to two pages |
| subsystem, or a restructuring | 12-20, grouped in phases | one heading per phase |

A three-task plan is a plan. Past ~20 tasks the scope is really two plans: cut at the first point
where the system is shippable and plan the rest when you get there.

### 3. What makes a task verifiable

A task is done or not done, with no judgement call. Each one carries five fields:

| Field | Rule | Bad | Good |
| --- | --- | --- | --- |
| files | exact repo-relative paths, marked new or edit | "the service layer" | `src/Ordering/OrderService.cs` (edit) |
| change | the behaviour, one sentence | "improve validation" | "reject an order with no lines, before persisting" |
| interface | the signature or shape, whenever anything else depends on it | "add a method" | `Task<Result<OrderId>> Place(PlaceOrder cmd, CancellationToken ct)` |
| verify | one command, plus what its output must show | "make sure it works" | `dotnet test tests/Ordering.Tests --filter Place_EmptyLines_Rejects` → 1 passed |
| depends on | task numbers, or `none` | order left implied | `depends on: 2` |

No placeholders, no `TBD`, no "handle errors appropriately". A field that cannot be filled means
this is not a task yet but an open question — and open questions live in their own section at the
top of the plan, never inside a task.

### 4. Where the plan file lives

- Repo has a `docs/` tree → `docs/plans/<yyyy-MM-dd>-<slug>.md`, committed with the work: the plan
  becomes the record of why the code looks like it does.
- No `docs/` tree, or the work may be abandoned → the session scratchpad directory. Never leave a
  loose plan file in the repo root.
- One plan per branch, and it stays current: a plan that contradicts the code is worse than none.

## Do

```powershell
$slug  = 'order-validation'
$plans = Join-Path (git rev-parse --show-toplevel) 'docs/plans'
New-Item -ItemType Directory -Force -Path $plans | Out-Null
$file  = Join-Path $plans ('{0}-{1}.md' -f (Get-Date -Format 'yyyy-MM-dd'), $slug)
if (-not (Test-Path $file)) { New-Item -ItemType File -Path $file | Out-Null }
$file
```

Fill it from the template in `references/plan-template.md`. Then, while executing:

- Work in dependency order, and run each task's verify command before starting the next.
- Tick progress in the file itself (`- [x]`), so a resumed session reads state instead of guessing.
- When a task turns out wrong, edit the plan first and the code second — never diverge silently.
- Plan finished → run `done-check` over the whole change, not just over the last task.

## Traps

1. The plan reads like a design doc → prose was easier to write than tasks → a paragraph with no
   file path and no command in it belongs in open questions, or nowhere.
2. Tasks that cannot fail → "refactor for clarity", "improve error handling" → no verify command
   means no task; restate it as an observable behaviour.
3. A 15-task plan for a two-file change → planning felt productive → size from the table; the plan
   is overhead the change has to pay back.
4. The plan rots → the code diverged and the file was not touched → update the plan in the same edit
   as the divergence, or stop calling it a plan.
5. Placeholders survive into execution → `TBD: pick a library` left inside a task → decide before
   writing the task, or promote it to an open question that blocks the task.
6. Interfaces described instead of written → "add a repository method" → the next task, or the next
   agent, cannot compile against a description; write the signature.
7. A plan written for work already underway → half the tasks are already done → plan the remainder
   only, and say in the file where execution started.
8. The file written in Italian → the conversation around it was Italian → only the chat is Italian;
   the plan file, like a spec, stays English.

## References

- `references/plan-template.md` — the plan file skeleton with a worked example; read it before
  writing the first plan in a repo, or when a plan needs phases.
