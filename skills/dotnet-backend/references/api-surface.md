# The API surface: controllers and minimal APIs

Controllers dominate this estate; minimal APIs with an `Endpoints` folder appear in the two newest
solutions. Both are legitimate. Mixing them inside one solution is not — a reader then has to guess
where an endpoint lives, and cross-cutting concerns must be wired twice.

## The rule that applies to both

An endpoint does exactly four things: bind and validate input, call one application service or
handler, map the outcome to a status code, and return. Anything else belongs below it.

| Symptom in an endpoint | What it means |
|---|---|
| A `DbContext` or a repository injected | the data layer leaked one level up |
| An `if` on a business condition | a domain rule escaped |
| A `try/catch` per action | error mapping should be one middleware, not N |
| Ten constructor dependencies | it is orchestrating; move the orchestration down |
| `HttpContext` read below the action | untestable, and wrong in a background job |

## Controllers

- Attribute routing only. Convention-based routes make a route un-greppable.
- The API controller behaviour that turns model-state failures into automatic 400 ProblemDetails is
  what makes controllers concise — do not suppress it and then hand-roll the same response.
- Return a typed action result, so the compiler tells you which shapes an action can produce and the
  OpenAPI document is right without extra attributes.
- Filters are the controller-side cross-cutting tool: authorization, action-level logging, response
  shaping. Keep them stateless or scoped-resolved; a filter is not the place for per-request state.
- A base controller is fine for a correlation id or a current-user accessor, harmful the moment it
  holds business helpers, because every controller then depends on all of them.

## Minimal APIs

- One file per endpoint group, an extension method that maps the routes, called from startup. That
  is what the `Endpoints` folder is for; do not put fifty lambdas in the startup file.
- The handler body is a **named static method**, not an inline lambda, whenever it has more than one
  statement. That single habit makes the endpoint unit-testable without a host, keeps the mapping
  block readable as a routing table, and gives stack traces a real method name.
- Group related routes so the prefix, authorization and filters are declared once for the group.
- Return the typed results helper, not raw status codes, so the response shape is discoverable.
- Endpoint filters are the minimal-API equivalent of action filters; validation is a natural one.

## Validation with FluentValidation

FluentValidation is used widely here. Placement:

| Kind of check | Where |
|---|---|
| Required, length, range, format, cross-field shape | a validator on the request DTO, run at the edge |
| "Does this id exist", "is this code unique" | the application service, as part of the use case |
| "An order cannot ship twice" | the domain entity, enforced in the method that changes state |

Run validators through the pipeline (an endpoint filter, an action filter, or a mediator behaviour) —
one wiring for the whole application — and return a field-level ProblemDetails. Do not call
`ValidateAndThrow` inside handlers: it turns validation into exception-driven flow control and makes
the failure indistinguishable from a bug in the logs.

Validators that need a database query are doing use-case work in the wrong place. Move that check
into the handler where the transaction is, or accept a race you cannot fix in the validator.

## Errors on the wire

- ProblemDetails for every non-success response, so clients parse one shape.
- One exception-handling middleware maps exception types to status codes; endpoints do not catch.
- Never leak exception messages, stack traces or SQL text to a caller outside Development. The
  correlation id goes to the client, the detail goes to the log. See `dotnet-diagnostics`.
- Validation failures list every offending field at once, not the first one.

## Versioning

Only version when an external consumer exists that you cannot deploy with you. Then pick one scheme —
URL segment is the easiest to route, cache and grep — and keep the version at the routing edge:
handlers and services stay unversioned, with an adapter per old shape. Two full copies of a service
because of a version is a maintenance debt that never gets repaid.

## Keeping either style testable

| Goal | Controllers | Minimal APIs |
|---|---|---|
| Unit-test the logic | test the application service; the action is a two-liner not worth a test | same — the named handler method is directly callable |
| Test binding, filters, auth, routes | integration test against the test host | integration test against the test host |
| Avoid a host in unit tests | never touch `HttpContext` below the action | pass what you need as parameters, not the accessor |

The dividing line: anything the framework does (routing, binding, model validation, authorization,
content negotiation) is only really verified through the in-memory test host. Anything you wrote is
verified by calling it directly. See `dotnet-testing`, `integration-host.md`.

## Cross-cutting order that bites

Middleware order is behaviour, not style. Two orderings cause most of the surprises:
authentication must come before authorization, and the exception handler must be outermost or the
error responses it produces will be skipped. When a request behaves as if a middleware were absent,
check the order before you check the middleware.

## Long-running work

An endpoint must not do work the caller does not wait for. `Task.Run` in an endpoint loses the work
on shutdown and hides the exception. Options, in order of preference: a queued background service, a
Quartz job (this estate schedules with Quartz), or a broker message. The endpoint returns 202 with a
way to poll for the result.
