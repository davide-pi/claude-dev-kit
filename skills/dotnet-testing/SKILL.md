---
name: dotnet-testing
description: >-
  Use whenever a test is written, fixed or proposed, or a change raises "should this be tested,
  and how" — especially in the backend that has no tests yet: a risky change, a bug fix needing a
  regression test, a first test project, a mock-or-fake choice, or a flaky suite.
---

# dotnet-testing — risk decides what gets a test; the codebase decides how

The reality this skill is built around: the large RPC-heavy backend has **zero test projects**, and
changes there are verified by build, an Aspire profile, `/health` and exercising the path. So the
first question is rarely "how do I mock this" — it is "does this change earn the first test, and
where is the seam". Smaller solutions elsewhere do have suites; there, follow what they already use.

## When

- A change is about to be written and the test question is open — what, at which level, first or after.
- A bug has been reproduced and the fix needs locking in.
- Code with no tests has to be changed, extended or refactored; a first test project is needed.
- Writing or fixing tests: structure, async, substitutes against fakes, builders, determinism.
- A suite is flaky, hangs, or is slow enough that nobody runs it.

Not for: what the code under test should do (`dotnet-backend`, `ef-core`, `sql-server`), diagnosing a
failing or flaky behaviour in the product (`debug-systematic`), deciding whether the whole change is
done (`done-check`), Angular or React harness mechanics (`angular`, `react`), or exact framework APIs
(the `microsoft-docs` plugin or the package's own docs).

**Language:** the recommendation is written for the user in **Italian**; test names and test code
follow the repository's English conventions.

## Decide

### Does this change earn a test — the short form

| The change | Answer | Detail |
| --- | --- | --- |
| A rule touching money, odds, settlement, permissions or data loss | yes, **first** — open the project if none exists | `references/strategy.md` |
| A reproduced bug | yes, first: the failing test is the repro | `references/strategy.md` |
| Legacy code about to change, behaviour not fully understood | characterization test first, committed alone | `references/untested-legacy.md` |
| An RPC responder or subscriber | test the handler method directly — it is the seam | `references/untested-legacy.md` |
| A query or raw SQL | a real engine, never the in-memory provider | `references/untested-legacy.md` |
| Wiring, a pass-through, generated code, a spike | no — verify the house way and say so | `references/strategy.md` |

### Substitute or hand-written fake

| Signal | Choose |
| --- | --- |
| One or two calls, and you assert they happened (an outgoing RPC request, a published event) | substitute |
| A query surface used across many tests, or the test stores then reads back | fake — a dictionary-backed implementation |
| The setup block is longer than the assertion | fake |
| A type you own and could simply construct | neither — construct the real thing |
| A `DbContext` | neither — a real database |
| Mocking three levels deep to reach one value | the design is wrong, not the test |

Two doubles is normal; four means the class orchestrates too much — split it and test the piece that
holds the logic.

## Do

```powershell
# What the repository already uses — copy it before inventing anything
Get-ChildItem -Recurse -Filter *.csproj | Select-String -Pattern 'xunit|NSubstitute|Moq|FluentAssertions|Shouldly|Testcontainers|MSTest|NUnit' |
  Select-Object -ExpandProperty Line -Unique

dotnet test                                        # whole solution
dotnet test .\src\<Tree>\tests\<Project>.Tests     # one project
dotnet test --filter "FullyQualifiedName~<Class>"  # one class, or one test by full name
dotnet test --blame-hang-timeout 2m                # names the test that never returns
dotnet test --logger "trx;LogFileName=results.trx" # a file to read, not a wall of console

# Prove a new test can fail: run it before the fix (expect failed), then after (expect passed)
dotnet test --filter "FullyQualifiedName~<NewTest>"

# No tests in this tree? The house verification, stated in the change description
dotnet build <solution file>
#   then run the app-host profile containing the service (docker-dev-env), hit /health, exercise the path
```

Opening the first test project, and the pipeline step that must ship with it, is in
`references/untested-legacy.md`. Docker must be running for anything using Testcontainers.

## Traps

1. A coverage percentage as the objective → getters get tested while the payout rule stays bare →
   rank by risk, report which risks are covered.
2. A test written after the fix, from the fixed code → it asserts the implementation, not the bug →
   write it first and watch it fail.
3. Changing legacy behaviour before characterizing it → the new tests encode the bug just introduced.
4. A second test framework next to the existing one → two runners, half the suite forgotten.
5. A test project not added to the solution, or no pipeline step → it never runs and silently dies.
6. A test passes alone and fails in the suite → shared static state, a singleton fixture, a database
   not reset → make state per test.
7. `async void` test, or a call not awaited → it passes without asserting → return `Task`, await all.
8. `DateTime.UtcNow` in code or assertion → fails at midnight or across DST → inject a clock.
9. The in-memory EF provider makes a broken query pass → it is not relational → a real engine.
10. Testing the RPC transport instead of the handler → slow, flaky, needs a broker → call the method.
11. Randomized data with no seed → the failure is not reproducible → seed and log it.
12. Every test rebuilds the host or a container → minutes of overhead → share the fixture per
    collection and reset only the data.

## References

- `references/strategy.md` — what earns a test and when, test-first against test-after, where to start
  when there is nothing, level choice, the framework map across the workspaces, what to assert.
- `references/untested-legacy.md` — the centre for the backend: the responder-method seam,
  characterization, breaking dependencies, sprout and wrap, opening the first test project and its
  pipeline step, and a note on host and real-database tests.
- `references/unit-mechanics.md` — xUnit structure and lifecycle, data-driven tests, assertion style,
  async tests, substitutes, hand-written fakes, test data builders, determinism.
