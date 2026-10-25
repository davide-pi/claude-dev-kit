# deliver bench

Six seeded-bug tasks on the OrdersApi baseline (copied from `evals/code-review/seeded/baseline`, plus a
csproj, `PricingService` and an atomic `TryConfirmAsync`). Each task is one bug and the sentence an owner
would type; a hidden xUnit project is the oracle. Use it to compare `deliver` before and after a change.

| Task | Kind | Seeded in |
| --- | --- | --- |
| `t1-discount` | logic | `PricingService.ApplyPremiumDiscount` subtracts 0.10 instead of 10% |
| `t2-lines` | off-by-one | `OrderService.ComputeTotal` skips the last line |
| `t3-customer-gone` | null path | `ConfirmAsync` dereferences a missing customer |
| `t4-double-confirm` | concurrency / idempotency | check-then-act instead of `TryConfirmAsync` |
| `t5-smtp-down` | error path | notification catch narrowed, SMTP failure escapes |
| `t6-first-page` | cross-file contract | service passes a 0-based page to a 1-based repository |

Every task also runs `RegressionTests` (4 tests that must stay green).

## Layout

- `baseline/` the clean repo; `tasks/<id>.json` the prompt and the find/replace seeds applied to it.
- `hidden/common/` the xUnit project, fakes and regression tests; `hidden/<id>/Oracle.cs` the oracle.
  Never copied into the target until scoring, so the model cannot read it.
- `setup.mjs` builds one target (`node evals/deliver/bench/setup.mjs <task-id> <empty-dir>`), one commit, no hint of the bug in git.
- `results/<label>.jsonl` one line per task and run (generated, not committed).

## Run

```
node tools/bench-deliver.mjs --list
node tools/bench-deliver.mjs --label before --dry-run          # builds targets, prints commands, runs nothing
node tools/bench-deliver.mjs --label before [--tasks t1-discount,t2-lines] [--budget 2] [--timeout-min 30]
node tools/bench-deliver.mjs --label after
node tools/bench-deliver.mjs --compare before after
```

A real run starts `claude -p "<prompt>" --output-format json --max-budget-usd <budget>` in a fresh temp
target, as you, with your installed kit: it costs money (cap per task = `--budget`, default 2). Add or
replace CLI flags with `--claude-args "<flags>"` (default `--permission-mode acceptEdits --allowed-tools
Bash(dotnet:*) Bash(git:*)`), the executable with `--claude-bin`. Keep a target with `--keep`.

Scoring after the run: the hidden project is copied in, `dotnet test --filter Oracle` decides `solved`,
`--filter Regression` decides `regressions` (a red or non-compiling regression run). Tokens (input, output,
cache) and cost come from the CLI JSON. Needs the .NET SDK (net10.0) and NuGet access.

Re-running a label appends; `--compare` uses the last line per task. Use the same model and flags on both
sides, and repeat a label a few times before trusting a delta: one run per task is noisy.
