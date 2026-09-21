# .NET Aspire, and how it differs from driving compose by hand

Two solutions in this stack have an app host project; every other repository uses compose directly.
The app host is a real .NET project whose `Program.cs` *is* the topology — the local environment is
described in C#, compiled, and type-checked, instead of being described in YAML.

The package versions that decide which APIs exist are in the app host's project file. When an API
name here does not match what the solution has, read that file and confirm against the official
docs (the `microsoft-docs` plugin) rather than guessing at a rename.

## What the app host actually does

```csharp
var builder = DistributedApplication.CreateBuilder(args);

var sql   = builder.AddSqlServer("sql").WithDataVolume().AddDatabase("appdb");
var cache = builder.AddRedis("cache");
var bus   = builder.AddRabbitMQ("bus").WithManagementPlugin();

var api = builder.AddProject<Projects.Api>("api")
    .WithReference(sql)
    .WithReference(cache)
    .WithReference(bus)
    .WaitFor(sql);

builder.AddNpmApp("web", "../web", "start")
    .WithReference(api)
    .WithHttpEndpoint(env: "PORT")
    .WithExternalHttpEndpoints();

builder.Build().Run();
```

Four things happen here that compose does not do:

1. **Containers are started for the backing services.** `AddSqlServer`, `AddRedis`,
   `AddRabbitMQ`, `AddPostgres` each pull an image and run it, with a generated password and a
   generated host port. No compose file, no `.env`.
2. **The .NET projects are started too**, in-process from the solution, with the debugger
   attachable. Compose only ever starts containers.
3. **Connection information is injected.** `WithReference(sql)` puts the real connection string into
   the consuming project's configuration under the resource name, so the application code reads
   `ConnectionStrings:appdb` and nothing has to be configured locally at all.
4. **Telemetry is collected and shown.** Every resource reports logs, traces and metrics to the
   dashboard over OpenTelemetry, so a request can be followed across the web app, the API and the
   broker in one timeline.

## The dashboard is the reason to prefer it

| What it gives                                     | The compose equivalent                                   |
| ------------------------------------------------- | -------------------------------------------------------- |
| Every resource, its state, and its endpoints      | `docker compose ps`, plus reading the file for the ports  |
| Structured logs per resource, searchable          | `docker compose logs`, one service at a time              |
| Distributed traces across services                | nothing — it has to be wired up separately                |
| Metrics per resource                              | nothing                                                   |
| Restart one resource from the UI                  | `docker compose restart`                                  |
| The generated connection string, copyable         | it was in your `.env` already                             |

The traces are the part with no compose answer. A slow endpoint whose time is actually spent in two
sequential broker round-trips is visible in one screen, which is why `debug-systematic` reaches for
the dashboard first on an Aspire solution.

## Where the two differ in kind

| Axis                     | Aspire app host                                  | compose                                        |
| ------------------------ | ------------------------------------------------ | ---------------------------------------------- |
| Topology lives in        | C#, compiled and refactorable                     | YAML, resolved at run time                     |
| Starts the .NET services | yes, debuggable                                   | no (only if you build images for them)         |
| Wiring                   | injected, by resource name                         | you write the connection strings                |
| Ports                    | generated unless pinned                            | you choose, and you own the collisions         |
| Passwords                | generated per run, kept in the user's secret store  | your `.env`                                    |
| Data by default          | **not** persisted unless a data volume is asked for | a named volume you declared                    |
| Non-.NET consumers       | supported, as node/executable/container resources   | native                                        |
| Matches CI or a server   | no — it is a local and deployment-time tool         | yes, the same file can run anywhere            |
| Who else can use it      | needs the .NET SDK and the solution                 | anything that has docker                       |

The two rows that decide most arguments: **data persistence** and **ports**. An Aspire resource
without `WithDataVolume()` starts empty every run, which is excellent for tests and infuriating when
a seeded local database was expected. And generated ports mean a host tool cannot be pointed at the
database ahead of time — pin the port when a GUI client or a script has to attach.

## Running it

```powershell
dotnet run --project .\src\AppHost                # starts everything; the dashboard URL is printed
dotnet run --project .\src\AppHost -- --help      # what the app host itself accepts
docker ps                                         # Aspire's containers, visible like any other
```

The app host needs the container runtime running, exactly like compose — an Aspire solution that
"cannot start SQL Server" is usually a stopped docker engine. Its containers are ordinary
containers, so the triage commands in the parent skill apply unchanged, and so do the client
recipes: `docker exec` into the container Aspire started and use the client inside it.

Two knobs worth knowing before adopting it:

```csharp
builder.AddPostgres("pg").WithDataVolume();                 // survive a restart
builder.AddRedis("cache").WithHostPort(6379);               // a fixed port for host-side tools
builder.AddSqlServer("sql").WithLifetime(ContainerLifetime.Persistent);  // outlive the app host run
```

`ContainerLifetime.Persistent` is the answer to "starting the solution takes forty seconds because
SQL Server boots every time" — the container is left running between app host runs.

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

It is not a deployment tool by itself, and the app host is not what runs in production — production
comes from what the deployment step generates out of it, or from a hand-written manifest. It is also
not a test harness: a test that needs its own database gets a container it owns and disposes of, via
Testcontainers, so the tests do not depend on a running app host (`dotnet-testing`).
