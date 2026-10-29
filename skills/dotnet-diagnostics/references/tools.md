# The diagnostic tools: install, target, collect

For a local process or a host you can reach. Deployed logs, metrics and profiles come from Grafana
through the `ops-analyst` agent, never from these tools and never into the main thread.

None ship with the SDK; install as global tools once.

```powershell
dotnet tool install -g dotnet-counters   # live metrics
dotnet tool install -g dotnet-trace      # event and CPU-sample collection
dotnet tool install -g dotnet-dump       # process dump, plus an offline analysis shell
dotnet tool install -g dotnet-gcdump     # managed heap graph, small and safe in production
dotnet tool install -g dotnet-stack      # every managed thread's stack, right now
dotnet tool install -g dotnet-monitor    # HTTP endpoint that does the above on demand, for containers
dotnet tool install -g dotnet-symbol     # fetch symbols for a dump collected elsewhere

dotnet tool list -g                      # what is already there
dotnet tool update -g dotnet-trace       # when a tool refuses a newer runtime
```

If the tools live in a repository tool manifest: `dotnet tool restore` first, prefix commands with
`dotnet`.

## Which tool answers which question

Escalate in this order; `dotnet-counters` narrows most questions in under a minute and is the only one
you can leave running.

| Question | Tool | Overhead |
|---|---|---|
| CPU, GC, threads, or waiting? | `dotnet-counters monitor` | negligible |
| Which methods burn the CPU? | `dotnet-trace`, CPU sampling profile | low |
| What is allocated, and who holds it? | `dotnet-gcdump` | a pause proportional to heap size |
| What is every thread doing now? | `dotnet-stack report` | brief pause |
| Full post-mortem, locks and object contents | `dotnet-dump collect` then `analyze` | freezes the process; heap-sized file |
| Which HTTP or database calls happened? | `dotnet-trace` diagnostic-source provider, or OpenTelemetry | low |
| Any of the above in a container, on demand | `dotnet-monitor` | a sidecar |

## Targeting a process

```powershell
dotnet-counters ps                                  # .NET processes the tools can see
Get-Process -Name *Api*,*Worker* | Select-Object Id, ProcessName, WS, CPU, StartTime
dotnet-counters monitor --name MyService            # by name, when the pid churns
dotnet-trace collect -- dotnet run --project .\src\<Api>   # launch and trace from the first instant
```

The tools attach through a diagnostic socket: same user (or elevated), same machine. A service under a
different account will not appear in `dotnet-counters ps`. For a startup problem, launching **through**
the tool is the only way to capture the first seconds.

## Counters worth naming

| Provider and counter | Reading it |
|---|---|
| `System.Runtime` CPU usage | the process, not the machine |
| `System.Runtime` GC heap size, allocation rate, gen 0/1/2 count, GC pause time percentage | pause above a few percent means allocation is the problem |
| `System.Runtime` working set | compare with heap size to separate managed from native |
| `System.Runtime` thread-pool thread count and queue length | a queue that does not drain is starvation |
| `System.Runtime` lock contention count | a hot lock, or a lock held across I/O |
| `System.Runtime` exception count | exceptions on a normal path: a large hidden cost |
| `Microsoft.AspNetCore.Hosting` current and total requests, failed requests | is the host even receiving traffic |
| `Microsoft.AspNetCore.Server.Kestrel` current and queued connections | connection-level backpressure |

```powershell
dotnet-counters list                                 # every known provider on this machine
dotnet-counters monitor -p <pid> --counters System.Runtime[cpu-usage,threadpool-queue-length]
dotnet-counters collect -p <pid> --refresh-interval 1 --format csv -o (Join-Path ([IO.Path]::GetTempPath()) counters.csv)
```

## Collecting in a container or a cluster

Best first: (1) **`dotnet-monitor` as a sidecar**, which can trigger automatically on a CPU or memory
threshold (how you catch a 3 a.m. symptom); (2) tools baked into the image, `kubectl exec` and
`kubectl cp` out — collect inside, analyze outside, never open a dump in the pod; (3) a debug sidecar
sharing the process namespace when the image must stay minimal.

```powershell
kubectl exec -it <pod> -- dotnet-counters monitor -p 1
kubectl exec -it <pod> -- dotnet-dump collect -p 1 -o /tmp/proc.dmp
kubectl cp <namespace>/<pod>:/tmp/proc.dmp (Join-Path ([IO.Path]::GetTempPath()) proc.dmp)
docker stats <container>                 # cheapest external view of CPU and memory
docker exec -it <container> dotnet-counters ps
```

The memory limit, not the machine's memory, is what gets the process killed; and a dump is roughly the
heap size, so writing it to a small ephemeral filesystem fails or evicts the pod: write to a mounted
volume.

## Artefacts

| File | Read it with |
|---|---|
| `.nettrace` | the profiling tooling's trace viewer; `dotnet-trace convert --format speedscope` is the fastest route to a flame graph here (needs only a browser) |
| `.gcdump` | the IDE's heap viewer, or compare two for the diff |
| `.dmp` | `dotnet-dump analyze`, the IDE's dump debugger, or a native debugger (`dumps.md`) |
| `counters.csv` | anything that plots |

## Hygiene

Take a baseline while healthy (without one, "high" is an opinion); note timestamp, pid, build and load
beside the artefact; keep the window short and change nothing else; delete dumps when done — a dump is a
secret (connection strings, tokens, customer data), never attached to a work item or PR.
