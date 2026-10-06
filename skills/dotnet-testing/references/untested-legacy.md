# The first test in code that has none — the normal case here

The large RPC-heavy backend has **no test projects at all**: no xUnit, NUnit or MSTest anywhere, and
its pipelines carry no test stage on purpose. A change there is verified today by building the
solution, running an Aspire app-host profile that includes the touched service, checking `/health`,
and exercising the changed path by hand — and that verification is stated in the change, not implied.
The realistic goal is not coverage. It is: **the change I am about to make is protected, and the next
person can extend that protection.**

## Order of operations

```
Is the change risky (money, settlement, permissions, data loss, a recurring bug)?
  no  -> verify the house way (build, profile, /health, exercise the path); write the gap down
  yes -> is there a test project for this service tree?
           no  -> create one (below), in the same pull request as the change
         Can the code under test be called without a broker, a database or a host?
           yes -> characterization test, commit it alone, then change the code
           no  -> find a seam (below). Still not testable within the hour?
                    -> sprout the new logic into a new tested class; leave the old one alone
```

Never refactor to make code testable *first*: that is an untested refactor of untested code.

## The seam this codebase hands you for free

Almost every unit of behaviour is an RPC responder or a subscriber: a class implementing the service's
subscriber interface, whose `Subscribe()` registers a **public method** taking the request contract
and returning the response contract. That method *is* the seam.

| Piece | In the test |
| --- | --- |
| the responder method (`Task<TResponse> XxxAsync(TRequest)`) | call it directly with a request built from the `*.ServiceContract` type — no broker |
| `IBus` used for an outgoing `Rpc.RequestAsync` / `PubSub.Publish` | a substitute; assert the outgoing request or the published event |
| a DAO behind an interface | a substitute or a fake for rule logic; a real engine for the SQL itself |
| a context factory creating a `DbContext` inside the method | a real database test — never the in-memory provider |
| the error contract (`IsSuccess`, an error status on the response) | assert it: errors travel as data here, so the response *is* the outcome |
| the bootstrap hosted service and its retry policy | out of scope — framework plumbing |

## Characterization — asserting what *is*

1. Call the method with a realistic input and assert something deliberately wrong.
2. Run it; the failure message carries the actual value. Assert that value.
3. Mark it: `// CHARACTERIZATION: records current behaviour, not intended behaviour.`
4. Cover boundaries, empty, null, the largest realistic case, and one input from real data.
5. Commit the tests **alone**, then change the code. A red test is either the intended change (update
   it in the same commit, so the diff shows the behaviour change) or a regression (stop).

Output too large to assert field by field → a golden master: serialize to indented JSON beside the
test and compare. No timestamps, generated ids, dictionary ordering or culture-dependent formatting
inside it, and regenerated deliberately, never automatically in CI.

## Breaking dependencies without a rewrite

| Obstacle | Smallest honest change | Watch out for |
| --- | --- | --- |
| a concrete class constructed inline | promote it to a constructor parameter, keep a second constructor for callers | do not touch every call site in the same commit |
| a static helper doing I/O | interface plus a default delegating to the static | the static stays for other callers |
| `DateTime.UtcNow`, `Guid.NewGuid()`, `Random` inline | inject a provider | every use must go through it, or the test still flakes |
| configuration read from a static root | bind an options object and inject it | reading configuration in a domain class is the real defect |
| an HTTP client | an interface for the *operation*, not for the client | mocking the raw client makes brittle tests |
| Redis through the cache SDK | the SDK's interfaces (`ICacheAdapter`, `IStreamManager`) are already the seam | assert the key and the TTL, not the serializer |

Each move is mechanical and reviewable, committed separately from the feature.

**Sprout** — new logic in a new tested class, called from one line of the legacy method. **Wrap** —
rename the old method intact, add a new one with the old name calling it plus the new, tested step.
Both leave the untested mass exactly as untested as before; that is the right trade in a codebase of
hundreds of projects.

## Opening the first test project

```powershell
dotnet new xunit -o .\src\<Tree>\tests\<Project>.Tests
dotnet add .\src\<Tree>\tests\<Project>.Tests reference .\src\<Tree>\src\<Project>
dotnet sln <solution file> add .\src\<Tree>\tests\<Project>.Tests   # .slnx works the same way
dotnet test .\src\<Tree>\tests\<Project>.Tests
```

- Put it in the solution, or `dotnet test` and the pipeline never find it and it silently dies.
- In the **same pull request**, add the test step to that tree's build pipeline: the "no test stage"
  rule in `pipeline` holds only while a tree has no tests.
- Keep it a unit lane: no broker, no database. The first slow test teaches everyone to skip the suite.

## Integration host and real database — a note, not a plan

- **Host test**: for an HTTP-facing service, one test that boots the host in memory and calls one
  endpoint catches missing registrations, captive dependencies and bad binding. For a pure RPC
  service, the equivalent is building the service provider and resolving every subscriber.
- **Real database**: a SQL Server container through Testcontainers, migrated with the real
  migrations, reset per test. The in-memory EF provider is not relational and passes queries the real
  engine rejects. The Postgres read cache is tested against a Postgres container, because its SQL has
  no compiler at all.
- Both cost seconds per test and a running container runtime: they earn their place on data-loss and
  money paths, not as the default.

## What to leave alone

| Leave it | Reason |
| --- | --- |
| code you are not changing | tests written for their own sake rot |
| generated code, migrations, snapshots | the generator is the contract |
| a pass-through responder that only forwards to one DAO call | the test asserts the compiler |
| a class scheduled for deletion | test its replacement |
| the whole estate "for coverage" | a number nobody acts on, bought with weeks |

Stop when the next test would cover a path that cannot lose money, leak data or corrupt state, and the
change at hand does not touch it. Write the gap in the change description: a gap that is written down
is a decision, one that is not is an accident.
