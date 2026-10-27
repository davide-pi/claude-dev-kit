---
name: principles
description: >-
  Use when a design choice is open: extract or inline, share or duplicate, interface or class,
  which pattern, which layer owns code, "is this overcomplicated?".
---

# principles — which principle wins when two disagree

**Contract.** A design choice settled by the ladder, naming the rung that decided it · never a
textbook definition, never a refactor outside the scope · explanation in Italian, code in English.

## When

- Two shapes compete: extract or inline, share or duplicate, interface or concrete class, a
  pattern or plain code.
- New code needs an owner: which service, project, layer or module.
- A review finding trades one principle against another ("duplicated" against "coupled").

Not for: a stack's idioms (`dotnet-backend`, `ef-core`, `angular`, `react`), the procedure of a
change (`deliver`), attacking a whole design (`grill-me`).

## Decide

### The ladder — a higher rung always wins

| Rung | Scope | What it holds | Why it outranks the rungs below |
| --- | --- | --- | --- |
| 1 House facts | any file | `rules/*.md`, the stack skill, contracts shared with callers | breaking it breaks a caller or production |
| 2 Local convention | the file and its siblings | the idiom already there | two idioms in one module tax every later reader |
| 3 Architecture | services, projects, layers | ownership, dependency direction, boundaries | a crossed boundary is paid on every later change |
| 4 Clean code | function, class, name | the simplest code that reads true | complexity is paid on every read |
| 5 Patterns | a recurring structure | a known shape for a cost rung 4 already named | a pattern with no force is complexity |

A lower rung argues only inside the room the higher one leaves. The change scope (`CLAUDE.md`)
sits above the whole ladder: a rung that wants an edit outside the scope gets a `Noticed` row.

### Tie-breaks met every week

| Tension | Winner | Unless |
| --- | --- | --- |
| a cleaner shape against the module's idiom | the idiom (2) | the scope is changing that idiom |
| a boundary already violated in the touched module | leave it, one `Noticed` row | the task is to fix it |
| the same logic in two services | duplicate (3) | it is a contract both must agree on → the shared contract package |
| the same logic twice in one module | leave it; extract at the third copy | the copies already diverged into a bug, or the change adds both → one shape now |
| an interface with one implementation | the concrete class | the stack skill names it as the test seam, or the scope adds a second one |
| a pattern against plain code | plain code (4) | the force is present today, not foreseen (`references/design.md`) |
| a new layer, project or library against a folder | the folder | a second deployable, or a dependency that must not leak |
| "flexible for later" against what the scope needs | what the scope needs | the owner stated the later need |

### Read by scope

| The question is about | Read |
| --- | --- |
| which service, project or layer owns it; dependency direction; sync against async | `references/architecture.md` |
| coupling, cohesion, an abstraction, inheritance, a named pattern, testability | `references/design.md` |
| where a business rule or invariant lives, an entity's shape, a consistency boundary | `references/domain.md` |
| a name, a function's size, duplication, a comment, a parameter list, defensive code | `references/clean-code.md` |

### Severity, when it is a review finding

| Breaks rung | Priority |
| --- | --- |
| 1 | the reviewer's own scale: contract or production → P1, else P2 |
| 3, a crossing the change creates | P2 |
| 3, a crossing that was already there | not a finding on this change |
| 4 or 5 | P3, unless it hides a defect |

### Output

The choice, the rung that decided it, what was given up: one line each. No principle is named
without the concrete cost it saves in this code.

## Do

The "already exists?" rung comes before any new abstraction:

```powershell
# An existing helper before writing one: search by the noun and the verb of the intent
Get-ChildItem -Recurse -Include *.cs, *.ts | Select-String -Pattern '<Noun>.*<Verb>|<Verb>.*<Noun>' -List |
  Select-Object Path, LineNumber, Line
# Dependency direction: which projects already reference the one you are about to depend on
Get-ChildItem -Recurse -Filter *.csproj | Select-String 'ProjectReference Include=".*<Project>\.csproj'
```

## Traps

1. A refactor rides along a feature because rung 4 "obviously" wants it → the scope outranks the
   ladder → one `Noticed` row, no edit.
2. The pattern is named before the problem → ask which cost it removes in this code → none
   nameable → plain code.
3. Duplication counted by text → two blocks that look alike but change for different reasons are
   not duplicates → leave them apart.
4. Layers from a reference architecture added to a service that has none → rung 2 → follow the
   service's own layout.

## References

- `references/architecture.md` — ownership of new code, dependency direction, service boundaries,
  sync against async, shared libraries.
- `references/design.md` — abstractions, composition, the force that justifies each common pattern,
  coupling signals, testable shape.
- `references/domain.md` — invariants, rich against anemic entities, aggregates and consistency
  boundaries.
- `references/clean-code.md` — tie-breaks at function and name level, the review checklist's grey zones.
