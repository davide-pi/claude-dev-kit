# Perf baseline — measure before the change, compare the same way after

A speed claim is a ratio between two measurements taken the same way. The baseline comes **before the
first edit**; one taken afterwards, or on another day or machine, proves nothing.

## The rules

| Rule | Why |
| --- | --- |
| baseline first, saved in the plan file: command, input, machine, every run's number | the "after" run must repeat it exactly |
| same machine, same build configuration (Release), same data, nothing else heavy running | a different box is a different experiment |
| N ≥ 3 runs, N = 5 when the spread is wide; keep each run, not only the mean | the spread is part of the result |
| result = **ratio** (after / before) **and spread** (min–max or standard deviation of both sides) | a mean alone hides noise |
| a ratio inside the spread is inconclusive | report "no measurable change", never an improvement |
| a regression in another path of the perimeter is a finding, even when the target improved | speed bought with a slower sibling is a trade, and the user decides |

## .NET code: BenchmarkDotNet

Use it for a method or a small pipeline. One benchmark class, the **current** implementation marked as
the baseline, and a statistical test so the verdict is not eyeballed.

```csharp
[MemoryDiagnoser]
[StatisticalTestColumn(StatisticalTestKind.Welch, ThresholdUnit.Percentage, 5)]   // 5 % threshold
public class OrdersQueryBenchmarks
{
    [Benchmark(Baseline = true)] public List<Order> Current() => _legacy.Load(_ids);
    [Benchmark]                  public List<Order> Changed() => _query.Load(_ids);
}
```

```powershell
dotnet run -c Release --project .\bench\Orders.Bench -- --filter "*OrdersQueryBenchmarks*" --exporters json
```

Read from the output: the `Ratio` column (Changed against the baseline), `Error` / `StdDev`, the
`Welch(5%)` column (`Faster`, `Slower` or `Same`), and `Allocated`. Save the exported JSON path in the
plan file. Before the edit the "changed" method does not exist: take the baseline as a single-benchmark
run three times, save the numbers, and add the comparison once both exist.

## An HTTP endpoint: per-request timing

For a service, time requests against a local instance started the same way each run, warmed up first.

```powershell
# warm-up, then 3 runs of 200 sequential requests; per-request milliseconds, p50 and p95
1..20 | ForEach-Object { Invoke-WebRequest -Uri http://localhost:5000/api/orders -UseBasicParsing | Out-Null }
$runs = 1..3 | ForEach-Object {
  $t = 1..200 | ForEach-Object { (Measure-Command { Invoke-WebRequest -Uri http://localhost:5000/api/orders -UseBasicParsing | Out-Null }).TotalMilliseconds } | Sort-Object
  [pscustomobject]@{ run = $_; p50 = $t[99]; p95 = $t[189] }
}
$runs | Format-Table
```

A load tool (`bombardier`, `k6`) replaces the loop when the question is concurrency; the rules above
hold unchanged: same command, at least 3 runs, per-run numbers kept. Time the request only, never the
build or the start-up.

## Database queries

The query run through the same client before and after, three times, with `SET STATISTICS IO, TIME ON`:
**logical reads** are the stable number, elapsed time the noisy one. Report both, and the plan operator
that changed (`evidence-by-stack.md`).

## The result, as it goes in the verdict

```text
| perf | bombardier ... x3 | p50 41 ms -> 33 ms (ratio 0.80, spread 40-42 / 32-34) | fatto |
```

Worse than the baseline, or inside the spread → the loop restarts, or the user is asked: **accept**,
**another round**, **change approach**.
