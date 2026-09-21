# Intermittent failures, and failures only CI sees

Both are the same problem: the failing conditions are not under your control yet. The work is to
take control of them, not to retry until green.

## Step 1 — turn "sometimes" into a rate

A failure with no measured rate cannot be confirmed fixed. Loop it.

```powershell
# .NET — count failures over N runs of one test
$fail = 0
for ($i = 1; $i -le 200; $i++) {
  dotnet test --filter "FullyQualifiedName~<Test>" --nologo -v q *> "run-$i.log"
  if ($LASTEXITCODE -ne 0) { $fail++ }
}
"failed $fail / 200"

# Frontend — same idea, single spec, no watch
for ($i = 1; $i -le 100; $i++) { npm test -- --run <spec-path> }

# Load-order sensitivity: run the suite in a different order, and alone
dotnet test --filter "FullyQualifiedName~<Namespace>"     # the class alone — passes? shared state
```

Record the rate before and after the fix. "It stopped failing in three runs" is not evidence when
the original rate was one in fifty.

## Step 2 — instrument so the failing run explains itself

Add these before hunting further; keep them if they are genuinely useful, remove them otherwise.

| Add | Why it makes the bug reproducible |
|-----|-----------------------------------|
| A correlation id per operation, logged at every hop | Interleaved runs become separable |
| A high-resolution timestamp on entry and exit | Turns "a race" into an ordering you can read |
| Thread or task identity | Shows two paths in the same critical section |
| The input, serialized, on failure only | Recovers the exact case for a deterministic repro |
| The random seed, when data is generated | Makes a generated-data failure replayable |
| The resolved configuration at startup | Catches "the other machine had another value" |
| Retry attempt number and the reason | Distinguishes one slow call from a real error |

Log to a file, not to the console, when the failure is timing-sensitive: console writes are slow
enough to change the outcome.

## Step 3 — the flake taxonomy

| Symptom | Cause | Fix |
|---------|-------|-----|
| Fails only when the whole suite runs | Shared mutable state: a static, a singleton, a reused database or file | Isolate per test; fresh fixture or transaction per test |
| Fails only in a specific order | One test depends on another writing first | Every test builds its own arrangement |
| Fails under parallel run, passes serially | Two tests on the same resource, port or table | Unique names per test, or a collection that serializes them |
| Passes locally, fails on a slow machine | An assertion on elapsed time, or a fixed sleep | Assert on the condition with a bounded wait, never on a duration |
| Fails around midnight, month end, or DST | `DateTime.Now` in production code | Inject a clock; assert with an explicit instant |
| Fails on some rows and not others | Culture-sensitive parsing, formatting or comparison | Invariant culture at the boundary; explicit comparison rules |
| Fails the first run after a reset | An implicit dependency on data that already exists | Seed it in the arrangement |
| Fails when run in a container only | Path case sensitivity, line endings, a missing local service | See the environment diff below |

## Step 4 — the CI-only case

Fetch the truth first, before guessing:

```powershell
gh run list --limit 5
gh run view <runId> --log-failed                     # only the failing steps
az pipelines runs list --status failed --top 5 --query "[].{id:id,name:definition.name,reason:reason}"
az pipelines runs show --id <runId>
```

When `az pipelines` cannot return the step text, the Azure DevOps MCP build-log capability is the
documented fallback; say which one produced the log.

Then diff the environment. These are the differences that actually cause it:

| Axis | Local | CI | Consequence |
|------|-------|----|-------------|
| Clone | Incremental, plus untracked files | Clean, only committed files | A file never committed, a `.gitignore`d fixture |
| Path case | Case-insensitive | Often case-sensitive | An include or import that only resolves locally |
| Line endings | Whatever `.gitattributes` produced | The other form | Snapshot and hash comparisons fail |
| Locale and time zone | Developer settings | Usually invariant and UTC | Date parsing, formatting, ordering |
| Services | Running containers, a local database | Nothing unless the pipeline starts it | Integration tests hitting nothing (`docker-dev-env`, Testcontainers) |
| Secrets and configuration | User secrets, local settings | Pipeline variables only | A null connection string surfacing as an odd error |
| Cores and memory | Generous | Constrained, throttled | Timing assumptions collapse; parallelism changes |
| Dependency resolution | Warm cache, possibly a stale one | Cold restore, latest matching | A dependency drift nobody chose |

Reproduce, do not iterate on the server: run the failing step inside a container with the same
image, a clean clone and the CI environment variables. Pushing a commit to test a hypothesis costs
minutes per attempt and pollutes the history.

## Rules

1. A flaky test is a bug report about the code or the test, never noise to be retried away.
2. A retry added without an explained mechanism hides the defect; if a retry is genuinely correct
   (a network call), it belongs in production code with a bounded policy, not in the test.
3. `Skip` on a flaky test is a decision with a cost: link it to a work item or delete the test.
4. The fix is proven by the same loop that measured the rate, at the same count.
