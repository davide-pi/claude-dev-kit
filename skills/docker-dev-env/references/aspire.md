# .NET Aspire, and how it differs from driving compose by hand

Two solutions in this stack have an app host project; every other repository uses compose directly.
The app host's `Program.cs` *is* the topology.

The package versions that decide which APIs exist are in the app host's project file. When an API
name here does not match what the solution has, read that file and confirm against the official
docs (the `microsoft-docs` plugin) rather than guessing at a rename.

## The app host in the large backend — what it does and does not do

| Fact | Consequence |
| --- | --- |
| it starts the .NET service projects only, each with `WithHttpHealthCheck("/health")` | SQL Server, Postgres, Redis and RabbitMQ are **not** containers it owns: they come from each service's configuration (user secrets, environment variables) pointing at instances that already exist |
| a profile, chosen with the `ASPIRE_PROFILE` environment variable, selects which services start — from the full set down to minimal per-flow sets | start the smallest profile containing the service you changed; read the profile list in the app host's `Program.cs` |
| the solution's old compose file describes services that no longer exist | the app host is the source of truth for the live topology; do not "fix" the compose file to run the stack |
| the dashboard collects every service's logs and traces | the first place to look locally, before `docker logs` or a debugger |

```powershell
$env:ASPIRE_PROFILE = '<profile>'          # unset → the full set
dotnet run --project .\src\orchestration\<AppHost project>
```

A solution whose app host does own its backing services (`AddSqlServer`, `AddRedis`, …) gets containers
with generated passwords and ports, and injects connection strings by resource name.

## Where the two differ in kind

| Axis                     | Aspire app host                                  | compose                                        |
| ------------------------ | ------------------------------------------------ | ---------------------------------------------- |
| Ports                    | generated unless pinned                            | you choose, and you own the collisions         |
| Data by default          | **not** persisted unless a data volume is asked for | a named volume you declared                    |
| Matches CI or a server   | no — it is a local and deployment-time tool         | yes, the same file can run anywhere            |

An Aspire resource without `WithDataVolume()` starts empty every run. Generated ports mean a host tool
cannot be pointed at the database ahead of time: pin the port (`WithHostPort`) when a GUI client or a
script has to attach. `WithLifetime(ContainerLifetime.Persistent)` leaves the container running between
app host runs.

The app host needs the container runtime running, like compose: an Aspire solution that "cannot start
SQL Server" is usually a stopped docker engine. Its containers are ordinary containers, so the triage
commands in the parent skill and the client recipes apply unchanged.

## Choosing

Pick **Aspire** when the solution already has an app host (never shadow it with a second compose
stack), when the value is in seeing traces across services, or when onboarding should be one
command with nothing to configure.

Pick **compose** when only the backing services are wanted and the app runs from the IDE, when a
non-.NET consumer or a script needs the same stack, when the local layout has to mirror what a
server or a build agent runs, or when exact control over images, ports, volumes and networks
matters.

Never both at once for the same solution: two SQL Servers on one port, and the application connects
to whichever won the race. If a solution is mid-migration between the two, keep the compose file but
strip it to the services the app host does not own, and say so in a comment at the top of the file.

## What Aspire is not

It is not a deployment tool by itself, and the app host is not what runs in production. It is also
not a test harness: a test that needs its own database gets a container it owns and disposes of, via
Testcontainers, so the tests do not depend on a running app host (`dotnet-testing`).
