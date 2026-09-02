# Evidence by stack — the command, and the line that settles it

One row per check. "Accept when" is what has to be in the output; anything less is the third state
("not verified"), regardless of how confident the change feels.

## .NET

| Check | Command | Accept when |
| --- | --- | --- |
| compiles, no new warnings | `dotnet build .\src\Foo\Foo.csproj -warnaserror` | `Build succeeded.` with `0 Warning(s)` and `0 Error(s)` |
| whole solution compiles | `dotnet build .\Foo.sln -warnaserror` | same, and every project listed |
| one test | `dotnet test .\tests\Foo.Tests --filter FullyQualifiedName~Place_NoLines` | `Passed: 1  Failed: 0` and the test name in the output |
| touched project's suite | `dotnet test .\tests\Foo.Tests --logger "console;verbosity=normal"` | `Failed: 0`, and the total higher than before if a test was added |
| everything | `dotnet test .\Foo.sln` | `Failed: 0` across all projects |
| formatting | `dotnet format --verify-no-changes` | exit 0, no files listed |
| a snippet's behaviour, no project | `csharprepl` | the printed value, read — a REPL result is evidence for a probe, never for a change |

Warnings matter: `-warnaserror` turns a nullable or obsolete warning into a failure now instead of
into a pull request comment later. If a repo cannot pass it yet, run plain `build` and diff the
warning **count** against the pre-change count.

## Node, Angular and React

`ng` is not on PATH — always `npx ng`. `jq` is not installed either: parse JSON with
`ConvertFrom-Json` in PowerShell.

| Check | Command | Accept when |
| --- | --- | --- |
| Angular build | `npx ng build` | `Application bundle generation complete` / `Built at` with no `ERROR` lines |
| React or Vite build | `npm run build` | exit 0 and the bundle written; `npm run build 2>&1 \| Select-String -Pattern 'error'` empty |
| type check only | `npx tsc --noEmit` | no output |
| one spec | `npm test -- --watch=false --include '**/order.service.spec.ts'` | `Executed N of N SUCCESS` (or the runner's pass line) with the spec name |
| whole suite | `npm test -- --watch=false` | `0 failed` |
| lint | `npm run lint` | exit 0 |
| the screen actually renders | drive a browser (Playwright, or the Chrome DevTools plugin) | a screenshot of the changed state **plus** an empty console-error list |

A frontend change is not done on a green unit test: the component that compiles and passes can still
fail to render. The browser step is the row, not an extra.

## SQL Server and EF Core

| Check | Command | Accept when |
| --- | --- | --- |
| what the migration will do | `dotnet ef migrations script --idempotent --project .\src\Data --startup-project .\src\Api -o .\migration.sql` | the file read end to end; every `DROP`, `ALTER COLUMN`, `TRUNCATE` hit accounted for |
| scan the script | `Select-String -Path .\migration.sql -Pattern 'DROP |ALTER COLUMN |TRUNCATE '` | each hit deliberate — a hit on a column holding data stops the change |
| pending migrations | `dotnet ef migrations list --project .\src\Data --startup-project .\src\Api` | the new migration present, marked pending before update and applied after |
| apply locally | `dotnet ef database update --project .\src\Data --startup-project .\src\Api` | `Done.` with no exception |
| schema landed | `sqlcmd -S localhost -d AppDb -Q "SELECT name, system_type_name FROM sys.dm_exec_describe_first_result_set('SELECT * FROM dbo.Orders', NULL, 0)" -W` | the new column, with the intended type and nullability |
| data survived | `sqlcmd -S localhost -d AppDb -Q "SELECT COUNT(*) FROM dbo.Orders" -W` | the count read **before** the update, unchanged |
| the query the code will run | `sqlcmd -S localhost -d AppDb -Q "SET STATISTICS IO ON; <query>" -W` | the plan and reads seen, not assumed |

Take the row count **before** applying anything destructive-looking. A count taken only afterwards
proves nothing.

## Docker, compose and Kubernetes

Postgres and Redis clients are not installed. Reach them through the container:
`docker compose exec db psql -U postgres -d app -c "select 1"`,
`docker compose exec cache redis-cli ping`.

| Check | Command | Accept when |
| --- | --- | --- |
| compose file valid | `docker compose config` | the merged file printed, no error |
| stack actually up | `docker compose ps` | every expected service `running`, and `healthy` where a healthcheck exists |
| a service's own view | `docker compose logs --tail 50 <svc>` | startup completed, no repeating exception |
| image builds | `docker compose build <svc>` | build succeeded, and the tag written |
| manifest applied | `kubectl apply -f .\k8s\deploy.yaml --dry-run=server` then without the flag | server-side dry run clean first, then `configured`/`created` |
| running state matches | `kubectl get deploy <name> -o jsonpath='{.spec.template.spec.containers[0].image}'` | the image, replica count or env var the change intended |
| rollout finished | `kubectl rollout status deploy/<name> --timeout=120s` | `successfully rolled out` |

Editing a manifest or a compose file is not a config change being done — it is a config change being
written. The evidence comes from the target.

## HTTP endpoints and Azure DevOps

| Check | Command | Accept when |
| --- | --- | --- |
| endpoint answers as intended | `Invoke-WebRequest -Uri http://localhost:5000/api/orders -Method Post -ContentType application/json -Body '{}' -SkipHttpErrorCheck \| Select-Object StatusCode, Content` | the status code **and** the body shape the change specified |
| response field present | `(Invoke-RestMethod -Uri http://localhost:5000/api/orders/1).total` | the value, not `$null` |
| the build the change will run in | `az pipelines runs list --top 3 --query "[].{id:id,result:result}" -o table` | `succeeded` on the run built from the pushed commit |
| pull request checks | `gh pr checks` | every required check `pass` |

A green local suite plus a red pipeline is not done. If the change is pushed, the pipeline result is
part of the evidence.

## When the tool is missing

| Missing | Substitute | Says nothing about |
| --- | --- | --- |
| `psql`, `redis-cli` | `docker compose exec` into the container | anything if the container is not the same version as the target |
| a staging environment | run the service locally against a compose stack | production data volume or configuration |
| load | one request timed, plus the query plan | behaviour under concurrency |
| a human eye on UI | screenshot at the used viewport widths | taste, and anything below the fold not captured |

Substitutes are reported as substitutes. Naming what a proxy does not cover is the difference between
an honest gap and a false claim.
