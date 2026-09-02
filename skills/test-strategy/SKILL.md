---
name: test-strategy
description: >-
  Decides what to test, at which level, and in what order — risk-based, not dogmatic. Use when
  deciding whether a change earns a test at all, whether to write it before or after the code, which
  level it belongs at, when a bug fix needs a regression test, and especially when adding tests to
  code that has none: pick the seam, characterize the current behaviour before changing it, and grow
  coverage from the highest-risk path instead of chasing a percentage. Decides strategy only;
  framework mechanics live in the stack skills.
---

# test-strategy — risk decides, not ritual

Coverage is not the goal and 100% test-first is not the rule. The goal is that the failures which
would actually hurt are caught by something cheaper than production. Two rules are absolute:

1. **A bug fix without a test that failed first is not a fix** — the failing test *is* the repro
   from `debug-systematic`, and it is what proves the mechanism.
2. **Every test must be seen failing before it is trusted.** A test that passed on its first run
   asserts nothing until proven otherwise.

Everything else is a judgement call, and the tables below make it.

## When

- A change is about to be written and the test question is open.
- A bug has been reproduced and the fix needs locking in.
- Code with no tests has to be changed, extended or refactored.
- Choosing between a unit test, an integration test and no test at all.
- A repository with almost no tests is taking new work, and coverage has to start somewhere.

Not for: framework mechanics — assertions, mocking, fixtures, container setup — which live in
`dotnet-testing`, `angular` and `react`; diagnosing a failing or flaky test (`debug-systematic`);
deciding whether the whole change is done (`done-check`).

## Decide

### What earns a test, and when

| Code | Test | Order | Why |
|------|------|-------|-----|
| A domain rule, calculation, price, discount, quota, state machine | Yes | **First** | Pure input-to-output, the spec is the test, branches are cheap to cover |
| A reproduced bug, anywhere | Yes | **First** | The failing test is the repro and the proof |
| Legacy code about to be modified | Yes | **First**, as characterization | Without it the change cannot be told from a regression (`references/legacy-seams.md`) |
| Parsing, mapping, validation with many arms | Yes | After | Table-driven cases, added once the shape settles |
| A repository or query | Yes, integration | After | Against a real engine; a mocked query proves nothing |
| An endpoint or controller | One happy path plus one auth-failure path | After | Wiring, routing, serialization and the filter pipeline |
| A background worker or message handler | Yes, on the handler logic; idempotency explicitly | After | Duplicate delivery is a certainty, not an edge case |
| A component with behaviour: form logic, guards, computed state | Yes | After | Assert behaviour and output, never the internals |
| A template-only component, a style, a layout | No | — | Nothing to assert that a human would not re-check anyway |
| DI wiring, options binding, a migration, generated code | No | — | The framework or the tool owns it; the endpoint test covers the wiring |
| A spike, a probe, a one-off script | No | — | The code is deleted when the question is answered |
| A hot path suspected of being slow | No — measure instead | — | `debug-systematic`; a benchmark is not a test |

Nothing on the list requires permission to skip. The reason for skipping is written in the change
description, not asked for each time.

### Test-first, or test-after

| Test-first pays when | Test-first gets in the way when |
|----------------------|--------------------------------|
| The behaviour is expressible as input to output before any code exists | The API being integrated is unfamiliar — spike first, then test the wrapper you kept |
| A bug has a known repro | The shape of the code is unknown until it runs once |
| The branches are many and the arrangement is small | The test harness does not exist yet in that project — build the seam first |
| Existing behaviour must be preserved through a refactor | The output is visual or subjective |
| The design needs pressure toward small, injectable units | The change is a rename, a move, or a formatting pass |

### Where to start when there is almost nothing

Order by blast radius, never by what is easiest to reach:

1. **Money and quantities** — anything that computes an amount, a balance or a stock level.
2. **Authorization and tenancy** — anything that decides who sees or edits what.
3. **Data loss** — deletes, bulk updates, merges, migrations with a data step.
4. **The path in the acceptance criteria being worked on right now** — coverage grows with the work.
5. **The code that broke before** — a bug that recurred once will recur twice.

Then stop. A second test on path 1 is worth more than a first test on path 9, and no percentage
target is set at any point.

### Level choice

| Question | Level | Cost |
|----------|-------|------|
| Is this rule correct? | Unit, no test doubles beyond the boundary | Milliseconds |
| Do these units compose? | Unit with a substitute at the boundary only | Milliseconds |
| Does the query, mapping or transaction actually work? | Integration against a real engine | Seconds |
| Does the request reach the right code and come back shaped right? | Integration through the host, in-memory transport | Seconds |
| Does the user's flow work? | Manual, or the `items-qa` browser pass | Minutes |

There is no browser-automation test layer in these workspaces, and this skill does not invent one:
the top of the pyramid is an API integration test, and the flow check is manual.

## Do

```powershell
# 1. Match the framework already in the repository. Never add a second one.
Get-ChildItem -Recurse -Filter *.csproj |
  Select-String -Pattern "xunit|MSTest|NUnit|Testcontainers" |
  Select-Object -ExpandProperty Line -Unique
Get-Content package.json | Select-String -Pattern "jest|vitest|karma|jasmine"

# 2. No test project yet: create it beside the code it tests, then wire it up.
dotnet new xunit -n <Project>.Tests -o tests/<Project>.Tests
dotnet add tests/<Project>.Tests reference src/<Project>
dotnet sln add tests/<Project>.Tests

# 3. Prove the test fails before it passes.
dotnet test --filter "FullyQualifiedName~<NewTest>"    # expect: failed
#   ...write the code...
dotnet test --filter "FullyQualifiedName~<NewTest>"    # expect: passed

# 4. Use coverage to find the untested risky path, never as a target to hit.
dotnet test --collect:"XPlat Code Coverage"
npm test -- --run <spec-path>

# 5. Closing a large gap: fan out the test-writer agent over the highest-risk classes, one per
#    agent, each told to follow the patterns already in this repository.
```

## Traps

1. **A coverage percentage as the objective** — it is reached by testing getters while the pricing
   rule stays uncovered. Rank by risk, report which risks are covered.
2. **A test written after the code and never seen failing** — mutate the assertion or break the
   code once to confirm it can fail at all.
3. **Changing legacy behaviour before characterizing it** — the new tests then encode the bug you
   just introduced. Characterize first, always.
4. **A second test framework introduced next to the existing one** — two runners, two conventions,
   half the suite forgotten. Legacy stays on its framework.
5. **Mocking the type under test, or the database, to test the query** — the test passes and the SQL
   is still wrong. Use a real engine for anything that translates to SQL.
6. **Every test as an integration test** — the suite gets slow, so it stops being run. Push logic
   into units that need no infrastructure.
7. **Tests sharing one database, one port or one file** — order-dependent flakes appear as soon as
   the suite runs in parallel. Isolate per test.
8. **Asserting on implementation details** — private calls, exact call counts, internal ordering.
   The refactor breaks the test while the behaviour is intact.
9. **A skipped flaky test with no owner** — it is dead code pretending to be coverage. Link it to a
   work item or delete it.
10. **Testing the spike** — the code is going to be deleted; the test is pure waste.

## References

- `references/legacy-seams.md` — the code has no tests: how to find a seam, break dependencies
  without a rewrite, and characterize behaviour before touching it.
- `references/test-levels.md` — what each level buys and costs, what belongs at each, the framework
  map across these workspaces, and the rules that keep a suite fast and honest.
