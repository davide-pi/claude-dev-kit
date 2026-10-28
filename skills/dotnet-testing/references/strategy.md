# What deserves a test, at which level, and where to start

Risk decides, not ritual. Coverage is not the goal and test-first is not a rule. Two rules are absolute:

1. **A bug fix without a test that failed first is not a fix** — the failing test *is* the repro from
   `debug-systematic`. In a project with no harness yet, the written repro steps stand in for it, and
   the gap is stated in the change description.
2. **Every test is seen failing before it is trusted.** Break the code or the assertion once.

**Language:** the strategy and recommendation are written for the user in the **chat language**; test names, code
and fixtures follow the repository's conventions (English).

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

Nothing on the list needs permission to skip; the reason goes in the change description. Test-first is
a poor fit when the API being integrated is unfamiliar (spike first, test the wrapper you kept), the
harness does not exist yet (build the seam first), or the output is visual.

## Where to start when there is almost nothing

Order by blast radius, never by what is easiest to reach:

1. **Money and quantities** — stakes, payouts, balances, settlement, anything that computes an amount.
2. **Authorization and tenancy** — who sees or edits what.
3. **Data loss** — deletes, bulk updates, merges, maintenance jobs with a retention window.
4. **The path in the acceptance criteria being worked on now** — coverage grows with the work.
5. **The code that broke before** — a bug that recurred once recurs twice.

Then stop. A second test on path 1 beats a first test on path 9; no percentage target is set.

## Level choice

| Question | Level |
| --- | --- |
| Is this rule correct? / Do these units compose? | unit, a substitute at the boundary only |
| Does the query, mapping or transaction work? | integration against a real engine |
| Does the request reach the right code and come back right? | integration through the in-memory host |
| Does the user's flow work? | manual, or a browser pass |

There is no browser-automation layer in these workspaces, and this skill does not invent one.

## The framework map — follow what the repository already uses

| Where | Runner | Rule |
| --- | --- | --- |
| A .NET solution with tests | whatever its test projects reference | add in place; never a second runner in one solution |
| A .NET solution with none | xUnit, a substitute library, a fluent assertion library | the default for the first project (`untested-legacy.md`) |
| The store-era Angular app | its Karma harness | do not migrate the harness to add one test |
| The signals-era Angular app, React apps | the vitest setup in `package.json` | component tests for behaviour, plain functions for logic |

```powershell
Get-ChildItem -Recurse -Filter *.csproj | Select-String "xunit|MSTest|NUnit|Testcontainers" |
  Select-Object -ExpandProperty Line -Unique
Get-Content package.json | Select-String "jest|vitest|karma|jasmine"
```

Frontend seams: logic inside a component moves to a service or plain function; a component is tested
through inputs, rendered output and emitted events; direct HTTP in a component moves to a service that
is substituted.

## What to assert, at any level

Assert the returned value or state, the observable side effect (a row written, a message published),
the error contract at a boundary (`IsSuccess`, an error status), and idempotency (same input twice, one
effect). Do not assert private-method calls, an exact call count unless it *is* the requirement, a log
message string, or an ordering the code never promised.

To close a large gap deliberately, fan out the `implementer` agent over the highest-risk classes, one
class per agent, each brief naming this skill and a sibling test to copy.
