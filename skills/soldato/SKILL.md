---
name: soldato
description: >-
  Use when the user calls "soldato", "soldato, testa" or "soldato, test" to test the current change: unit and
  integration first, then an offer of real tests; the name is the trigger.
argument-hint: "[testa] [the request, or nothing to use the one under discussion]"
---
# soldato — tests: run the change's tests, offer the real ones
**Contract.** The change's unit and integration tests run, real tests proposed and run only on a yes, a report of what ran · never runs live or e2e tests unasked · chat in the chat language.
## When
Not for: writing tests inside a change (`deliver`, `dotnet-testing`), a red pipeline (the `pipelines` rule).
## Decide
- What to test: the arguments, else the current change.
- A request to analyse, build or debug → hand it over with one line: `kowalski`, `skipper`, `rico`.
- A test is red → never fix it here: cause unknown → `rico`, cause known → `skipper`.
- Unit tests are written test-first in Given/When/Then (rule `tests`); real tests only after asking, as below.
- Run the unit and integration tests the change touches, with the repo's own commands.
- Then one `AskUserQuestion`: propose the real tests (live, e2e) with the exact command each.
- Yes → run them with skill `run`. No or silence → don't run them.
## Do
1. Find the commands (`CLAUDE.md`, build files), run, read the result lines.
2. Ask once. On yes, run the real tests. Report each command with its deciding line, and what was not run.
## Traps
1. Real tests run "to be thorough" → they hit live systems → only after the yes.
## References
`dotnet-testing` for the test strategy of a .NET repo.
