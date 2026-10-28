---
name: dotnet-testing
description: >-
  Use when a .NET test is written, fixed or proposed: should this change be tested, regression
  test, first test project, mock or fake, flaky suite.
paths: "**/*Tests*/**/*.cs,**/*.Tests.csproj"
---

# dotnet-testing — risk decides what gets a test; the codebase decides how

**Contract.** A test-or-not verdict with its reason, and tests in the repository's own style · never
a second framework, never a coverage target · the recommendation in the chat language, test code in English.

## When

Not for: diagnosing the product's behaviour (`debug-systematic`), Angular or React harnesses
(`angular`, `react`), what the code under test should do (the owning stack skill).

House facts: rule `csharp-tests` (the handler seam, a real engine for SQL, a failing test first for a bug).

## Decide

### The starting point

The large RPC backend has **no test projects**: changes there are verified by build, an Aspire
profile, `/health` and exercising the path. So the question is rarely "how do I mock this" — it is
"does this change earn the first test, and where is the seam". Smaller solutions do have suites:
there, follow what they already use.

### Does this change earn a test

| The change | Answer | Detail |
| --- | --- | --- |
| a rule touching money, odds, settlement, permissions or data loss | yes, **first** — open the project if none exists | `references/strategy.md` |
| legacy code about to change, behaviour not fully understood | a characterization test first, committed alone | `references/untested-legacy.md` |
| wiring, a pass-through, generated code, a spike | no — verify the house way and say so | `references/strategy.md` |

### Substitute or hand-written fake

| Signal | Choose |
| --- | --- |
| one or two calls, and you assert they happened (an outgoing RPC request, a published event) | substitute |
| a query surface used across many tests, or the test stores then reads back | fake — dictionary-backed |
| a type you own and can simply construct | neither — the real thing |
| mocking three levels deep to reach one value | the design is wrong, not the test |

Two doubles is normal; four means the class orchestrates too much — split it and test the piece that
holds the logic.

## Do

What the repository already uses — copy it, never invent beside it: Grep
`xunit|NUnit|MSTest|NSubstitute|Moq|FluentAssertions|Shouldly|Testcontainers` in `*.csproj`.

```powershell
dotnet test --filter "FullyQualifiedName~<Class>"   # one class, or one test by full name
dotnet test --blame-hang-timeout 2m                 # names the test that never returns
dotnet test --logger "trx;LogFileName=results.trx"  # a file to read, not a wall of console

# No tests in this tree: the house verification, stated in the change description
dotnet build <solution>   # then the app-host profile with the service (docker-dev-env), /health, the path
```

Docker must be running for anything using Testcontainers. Opening the first test project, and the
pipeline step that must ship with it: `references/untested-legacy.md`.

## Traps

1. A coverage percentage as the objective → getters get tested while the payout rule stays bare →
   rank by risk, report which risks are covered.
2. Legacy behaviour changed before it was characterized → the new tests encode the bug just added.
3. A test project not in the solution, or with no pipeline step → it never runs and silently dies.
4. Passes alone, fails in the suite → shared static state, a singleton fixture, data not reset →
   state per test.
5. An `async void` test, or a call not awaited → it passes without asserting → return `Task`.
6. Every test rebuilds the host or a container → minutes of overhead → one fixture per collection,
   reset only the data.

## References

- `references/strategy.md` — what earns a test and when, where to start from nothing, level choice,
  the framework map, what to assert.
- `references/untested-legacy.md` — the responder-method seam, characterization, breaking
  dependencies, sprout and wrap, the first test project and its pipeline step.
- `references/unit-mechanics.md` — structure and lifecycle, data-driven tests, assertions, async,
  substitutes, fakes, builders, determinism.
