# Clean code — tie-breaks at function and name level (rung 4)

The review checklist (`code-reviewer` passes G1-G3) says what to flag. This file settles the grey zones,
where two clean-code habits pull apart.

## Tie-breaks

| Tension | Winner | Unless |
| --- | --- | --- |
| extract a function against keep it inline | extract when the name tells the caller more than the body does | extracting only to shorten: keep it inline |
| many small functions against one linear flow | one top-down flow that reads in one pass, even at 40 lines | the flow mixes levels (I/O, rules, formatting) → extract per level |
| early return against a single exit | guard clauses first, the main path unindented | cleanup must run on every path → `using`/`finally`, not a single exit |
| a comment against a rename | rename | the why is not expressible in a name: one comment line |
| a magic value against a constant | a named constant when it repeats or its meaning is not evident | `0`, `1`, `""`, an index, a value that reads as itself |
| a defensive null check against the type | trust the nullable annotations inside the code | a trust boundary: input, deserialized data, a library without annotations |
| an exception against a result value | the stack skill decides (rung 1) | — |
| a query chain against a loop | the one a reader parses in one pass | side effects or early exits → the loop |
| repetition in tests against a shared helper | repetition: each test reads alone | identical setup longer than about ten lines → a builder or fixture |
| a long parameter list against a parameter object | the list | more than four that always travel together → an object |
| renaming a misleading name met while working | a `Noticed` row | the name is in code the change itself adds or rewrites |
| dead code met while working | a `Noticed` row | the change made it dead: delete it |

## Overcomplicated: the standing test

A senior engineer would call it overcomplicated when any of these holds, and the fix is the
simpler shape, never a further abstraction:

- an abstraction with one user and no named seam;
- a configuration knob nobody sets to a second value;
- an error path for a state the types already exclude;
- a wrapper whose methods only forward;
- a generic or reusable version of code written once.

## Not a finding

- A style the formatter or the analyzer owns.
- A shape that matches the module's idiom (rung 2), even if another shape is cleaner.
- A smell in lines the change did not touch, unless the change makes it worse.
