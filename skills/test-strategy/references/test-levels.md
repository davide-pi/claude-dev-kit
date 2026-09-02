# Test levels — what each one buys, and what it costs

## The levels in use

| Level | Buys | Costs | Put here |
|-------|------|-------|----------|
| Unit, no infrastructure | Fast feedback on rules and branches | Nothing; run them constantly | Calculations, validation, state machines, mapping, guard logic |
| Unit with a substitute at the boundary | Composition of units without IO | A substitute that can drift from reality | Handlers, services, orchestration whose collaborators are interfaces you own |
| Integration, real engine | Proof that queries, transactions and migrations work | Seconds per test, plus a running engine | Repositories, raw SQL, EF translations, concurrency behaviour, migrations |
| Integration through the host | Routing, binding, serialization, filters, auth pipeline | Seconds; a fixture per suite | One happy path and one denied path per endpoint group |
| Manual, or the browser QA pass | Confidence in the user's flow | Minutes of a human | Acceptance criteria on a screen; `items-qa` posts the verdict |

There is deliberately **no browser-automation level**: no such harness exists in these workspaces,
and adding one is a project, not a test. The top automated level is the host integration test.

## The framework map — follow what the repository already uses

| Where | Runner and style | Rule |
|-------|------------------|------|
| Recent .NET work | xUnit, substitute-style mocking, fluent assertions | The default for anything new |
| One .NET solution | Testcontainers for the real engine | Keep it there; do not spread containers into unit suites |
| Legacy .NET solutions | MSTest | Add to it in place; never mix a second runner into the same solution |
| Legacy Angular | The older browser-based runner already configured | Do not migrate the harness in order to add a test |
| New Angular and React | The project's Jest or Vitest setup | Component tests for behaviour, plain functions for logic |

Detect before writing:

```powershell
Get-ChildItem -Recurse -Filter *.csproj | Select-String "xunit|MSTest|NUnit|Testcontainers"
Get-Content package.json | Select-String "jest|vitest|karma|jasmine"
```

## Speed budget, and why it is a correctness concern

| Suite | Target | If it exceeds it |
|-------|--------|------------------|
| Unit suite of one project | Under a few seconds | Infrastructure leaked into a unit test |
| Whole unit suite | Under a minute | Too much arrangement, or IO in disguise |
| Integration suite | Minutes, run before push | Containers started per test instead of per suite |

A suite nobody waits for is a suite nobody runs, and untested code that reports as tested is worse
than untested code.

## Rules that keep integration tests honest

1. **One real engine, started once per suite**, not per test. Reuse the instance, isolate the data.
2. **Isolate by data, not by cleanup**: a unique tenant, prefix or schema per test beats a truncate
   that races the next test.
3. **A transaction per test, rolled back**, where the engine and the code allow it.
4. **Never assert against data seeded by another test.** Each test arranges everything it reads.
5. **No fixed ports.** Let the container pick one, then read it back.
6. **No sleeps.** Wait on readiness — a health check, a poll with a bounded timeout.
7. **Migrations run as part of the fixture**, so the schema under test is the one that ships.
8. **The connection settings come from the fixture**, never from a developer machine's
   configuration, or CI has nothing to connect to.

## What to assert, at any level

| Assert | Do not assert |
|--------|---------------|
| The returned value or the produced state | Which private methods were called |
| The observable side effect: a row written, a message published | The exact number of calls to a substitute, unless the count *is* the requirement |
| The error type and the message contract at a boundary | The stack trace, or a message string that is only a log |
| The rendered output and the emitted event | The internal component state |
| Idempotency: the same input twice leaves one effect | Ordering that the code never promised |

## Table-driven cases

Many arms of the same rule belong in one parameterized test, not in twenty near-identical methods:
the input, the expected output, and a name that says which rule the row exercises. When a row
fails, the name must identify it without opening the file. Mechanics — the attributes, the data
sources, the naming — are in `dotnet-testing`.

## Naming

A test name states the condition and the expected outcome, so a red suite is readable without
opening any code: subject, condition, expectation. Avoid names that only repeat the method name,
and avoid numbering. The failure output is documentation; write it as such.

## When a test is the wrong instrument

| Question | Right instrument |
|----------|------------------|
| Is this fast enough? | A measurement, not an assertion on elapsed time (`debug-systematic`) |
| Does it work against the real third party? | A manual probe or a spike; do not put a live dependency in the suite |
| Does the schema change apply cleanly? | A generated migration script, reviewed, plus one integration run |
| Does the deployment work? | The pipeline, not a test |
| Is the layout right? | A human looking at it |
