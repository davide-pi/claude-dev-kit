# The diagnostic tools: install, target, collect

None of these ship with the SDK. Install them as global tools once; they then work against any .NET
process on the machine.

```powershell
dotnet tool install -g dotnet-counters   # live metrics, no overhead worth worrying about
dotnet tool install -g dotnet-trace      # event and CPU-sample collection
dotnet tool install -g dotnet-dump       # process dump, plus an offline analysis shell
dotnet tool install -g dotnet-gcdump     # managed heap graph, small and safe in production
dotnet tool install -g dotnet-stack      # every managed thread's stack, right now
dotnet tool install -g dotnet-monitor    # HTTP endpoint that does the above on demand, for containers
dotnet tool install -g dotnet-symbol     # fetch symbols for a dump collected elsewhere

dotnet tool list -g                      # what is already there
dotnet tool update -g dotnet-trace       # when a tool refuses a newer runtime
```

If the tools live in a repository's tool manifest instead, `dotnet tool restore` first and prefix the
commands with `dotnet`.

## Which tool answers which question

| Question | Tool | Overhead |
|---|---|---|
| Is it CPU, GC, threads, or waiting? | `dotnet-counters monitor` | negligible |
| Which methods burn the CPU? | `dotnet-trace` with the CPU sampling profile | low, sampled |
| What is allocated, and who holds it? | `dotnet-gcdump` | a pause proportional to heap size |
| What is every thread doing right now? | `dotnet-stack report` | brief pause |
| Full post-mortem, including locks and object contents | `dotnet-dump collect` then `analyze` | freezes the process; file is heap-sized |
| Which HTTP or database calls happened? | `dotnet-trace` with the diagnostic-source provider, or OpenTelemetry | low |
| Any of the above, in a container, on demand | `dotnet-monitor` | it is a sidecar |

Escalate in that order. `dotnet-counters` answers or narrows most questions in under a minute, and it
is the only one you can leave running.

## Targeting a process

```powershell
dotnet-counters ps                                  # .NET processes the tools can see
Get-Process -Name *Api*,*Worker* | Select-Object Id, ProcessName, WS, CPU, StartTime
dotnet-counters monitor --name MyService            # by name, when the pid churns
dotnet-trace collect -- dotnet run --project .\src\<Api>   # launch and trace from the first instant
```

The tools attach through a diagnostic socket owned by the target process, so they must run as the
same user (or elevated) and on the same machine. A service running under a different account will
simply not appear in `dotnet-counters ps`.

For a startup problem, launching the process **through** the tool is the only way to capture the
first seconds — attaching is always too late.

## Counters worth naming

| Provider and counter | Reading it |
|---|---|
| `System.Runtime` CPU usage | the process, not the machine |
| `System.Runtime` GC heap size, allocation rate, gen 0/1/2 count, GC pause time percentage | pause above a few percent means allocation is the problem |
| `System.Runtime` working set | compare with heap size to separate managed from native |
| `System.Runtime` thread-pool thread count and queue length | a queue that does not drain is starvation |
| `System.Runtime` lock contention count | a hot lock, or a lock held across I/O |
| `System.Runtime` exception count | exceptions on a normal path, and a large hidden cost |
| `Microsoft.AspNetCore.Hosting` current and total requests, failed requests | is the host even receiving traffic |
| `Microsoft.AspNetCore.Server.Kestrel` current connections, queued connections | connection-level backpressure |
| The EF and ADO providers' counters, and any custom meter | list what a process exposes with `dotnet-counters list` |

```powershell
dotnet-counters list                                 # every known provider on this machine
dotnet-counters monitor -p <pid> --counters System.Runtime[cpu-usage,threadpool-queue-length]
dotnet-counters collect -p <pid> --refresh-interval 1 --format csv -o counters.csv
```

## Collecting in a container or a cluster

Three workable paths, best first:

1. **`dotnet-monitor` as a sidecar.** Its HTTP endpoint collects dumps, traces and gcdumps on demand
   and can trigger automatically on a CPU or memory threshold — which is how you catch a symptom that
   only appears at three in the morning.
2. **Tools baked into the image.** Then `kubectl exec` and run them inside; copy artefacts out with
   `kubectl cp`. Collect inside, analyze outside — never open a dump inside the pod.
3. **A debug sidecar sharing the process namespace**, when the image must stay minimal.

```powershell
kubectl exec -it <pod> -- dotnet-counters monitor -p 1
kubectl exec -it <pod> -- dotnet-dump collect -p 1 -o /tmp/proc.dmp
kubectl cp <namespace>/<pod>:/tmp/proc.dmp .\proc.dmp
docker stats <container>                 # cheapest external view of CPU and memory
docker exec -it <container> dotnet-counters ps
```

Two container facts that mislead: the memory limit is what gets you killed, not the machine's memory,
and a dump file is roughly the size of the heap — writing it into a small ephemeral filesystem will
fail or evict the pod. Write dumps to a mounted volume.

## Artefacts and where to read them

| File | Read it with |
|---|---|
| `.nettrace` | the trace viewer that ships with the profiling tooling; convert with `dotnet-trace convert --format speedscope` for a browser-based flame graph |
| `.gcdump` | the IDE's heap viewer, or compare two of them for the diff |
| `.dmp` | `dotnet-dump analyze`, the IDE's dump debugger, or a native debugger (`dumps.md`) |
| `counters.csv` | anything that plots; the shape over time is the point |

`dotnet-trace convert --format speedscope` is the fastest route to a readable flame graph on this
machine, since it needs only a browser.

## Hygiene

- Take a baseline while the service is healthy. Without one, "high" is an opinion.
- Note the timestamp, the pid, the build and the load at collection time in the same folder as the
  artefact. A trace with no context is unusable a week later.
- Keep the collection window short and the process untouched otherwise; changing two things at once
  destroys the evidence.
- Delete dumps when done — they contain connection strings, tokens and customer data in plain bytes.
  Treat a dump as a secret, never attach one to a work item or a pull request.
