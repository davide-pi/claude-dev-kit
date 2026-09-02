---
name: dotnet-testing
description: How to test .NET code in this stack — xUnit structure and fixtures, substitute-style mocking versus hand-written fakes, fluent assertion style, testing async code, integration tests against a real ASP.NET host with an in-memory test server, Testcontainers for a real database instead of the lying in-memory provider, test data builders, and how to keep a suite fast enough that it actually gets run. Also covers adding the first tests to legacy code that has none, and running and filtering tests from the CLI. Use when writing or fixing tests, deciding what kind of test a change deserves, choosing between a mock and a fake, setting up an integration or database test, diagnosing a flaky or slow suite, or opening a test project in an untested repository.
---

# dotnet-testing — what to test, with which kind of test, and how to keep it fast

## When

- Writing tests for new code, or for a change to code that already has them.
- Deciding what a change deserves: unit, integration against the host, or a real-database test.
- Choosing between a substitute (mocking library) and a hand-written fake.
- Testing async code, background services, or anything with a clock or a random value in it.
- Adding the first test to a class in the large untested estate.
- A suite that is flaky, or slow enough that nobody runs it locally.
- Running or filtering tests from the command line.

Not for: what the code under test should do (`dotnet-backend`, `ef-core`, `sql-server`), risk-based
decisions about what to test first (`test-strategy`), diagnosing a running process
(`dotnet-diagnostics`), or exact assertion and framework APIs — route those to the `microsoft-docs`
plugin or the package's own docs.

## Decide

### Which kind of test does this change deserve

| The change | Test | Why |
|---|---|---|
| A rule, a calculation, a mapping, a state transition | unit, no host, no database | fastest feedback, and this is where bugs live |
| A query, a projection, a migration, a constraint | integration with a **real** database | the provider is the thing being tested |
| Routing, binding, model validation, auth, filters, middleware | integration against the test host | only the real pipeline proves it |
| A background service, a scheduled job, a consumer | unit-test the handler; smoke-test the loop | the loop is framework code |
| A configuration or DI wiring change | host startup test — resolve the graph | catches captive dependencies and bad binding |
| A bug fix | a failing test first, at the lowest level that reproduces it | otherwise it comes back |

### Substitute or hand-written fake

| Signal | Choose |
|---|---|
| One or two calls, and you assert they happened | substitute (mocking library) |
| The dependency is a query surface used across many tests | fake — a dictionary-backed implementation |
| The test needs behaviour: store, then read back what you stored | fake; a substitute would need setup per call |
| The setup block is longer than the assertion | fake |
| You are mocking a type you own and could simply construct | neither — construct the real thing |
| You are mocking a `DbContext` | neither — use a real database (see `real-database.md`) |
| You are mocking three levels deep to reach one value | the design is wrong, not the test |

A fake wins the moment a dependency has state. It is written once, lives next to the tests, and turns
five substitute setups into one line. A substitute wins for verifying an interaction — "the email was
sent once, with this address".

### How many test doubles is too many

Two is normal. Four means the class under test is orchestrating too much: split it, and unit-test the
piece that holds the logic. Do not fix this in the test.

## Do

```powershell
dotnet test                                        # whole solution
dotnet test .\tests\<Project>                      # one project
dotnet test --no-build                             # after an explicit build, in a tight loop

# Filter: run only what you care about
dotnet test --filter "FullyQualifiedName~OrderService"
dotnet test --filter "Category=Unit"               # trait-based, see suite-speed.md
dotnet test --filter "Category!=Integration"       # the fast lane
dotnet test --filter "FullyQualifiedName~Place_Order_Fails_When_Out_Of_Stock"

# Diagnose a failure or a hang
dotnet test --logger "console;verbosity=detailed"
dotnet test --blame-hang-timeout 2m                # names the test that never returns
dotnet test --logger "trx;LogFileName=results.trx" # a file to read, not a wall of console

dotnet test --collect:"XPlat Code Coverage"        # coverage, if the collector package is referenced

# Create a test project and wire it up
dotnet new xunit -o .\tests\<Project>.Tests
dotnet add .\tests\<Project>.Tests reference .\src\<Project>
dotnet sln add .\tests\<Project>.Tests

# What the repo already uses — copy its conventions before inventing your own
Select-String -Path (Get-ChildItem -Recurse -Filter *.csproj).FullName -Pattern 'xunit|NSubstitute|Moq|FluentAssertions|Shouldly|Testcontainers|Respawn|Bogus|AutoFixture|WebApplicationFactory'
```

Docker must be running for anything using Testcontainers. `docker ps` is the first check when a
database test fails on a machine where it used to pass.

## Traps

1. A test passes alone and fails in the suite → shared state: a static field, a singleton fixture, a
   database not reset → make the state per test, or reset it in the fixture.
2. A test fails only on the build agent → it depended on the machine's culture, time zone, local
   database or file path → inject a clock, pin the culture, use a container.
3. `async void` test, or a test that does not await → it passes without asserting anything → return
   `Task` from every async test and await every call.
4. A hang with no failure → a blocking call on async inside the test, or a background loop with no
   stopping token → use the hang-blame option to name it, then fix the code, not the test.
5. `DateTime.UtcNow` in the assertion → passes today, fails at midnight or across a DST change →
   inject a clock and freeze it.
6. The in-memory EF provider makes a broken query pass → it is not a relational database → use a real
   one; see `real-database.md` for why this is not a preference.
7. A test asserting on every property of a returned object → one unrelated field change breaks twenty
   tests → assert what the test is about, and use an object-graph comparison for the rest.
8. Substitute setups repeated in fifteen tests → a change to the interface breaks all fifteen → move
   the arrangement into a builder or a fake.
9. Randomized data with no seed → the failure is not reproducible → seed the generator and log it.
10. A "unit" test that opens a database connection → the suite is slow and nobody runs it → separate
    the lanes with traits, and keep the fast lane genuinely fast.
11. Every test rebuilds the host or the container → minutes of overhead → share the expensive fixture
    across the collection and reset only the data. See `suite-speed.md`.
12. A test written after the fix, from the fixed code → it asserts the implementation, not the bug →
    write it first and watch it fail.

## References

- `unit-mechanics.md` — xUnit structure and lifecycle, fixtures, data-driven tests, fluent assertion
  style, async testing, substitutes, hand-written fakes, and test data builders.
- `integration-host.md` — testing against a real ASP.NET host in memory: the test factory, replacing
  services, configuration and authentication overrides, and what only this proves.
- `real-database.md` — Testcontainers for SQL Server and Postgres, exactly why the in-memory provider
  lies, migrating and seeding, and resetting state between tests.
- `untested-legacy.md` — the first test in a class that has none: seams, characterization tests,
  sprout and wrap, and what to leave alone.
- `suite-speed.md` — traits and lanes, parallelism, shared fixtures, container reuse, finding the
  slow tests, and the local versus pipeline split.
