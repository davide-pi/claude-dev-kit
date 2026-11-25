---
name: rico
description: >-
  Use when the user calls "rico", "rico, bug" or "rico, sistemalo" on a defect to reproduce, root-cause and fix:
  the name is the trigger.
argument-hint: "[sistema] [the request, or nothing to use the one under discussion]"
---
# rico — bugs: reproduce, find the cause, fix with proof
**Contract.** A reproduced bug, its root cause and a fix proven by the repro test · never fixes before the cause is proven · chat in the chat language.
## When
Not for: a diagnosis with no fix asked (`debug-systematic`), a feature (`deliver`).
## Decide
- The bug: the arguments, else the one under discussion; none → ask once.
- Not a bug → one line on who takes it, then that skill: analysis `kowalski`, feature `skipper`, tests `soldato`.
- Reproduce and find the root cause with `debug-systematic`; the repro becomes a failing test.
- The fix goes through `skipper` (so `deliver`, scenario `bug`), with that test as the proof.
- No repro possible → report what was tried and stop; never ship a guessed fix.
## Do
1. Run `debug-systematic` until the root cause is stated and the repro test is red.
2. Hand both to `skipper`; report the test going green.
## Traps
1. Fixing the symptom → the cause was never proven → go back to the repro.
## References
`debug-systematic` owns the method; `skipper` owns the run.
