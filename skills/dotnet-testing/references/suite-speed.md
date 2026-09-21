# Making a suite fast enough that it gets run

A suite nobody runs locally provides no feedback; it only reports failures long after the context is
gone. The target is a fast lane under about ten seconds and a full run in a couple of minutes.

## Two lanes, declared with traits

Mark every test with a category trait — `Unit`, `Integration`, `Database` — and make the split
enforceable from the CLI:

```powershell
dotnet test --filter "Category=Unit"                              # the loop you run constantly
dotnet test --filter "Category!=Integration&Category!=Database"   # everything cheap
dotnet test                                                       # the full run, before pushing
```

Put the trait on a base class or a custom attribute rather than on each test, or it will be forgotten.
An unmarked test is by definition in the slow lane, so make the fast lane the explicit one.

## Where the time actually goes

Measure before optimizing. In order of how often it is the answer:

| Cause | Fix |
|---|---|
| A host or a container built per test | build it once per collection in a fixture |
| Fixed delays waiting for something | wait on the condition with a bounded poll, or on a signal |
| Recreating the schema per test | truncate or roll back instead (`real-database.md`) |
| A test hitting a real network endpoint | stub the message handler |
| Collections forced onto one thread | see parallelism, below |
| Migrations applied per test class | apply once per run, in the collection fixture |
| Serial database tests that could share a container | one container, one collection, data reset per test |

Find the offenders instead of guessing:

```powershell
dotnet test --logger "trx;LogFileName=results.trx"
# then read the durations out of the trx and sort them
Select-Xml -Path .\TestResults\results.trx -XPath '//*[local-name()="UnitTestResult"]' |
  ForEach-Object { $_.Node } | Sort-Object { [TimeSpan]$_.duration } -Descending |
  Select-Object -First 20 testName, duration
```

Twenty slowest tests is almost always a list of three root causes.

## Parallelism

xUnit runs test **collections** in parallel and tests within a collection sequentially. Consequences:

- Each test class is its own collection by default, so unit tests already parallelize.
- Putting every integration test into one collection to share a host **serializes them all**. If the
  suite is large, split into a few collections, each with its own host and its own database or schema,
  and accept the extra memory in exchange for the wall clock.
- Any shared mutable resource — one database, one file, one fixed port — forces serialization for
  correctness. Make the resource per-collection instead of serializing.
- Set the parallelism limit deliberately for the pipeline agent, which usually has fewer cores than
  the development machine, or database tests will fight over connections and time out.

## Sharing expensive fixtures

| Scope | Mechanism | Use for |
|---|---|---|
| Per test | constructor | cheap arrangement, the change tracker |
| Per class | class fixture | a substitute graph, a mapper configuration |
| Per collection | collection fixture | the test host, the database container, applied migrations |
| Per run | a collection everything shares, or an assembly-level fixture | a container you truly want once |

The rule: expensive and immutable goes wide; anything mutable stays per test. A wide fixture holding
mutable state is the number-one source of order-dependent failures.

## Container reuse

Starting a SQL Server container is the slowest single step in a local run. Options, in order:

1. Keep it per collection and reset data per test — usually enough.
2. Enable Testcontainers' reuse feature locally so a container survives between runs. Never enable
   reuse in the pipeline: a leftover container is a shared-state bug across builds.
3. Point the tests at an already-running local instance via configuration, keeping the container path
   as the default. Useful for a tight loop, but the pipeline must use the container.

## Cutting build time, not just test time

```powershell
dotnet build                       # once
dotnet test --no-build             # then loop on this
dotnet test --no-restore           # when only test code changed
```

Half of a "slow test run" is often the restore and build of a large solution. Running one test project
instead of the solution is the other half.

## What to stop doing

- Do not delete slow tests to make the number look better; move them to the slow lane and fix the
  cause.
- Do not chase a coverage percentage. Coverage of untested legacy code is a number that costs weeks
  and prevents nothing.
- Do not add a retry wrapper to a flaky test. A retried test hides a real race, in the code or in the
  test; find the shared state (`real-database.md`, determinism checklist in `unit-mechanics.md`).
- Do not run database tests in the pre-commit path. Gate them in the pipeline, where a minute is
  affordable and a developer's attention is not the resource being spent.

## The pipeline split

Fast lane on every push, so a broken build is known in under a minute. Full suite including database
tests on the pull request, where it gates the merge. That split keeps both properties: fast feedback
while writing, and nothing merged untested.
