# Architecture — ownership, direction, boundaries (rung 3)

Rung 1 still wins: the stack skill's layout table (`dotnet-backend` § Where the code goes) is the
house answer for a .NET service. This file decides what that table leaves open.

## Who owns new code

| The new code | Owner |
| --- | --- |
| changes data | the service and project that own that data; nobody else writes it |
| only reads another service's data | an RPC request or that service's published read model; never its tables |
| reacts to something that happened elsewhere | a subscriber in the reacting service, on an event the owner publishes |
| a rule two services must agree on | the owner computes it and ships the result; the other never re-implements it |
| formatting for one screen or one endpoint | the edge (controller, component), never the domain |
| a cross-cutting concern (retry, logging, auth, validation of input) | the edge or the host composition, once; never repeated per handler |

## Dependency direction

| Rule | Unless |
| --- | --- |
| dependencies point toward contracts and domain, never from domain to infrastructure or host | the neighbours already do otherwise (rung 2): follow, add a `Noticed` row |
| a contracts project references nothing but other contracts and the base library | — |
| no cycle between projects or services, including a cycle made of RPC calls | — |
| a service depends on another's contracts, never on its business or data project | — |

## Sync against async between services

| The caller | Use |
| --- | --- |
| needs the answer to continue | RPC request/response |
| only announces a fact; others decide what to do | an event (publish), handlers idempotent |
| starts long work and comes back later | a command message plus a completion event, never a long RPC timeout |
| needs several services to change together | events with idempotent handlers and a compensating step; never a distributed transaction |

## Shared code across services

| Shared | Verdict |
| --- | --- |
| contract types (requests, responses, events) | yes: one package, additive changes only |
| pure helpers with no domain meaning (string, date, retry policies) | yes, if a shared library already exists; otherwise duplicate |
| business rules, entities, a `DbContext` | no: each service owns its own; duplication is cheaper than lockstep releases |

## When a new project, layer or service

| Signal | Verdict |
| --- | --- |
| a second deployable with its own scaling or release cadence | a new service or host |
| a dependency that must not leak to callers (a driver, a vendor SDK) | a new project behind an interface the callers own |
| "it is cleaner" or "for later" | a folder |
| a layer from a reference architecture the service does not use | not added (rung 2) |

## Contract changes

| Change | Path |
| --- | --- |
| a new optional field, a new message type | additive: ship it |
| rename, remove, retype, make required | a new type or version alongside; old callers keep working; remove the old one once no caller uses it |
| a new value in an enum others switch on | treat as breaking: every consumer must handle it before the producer emits it |
