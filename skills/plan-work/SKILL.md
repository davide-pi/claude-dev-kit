---
name: plan-work
description: >-
  Use when work spans several files or sessions, a work item needs steps, half-done work resumes,
  or subagents fan out: "pianifica", "riprendi il lavoro".
---

# plan-work — a plan file with verifiable tasks, sized to the change

**Contract.** A plan file of verifiable tasks, a spike's answer, or delegation briefs · never writes
production code, never promotes spike code · plan file English, everything said in chat in the chat language.

## When

Not for: a single-file change; a bug (`debug-systematic` — the reproduction is the plan).

## Decide

### 1. Is a plan worth writing?

| Situation | Plan? |
| --- | --- |
| one file, one behaviour, tests exist | **no** — do it, verify (`references/evidence-by-stack.md`) |
| 2–4 files, one obvious order, one session | **no file** — the steps in chat, then go |
| a new interface between components, or 5+ files | **yes** |
| migration + code + tests where order matters | **yes** |
| work will pause, or another agent executes it | **yes** — the file is the handoff |
| requirements unknown | **no** — probe first (§5) |
| it starts from a work item | the `azdo-cli` item read, then the readiness verdict (`references/from-work-item.md`) |

### 2. Size it to the change

| Change | Tasks | Length |
| --- | --- | --- |
| bounded feature in existing code | 3–5 | under a page |
| new module or integration | 6–12 | one to two pages |
| subsystem or restructuring | 12–20, in phases | a heading per phase |

Past ~20 tasks it is two plans; the first slice is the 20 % of work worth 80 % of the value, the rest optional.

### 3. A verifiable task — five fields, no judgement call

| Field | Rule | Good |
| --- | --- | --- |
| files | exact repo-relative paths, new or edit | `src/Ordering/OrderService.cs` (edit) |
| change | the behaviour, one sentence | "reject an order with no lines, before persisting" |
| interface | the signature, whenever anything depends on it | `Task<Result<OrderId>> Place(PlaceOrder cmd, CancellationToken ct)` |
| verify | one command, seen failing once, and what its output must show | `dotnet test tests/Ordering.Tests --filter Place_EmptyLines_Rejects` → 1 passed |
| depends on | task numbers, or `none` | `depends on: 2` |

No `TBD`, no "handle errors appropriately". A field that cannot be filled is an **open question**,
listed at the top of the plan, never inside a task.

### 4. Where the file lives

Repo with `docs/` → `docs/plans/<yyyy-MM-dd>-<slug>.md`, kept out of git through `.git/info/exclude` (Do).
No `docs/`, or the work may be abandoned → the session scratchpad. One plan per branch, kept current.

### 5. Spike — answer one question, leave nothing behind

One testable claim, the cheapest instrument, a timebox said out loud, scratch code outside the repo:
the procedure, instruments and report are in `references/spike.md`, read before the probe.

### 6. Delegation — when and how to brief

| Fan out only if all are "no" | If yes |
| --- | --- |
| two tasks write the same file? | serialise, or one worktree per agent (`branch-flow`) |
| one task's output decides another's approach? | sequential |
| they must agree on an interface not yet written? | write it first |
| a task needs the conversation to be judged? | keep it here |

Never delegate: irreversible commands, deciding *what* to build, integration, the final review and
evidence check. The brief's fields and the output contract: `references/delegation.md`.

## Do

Create the file with the script in `references/plan-template.md` (it keeps `docs/plans/` out of git) and
fill it from that skeleton (a multi-session plan ends with its `/goal` line). While executing: dependency order;
each task's verify before the next; tick `- [x]`; a wrong task → edit the plan first, the code second. Finished → verify the whole change, not the last task (`references/evidence-by-stack.md`).

## Traps

1. Tasks that cannot fail ("refactor for clarity") → no verify command → restate as an observable behaviour, or drop it.
2. The plan rots → code diverged, file untouched → update it in the same edit as the divergence.
3. A subagent report floods the context → the brief had no output cap → cap it, ask for the table.

## References

- `references/from-work-item.md` — the work starts from an item: S/D/A tags, the readiness verdict,
  the questions worth asking, the split test.
- `references/plan-template.md` — writing any plan file: the creation script, skeleton, example, the closing `/goal` line.
- `references/spike.md` — a feasibility probe: instruments, the report in the chat language, the guardrails.
- `references/delegation.md` — before a fan-out: sizing waves, the pasted output contract, the
  correction round.
- `references/evidence-by-stack.md` — before calling anything done: the three states, evidence per
  change type and per stack.
