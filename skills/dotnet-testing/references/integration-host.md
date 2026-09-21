# Integration tests against a real ASP.NET host

The web-application test factory boots the real application in memory — real routing, real model
binding, real filters and middleware, real DI graph — and hands you an `HttpClient` that talks to it
without a socket. No port, no process, no deployment.

## What only this proves

| Verified here | Not verified by a unit test |
|---|---|
| The route template actually matches the request | a direct call bypasses routing entirely |
| Model binding and the automatic validation response | you called the method with a valid object |
| Authorization policies and authentication handlers | attributes are inert when you call the method |
| Middleware order, exception mapping, ProblemDetails shape | none of the pipeline runs |
| The DI graph resolves — no captive dependency, no missing registration | you passed the constructor yourself |
| Serialization of the response, including naming and enums | you asserted on the object, not the JSON |
| Configuration binding from the real sources | you built the options in the test |

That last-but-one point is the cheapest high-value test in an untested service: one request to one
endpoint proves the whole container and pipeline stand up. Write it before anything else.

## Setting one up

1. Reference the integration-testing package for the web framework in the test project, plus a
   project reference to the API project. The API project's startup class must be reachable — a
   partial `Program` class or an explicit type argument is the usual way.
2. Derive from the factory and override the host configuration to swap what the test must control.
3. Expose the client from a class or collection fixture so the host is built **once** per collection,
   not once per test. Booting a host per test is the single biggest cause of a slow suite.

## Replacing services for a test

Override the service configuration in the derived factory, and remove before adding: adding a second
registration for an interface leaves the original in place and the last one wins only for a single
resolution, while an enumerable injection then gets both.

| Replace | With | Why |
|---|---|---|
| An outbound HTTP client | a stub message handler | no network in tests, and you control the responses |
| A broker publisher | a fake that records messages | assert what would have been published |
| A clock | a controllable clock | deterministic timestamps and expiry logic |
| An authentication handler | a test scheme that signs in a known principal | test authorization without real tokens |
| A payment or e-mail gateway | a fake | obvious |
| The database | **nothing** | use a real one in a container; see `real-database.md` |

Do not replace the application's own services. Replacing an application service to make a test pass
means the test no longer exercises the code you shipped.

## Configuration and environment

Override configuration in the factory rather than shipping a test settings file that must stay in
sync with production's. Set the environment name explicitly so a Development-only branch does not
change behaviour under test — and be aware that a Development-only exception page will hide the
exception mapping you meant to assert.

If the host reads a secret at startup, provide it in the test's in-memory configuration. A test that
depends on a developer's user-secrets store fails on the build agent.

## Authentication and authorization

Two workable approaches, in order of preference:

1. A test authentication scheme registered in the factory that always succeeds and issues a principal
   the test dictates: claims, roles, tenant. Lets one test assert 403 and another 200 on the same
   endpoint by varying the claims only.
2. A real token minted with test signing keys, when the point of the test **is** the token handling.

Never disable authorization globally in the test host: every authorization test then passes for the
wrong reason, and the one endpoint missing its attribute goes unnoticed forever.

## Asserting on responses

- Assert the status code first, and on failure include the response body in the message — otherwise a
  400 tells you nothing and you re-run with a debugger.
- Deserialize with the same options the API uses, or a naming-policy mismatch will look like a bug.
- Assert on the contract (status, headers, the fields a client reads), not on the whole payload. A
  test that pins every field turns every additive change into a red suite.
- Where a request writes, assert the effect through a **fresh** scope and a fresh context, not through
  the objects the request tracked. Reading back from the same change tracker proves nothing.

## Shape of a suite that stays maintainable

- One fixture that owns the host and the database container; one collection that shares it.
- A base test class exposing the client, a scope factory, and a helper to reset data per test.
- Request helpers per endpoint group so a route change is one edit, not thirty.
- Traits marking these tests as integration, so the fast lane can exclude them (`suite-speed.md`).

## What to test at this level, and what not to

Integration tests are expensive; spend them on the paths that matter. Per endpoint: one happy path,
one authorization failure, one validation failure. Everything else — every business branch, every
edge case — belongs in unit tests against the application service, which run in milliseconds. A suite
that drives every business rule through HTTP will take minutes and be abandoned.
