# What deserves a test, at which level, and where to start

Risk decides, not ritual. Coverage is not the goal and test-first is not a rule; the goal is that the
failures which would hurt are caught by something cheaper than production. Two rules are absolute:

1. **A bug fix without a test that failed first is not a fix** — the failing test *is* the repro from
   `debug-systematic`. In a project with no harness yet, the written repro steps stand in for it, and
   the gap is stated in the change description.
2. **Every test is seen failing before it is trusted.** Break the code or the assertion once.

**Language:** the strategy and the recommendation are written for the user in **Italian**; test names,
test code and fixtures follow the repository's conventions, which are English.

## What earns a test, and when

| Code | Test | Order | Why |
| --- | --- | --- | --- |
| A domain rule: a price, odds, a payout, a quota, a state machine | yes | **first** | pure input to output; the spec is the test |
| A reproduced bug, anywhere | yes | **first** | the failing test is the repro and the proof |
| Legacy code about to be modified | yes | **first**, as characterization | otherwise the change cannot be told from a regression (`untested-legacy.md`) |
| An RPC responder or a message handler | yes, on the handler method; idempotency explicitly | after | redelivery is a certainty; the transport is not under test |
| Parsing, mapping, validation with many arms | yes | after | table-driven, once the shape settles |
| A repository, a query, raw SQL | yes, against a real engine | after | a mocked query proves nothing |
| An endpoint | one happy path plus one denied path | after | wiring, binding, the filter pipeline |
| A component with behaviour: form logic, guards, computed state | yes | after | assert output and emitted events, never internals |
| Template-only components, styles, layouts | no | — | nothing a human would not re-check anyway |
| DI wiring, options binding, migrations, generated code | no | — | the tool owns it; one startup test covers the wiring |
| A spike, a probe, a one-off script | no | — | the code is deleted when the question is answered |
| A hot path suspected of being slow | no — measure | — | `dotnet-diagnostics`; a benchmark is not a test |

Nothing on the list needs permission to skip. The reason for skipping goes in the change description.

## Test-first or test-after

| Test-first pays when | Test-first gets in the way when |
| --- | --- |
| the behaviour is input to output before any code exists | the API being integrated is unfamiliar — spike first, test the wrapper you kept |
| a bug has a known repro | the shape of the code is unknown until it runs once |
| many branches, small arrangement | the harness does not exist yet — build the seam first |
| behaviour must survive a refactor | the output is visual or subjective |

## Where to start when there is almost nothing

Order by blast radius, never by what is easiest to reach:

1. **Money and quantities** — stakes, payouts, balances, settlement, anything that computes an amount.
2. **Authorization and tenancy** — who sees or edits what.
3. **Data loss** — deletes, bulk updates, merges, maintenance jobs with a retention window.
4. **The path in the acceptance criteria being worked on now** — coverage grows with the work.
5. **The code that broke before** — a bug that recurred once recurs twice.

Then stop. A second test on path 1 beats a first test on path 9, and no percentage target is set.

## Level choice

| Question | Level | Cost |
| --- | --- | --- |
| Is this rule correct? | unit, no doubles beyond the boundary | milliseconds |
| Do these units compose? | unit with a substitute at the boundary only | milliseconds |
| Does the query, mapping or transaction work? | integration against a real engine | seconds |
| Does the request reach the right code and come back right? | integration through the in-memory host | seconds |
| Does the user's flow work? | manual, or the `items-qa` browser pass | minutes |

There is no browser-automation layer in these workspaces, and this skill does not invent one.

## The framework map — follow what the repository already uses

| Where | Runner | Rule |
| --- | --- | --- |
| A .NET solution with tests | whatever its test projects reference | add to it in place; never a second runner in one solution |
| A .NET solution with none | xUnit, a substitute library, a fluent assertion library | the default for the first project (`untested-legacy.md`) |
| The store-era Angular app | its Karma harness | do not migrate the harness to add one test |
| The signals-era Angular app, React apps | the vitest setup in `package.json` | component tests for behaviour, plain functions for logic |

```powershell
Get-ChildItem -Recurse -Filter *.csproj | Select-String "xunit|MSTest|NUnit|Testcontainers" |
  Select-Object -ExpandProperty Line -Unique
Get-Content package.json | Select-String "jest|vitest|karma|jasmine"
```

## Frontend seams

| Situation | Seam |
| --- | --- |
| Logic inside a component | move it to a service or a plain function and test that |
| A component with inputs and outputs | set inputs, assert rendered output and emitted events |
| Direct HTTP in a component | move it to a service, substitute the service |

## What to assert, at any level

| Assert | Do not assert |
| --- | --- |
| the returned value or the produced state | which private methods were called |
| the observable side effect: a row written, a message published | an exact call count, unless the count *is* the requirement |
| the error contract at a boundary (`IsSuccess`, an error status) | a log message string |
| idempotency: the same input twice leaves one effect | an ordering the code never promised |

To close a large gap deliberately, fan out the `test-writer` agent over the highest-risk classes, one
class per agent, each told to follow the patterns already in the repository.
