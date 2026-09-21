---
name: dev-loop
description: Entry point and router for development work. Classifies a request (feasibility probe, bounded change in existing code, new subsystem, bug, design question, parallelisable work) and routes it to the skill, command or agent that owns it, then sizes how much agreement is needed before code gets written. Use at the start of any substantive coding task, when a request is vague or larger than it first looks, when it is unclear which asset owns the task, or when deciding whether a design conversation is worth the friction.
---

# dev-loop — classify the work, then route it

**Language.** Everything this skill says to the user is written in **Italian**: the one-line
classification statement, the routing decision, and the single question it asks when the request is
still ambiguous. The asset names inside that line (`dotnet-backend`, `done-check`, `/ship`) and the
class labels from the table below are identifiers — they are never translated.

## When

- A substantive request arrives: something has to be built, changed, investigated or made faster.
- The ask is vague ("make the import faster") or turns out bigger than it looked.
- It is unclear which skill, command or agent owns the task.
- Code is about to be written and nobody has decided whether the design needs agreeing first.
- The work changes shape mid-flight — reclassify instead of pushing on.

Not for: attacking a design that already exists (`grill-me`), a bug or test failure (straight to
`debug-systematic`), a question answerable from the code in one read, or re-entering on every turn
once the work is routed.

## Decide

### 1. Classify — pick exactly one

| Signal in the request | Class | Cheapest correct move |
| --- | --- | --- |
| "can we…", "is it possible…", "how hard would…" | **feasibility probe** | smallest experiment that answers yes/no, then delete it |
| named symptom, stack trace, failing test, wrong output | **bug** | reproduce first, never patch first |
| a change inside code that already exists and already works | **bounded change** | edit, verify, done |
| new module, new integration, reshaped schema, or 3+ files with a new interface between them | **new subsystem** | plan first |
| "is this the right way to…", a design already on the table | **design attack** | red-team it, do not redesign it |
| N pieces with no shared state and no ordering between them | **parallelisable** | fan out |
| "commit this", "open the PR", "ship it" | **integration** | branch, gate, ship |

Two classes at once means the request is really two tasks: split it and route each.

### 2. Route

| Class | Route |
| --- | --- |
| feasibility probe | the spike lane below, or `/spike` |
| bounded change | the domain skill for that stack, then `done-check` |
| new subsystem | `plan-work`, then the domain skills, then `done-check` |
| bug | `debug-systematic`, always first |
| design attack | `grill-me` — the red team, not a redesign |
| parallelisable | `delegate-agents` |
| integration | `branch-flow`, then `/ship` or `/commit` |

### 3. The spike lane

A probe answers one question and leaves nothing behind. Timebox it, pick the cheapest instrument
(`csharprepl` over a scratch project, one `sqlcmd` query over a repository method, a raw HTTP call
over a typed client), write the answer down, throw the code away. A probe that grows tests, config
or a README stopped being a probe: reclassify it as a bounded change or a subsystem.

### 4. How much agreement before writing code

Approval scales with **the cost of being wrong** — not with the size of the diff, and not with how
long the thinking took. Two axes:

| Reversible? | Blast radius | Gate before code |
| --- | --- | --- |
| yes, discarding the diff undoes it | one file, one component | **none** — do it, then verify |
| yes | several files, one bounded feature | state the approach in one line, then go |
| yes | public API, shared contract, cross-cutting pattern | agree the interface first, in two or three lines |
| **no** — data, money, external side effects, deploys | any | explicit confirmation, naming the irreversible step |

Irreversible means: a migration that drops or rewrites data, a destructive database or cache
command, deleting a branch or a cloud resource, publishing or deploying, anything that sends mail or
money. Everything else is reversible by definition, and asking permission for it is pure friction —
friction spent there is not spent on the row that actually matters.

Escalate one row when the answer rests on a guess: no test coverage on the path being touched, an
unfamiliar area, an unstated requirement. Name the guess when escalating.

## Do

Classification needs facts, not assumptions. Three commands, a few seconds:

```powershell
git status --short; git branch --show-current   # dirty tree? already on a feature branch?
git log --oneline -8                            # what the last work here was
Get-ChildItem -Recurse -Depth 2 -Include *.sln,*.csproj,package.json,docker-compose*.yml |
  Select-Object -ExpandProperty FullName        # what stack this actually is
```

Then say one line — **class, route, gate** — before doing anything else, in Italian:

```text
bounded change -> dotnet-backend, poi done-check; nessun gate (un solo file, reversibile)
new subsystem  -> plan-work; gate: concordare prima il contratto della coda (condiviso da due servizi)
```

That line is the whole ceremony. If it cannot be written, the request is still ambiguous: ask one
question, do not start coding.

## Traps

1. Everything looks bounded at first → the file count is discovered while editing → when a third
   file needs a new interface, stop and switch to `plan-work`.
2. A probe silently becomes the implementation → the probe code works, so it gets kept → probe code
   is never production code; redo it as a bounded change, with the gate.
3. Approval theatre on trivial edits → treating "ask first" as a fixed rule → one reversible file
   never needs approval; spend that budget on the irreversible row.
4. A fix lands before a reproduction → the cause looked obvious → an obvious cause that was never
   reproduced is a guess; `debug-systematic` first.
5. "Is this design right?" answered with a redesign → the instinct is to help by proposing → that
   question wants attack, not alternatives: route to `grill-me`.
6. Reclassifying every turn → this skill loaded again mid-task → classify once per task; only a real
   change of shape earns a second pass.
