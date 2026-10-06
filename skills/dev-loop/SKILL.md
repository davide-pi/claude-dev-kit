---
name: dev-loop
description: >-
  Use at the start of any substantive coding task — a vague or growing request, a work item id to
  implement, a "can we…" feasibility question, splittable work or unclear ownership — to classify
  it, route it to the owning asset and size the agreement needed first.
---

# dev-loop — classify the work, then route it

**Language.** Everything said to the user is **Italian**: the classification line, the routing
decision, the one question asked when the request is still ambiguous. Asset names and the class
labels below are identifiers — never translated.

## When

- A substantive request arrives: something has to be built, changed, investigated or made faster.
- A work item id arrives with "implement this" and nothing else.
- The ask is vague ("make the import faster"), or turns out bigger than it looked.
- "Can we…", "is it possible…": a feasibility question to answer before any real change.
- It is unclear which skill, command or agent owns the task, or whether to split it across agents.
- The work changes shape mid-flight — reclassify instead of pushing on.

Not for: attacking a design that already exists (`grill-me`), a bug or test failure (straight to
`debug-systematic`), a question answerable from the code in one read, or re-entering on every turn
once the work is routed.

## Decide

### 1. Classify — pick exactly one, then route

| Signal in the request | Class | Route |
| --- | --- | --- |
| "can we…", "is it possible…", "how hard would…" | **feasibility probe** | the spike procedure — `references/spike.md` |
| a work item id or URL to implement | **work item** | `/item` to read it, then `plan-work` (its from-work-item reference: tags + readiness verdict) |
| named symptom, stack trace, failing test, wrong output | **bug** | `debug-systematic`, always first |
| a change inside code that already exists and works | **bounded change** | the domain skill for that stack, then `done-check` |
| new module, integration, reshaped schema, or 3+ files with a new interface | **new subsystem** | `plan-work`, then the domain skills, then `done-check` |
| "is this the right way to…", a design already on the table | **design attack** | `grill-me` — the red team, not a redesign |
| N pieces with no shared state and no ordering | **parallelisable** | fan out — `references/delegation.md` |
| "commit this", "open the PR", "ship it" | **integration** | `branch-flow`, then `/commit`, then `pr-create` |

Two classes at once means two tasks: split the request and route each.

### 2. How much agreement before writing code

Approval scales with **the cost of being wrong** — not with diff size or thinking time.

| Reversible? | Blast radius | Gate before code |
| --- | --- | --- |
| yes, discarding the diff undoes it | one file, one component | **none** — do it, then verify |
| yes | several files, one bounded feature | state the approach in one line, then go |
| yes | public API, shared contract, cross-cutting pattern | agree the interface first, in two or three lines |
| **no** — data, money, external side effects, deploys | any | explicit confirmation, naming the irreversible step |

Irreversible: a migration that drops or rewrites data, a destructive database or cache command,
deleting a branch or a cloud resource, publishing or deploying, anything that sends mail or money.
Everything else is reversible, and asking permission for it is pure friction.

Escalate one row when the answer rests on a guess — no test coverage on the path, an unfamiliar
area, an unstated requirement — and name the guess.

## Do

Classification needs facts, not assumptions:

```powershell
git status --short; git branch --show-current   # dirty tree? already on a feature branch?
git log --oneline -8                            # what the last work here was
Get-ChildItem -Recurse -Depth 2 -Include *.sln,*.csproj,package.json,docker-compose*.yml |
  Select-Object -ExpandProperty FullName        # what stack this actually is
```

Then one Italian line — **class, route, gate** — before anything else:

```text
bounded change -> dotnet-backend, poi done-check; nessun gate (un solo file, reversibile)
work item      -> /item 4711, poi plan-work (verdetto di prontezza); gate: dopo il verdetto
new subsystem  -> plan-work; gate: concordare prima il contratto della coda (condiviso da due servizi)
```

That line is the whole ceremony. If it cannot be written, ask one question; do not start coding.

## Traps

1. Everything looks bounded at first → the file count is discovered while editing → when a third
   file needs a new interface, stop and switch to `plan-work`.
2. A probe silently becomes the implementation → it works, so it gets kept → probe code is never
   production code; redo it as a bounded change, with the gate (`references/spike.md`).
3. Approval theatre on trivial edits → "ask first" treated as a fixed rule → one reversible file
   never needs approval; spend that budget on the irreversible row.
4. A fix lands before a reproduction → the cause looked obvious → `debug-systematic` first.
5. "Is this design right?" answered with a redesign → that question wants attack: `grill-me`.
6. A work item implemented straight from its title → nobody judged readiness → `/item`, then the
   `plan-work` verdict; an untagged assumption is a guess.
7. Work fanned out that was sequential → the independence test was skipped →
   `references/delegation.md` first.
8. Reclassifying every turn → classify once per task; only a real change of shape earns a second pass.

## References

- `references/spike.md` — a feasibility probe: the testable claim, the cheapest instrument, the
  timebox, the Italian report shape, and the guardrails that keep it throwaway.
- `references/delegation.md` — before any fan-out to subagents: the independence test, the output
  contract every agent returns, and what is never delegated.
