# Architecture: layered, Clean, or neither

## Dependency direction is the whole point

Whatever the layout, arrows point one way. A layer may know the layer below and nothing above it.
The moment `Domain` references the data-access project, the architecture is decorative.

| Layout | Projects | Arrows |
|---|---|---|
| Layered | `Api`, `Services` (or `Business`), `Data`, `Common` | Api → Services → Data → Common |
| Clean | `Api`, `Application`, `Domain`, `Infrastructure` | Api → Application → Domain; Infrastructure → Application, Domain |
| Flat | one project, folders | none to get wrong |

In Clean, `Application` declares the interfaces (`IOrderRepository`, `IClock`, `IEmailSender`) and
`Infrastructure` implements them, so the arrow into the database is inverted and `Application` can be
tested with no database at all. That inversion is the only reason Clean costs more than layered — if
nobody ever substitutes those interfaces, you paid for nothing.

Verify the arrows mechanically rather than by reading:

```powershell
Select-String -Path (Get-ChildItem -Recurse -Filter *.csproj).FullName -Pattern 'ProjectReference'
```

## Where each kind of logic goes

| Logic | Layered | Clean |
|---|---|---|
| HTTP parsing, status codes, routes | `Api` | `Api` |
| Input validation (shape, ranges, required) | `Api` (validators) | `Api` or `Application` (validators) |
| Use-case orchestration, transaction boundary | `Services` | `Application` handler |
| Business invariants (a rule that must always hold) | `Services`, or the entity | `Domain` entity or value object |
| Persistence, queries, external HTTP, brokers, files | `Data` | `Infrastructure` |
| Mapping entity to DTO | `Services` or `Api` | `Application` |
| Cross-cutting: logging, retries, caching | middleware or decorators | middleware, pipeline behaviours |

The transaction boundary is one use case. One HTTP request equals one unit of work; the endpoint
opens it, the application service owns it, and nothing below it commits on its own.

## When neither is worth it

Skip layering when all three hold: the whole component fits in one head, it has no domain rules worth
protecting (it moves data, it does not decide anything), and no second consumer is coming. Scheduled
jobs, webhook receivers, integration shims and admin tools usually qualify. Give them one project
with folders, and keep the I/O behind one interface so a test can stub it.

Skip it also when the existing code is layered badly: adding a correct Clean slice next to a broken
layered one gives you two architectures and no wins. Change locally, behind tests.

## Working inside a large untested layered estate

The realistic case here: a microservices estate of many projects with almost no tests. Rules:

1. Do not restructure. Every folder move is a merge conflict for someone and buys nothing.
2. Find the seam. A seam is where you can change behaviour without editing the code under test — a
   constructor parameter, an interface already injected, a virtual method. If the class news up its
   dependencies, the smallest honest change is extracting a constructor parameter.
3. Sprout, do not grow. New logic goes in a new class with its own tests, called from the old one, so
   the new code is covered even though the caller is not.
4. Wrap when you must change existing behaviour: rename the old method, write a new one with the old
   name that calls it plus the new step. The diff stays readable and reviewable.
5. Add one characterization test before touching anything: it asserts what the code does today, not
   what it should do. It is the only safety net you will get. See `dotnet-testing`.

## Vertical slices inside either layout

Folder by feature, not by kind, wherever you have the freedom to choose:

```
Application/Orders/PlaceOrder/{PlaceOrderCommand,PlaceOrderHandler,PlaceOrderValidator}.cs
```

A change touches one folder instead of five. This works in layered code too — `Services/Orders/…`
beats `Services/Interfaces` plus `Services/Implementations`, which forces every change into two
distant folders and hides which interface has one implementation (most of them).

## Does a mediator earn its place

| Signal | Verdict |
|---|---|
| The solution already uses one | use it, follow its conventions |
| You want pipeline behaviours (validation, logging, transactions) once for every use case | yes |
| Endpoints would otherwise inject six services each | yes |
| You want "loose coupling" between your own layers | no — the project reference is already there |
| Handlers calling handlers calling handlers | no — that is a call stack with the stack trace removed |

Only one solution here uses a mediator. Do not introduce one into a solution that does not, and never
route internal helpers through it: cross-layer indirection you cannot follow in the IDE is a cost, not
a decoupling.

## Does a mapping library earn its place

Use one only for flat DTOs whose members match by name, and only where the solution already has one
(one does). Everything else is hand-written, because:

- a rename silently stops mapping and the compiler says nothing;
- conditional or computed members become configuration nobody reads;
- projecting straight into a DTO inside the query is both faster and clearer than loading an entity
  and mapping it afterwards. See `ef-core`, `querying.md`.

If a library is in use, add a test that asserts the configuration is valid, so a rename fails a test
instead of a customer.

## The shape of a service that is easy to test

- Dependencies arrive through the constructor, all of them, as interfaces or delegates.
- No `DateTime.UtcNow`, `Guid.NewGuid()`, `Environment`, `File`, `HttpContext` or static singletons
  inside the logic — inject a clock, an id generator, an abstraction.
- One public method per use case, returning a value, not `void`.
- No `static` mutable state anywhere, ever: it makes tests order-dependent and the service unsafe.
- Configuration arrives as a bound options object, not as an injected configuration root, so the test
  passes a plain instance.
- It does not know it is in a web request: no ambient context reads, no `Task.Run`, no fire-and-forget.

A class that needs a host, a database and a clock rewind to be tested is a class that will not be
tested. That is the whole rationale, not aesthetics.

## Aspire, where it orchestrates the solution

Two solutions are orchestrated by Aspire: the app host project wires services, databases and brokers,
and passes connection strings in as configuration. Consequences for architecture:

- Service code keeps reading plain named connection strings — do not reach for host APIs in a service.
- The dashboard gives traces and metrics for free; see `dotnet-diagnostics`, `telemetry.md`.
- Run the app host, not the individual services, or half the dependencies will be missing.
