# EasyNetQ — the conventions in use here, RPC first

EasyNetQ derives exchange names, queue names and routing keys from the **message type**, so the
topology is implicit — convenient until a name collides, and then the failure is silent. In the large
backend RPC is the normal inter-service call: request/respond outnumbers subscribe by roughly ten to
one. Detect the client version from the project files, never assume it — the API surface moved
between major releases.

## How a service is wired here

| Piece | Shape | Consequence |
| --- | --- | --- |
| the bus | a per-service factory calling `RabbitHutch.CreateBus(connectionString, register => …)`, registering a Serilog adapter for the library's logger | one bus per process; a service talking to several logical brokers holds a named bus collection |
| the connection string | `host=…;timeout=120;requestedHeartbeat=0`, nothing else set | RPC callers wait **two minutes** before failing (that is the committed appsettings value — confirm the deployed one); heartbeats are off, so a half-open connection is noticed late; confirms, persistence and prefetch are the library defaults |
| responders and subscribers | classes implementing the service's subscriber interface; `Subscribe()` calls `Rpc.RespondAsync<TReq,TResp>` or `PubSub.SubscribeAsync<T>` | auto-registered from the assembly; each class is one handler |
| startup | a bootstrap hosted service loops the subscribers under a Polly decorrelated-jitter retry and **does not await** the result | a responder that never manages to subscribe logs and gives up while the service reports healthy |
| contracts | request, response and event types in a `*.ServiceContract` project referenced by both sides | the CLR type *is* the queue name: rename or move one and the two sides stop meeting |
| errors | responses carry their own outcome (`IsSuccess`, an error status, an error message) | a business failure is data, never an exception across the wire |

## RPC — what actually happens

```
caller: bus.Rpc.RequestAsync<TReq, TResp>(req [, c => c.WithExpiration(t)])
  -> published to the RPC exchange, routing key = request type, expiration = the timeout
  -> responder queue (named after the request type) -> RespondAsync handler -> reply queue
  <- caller's task completes with TResp, or fails
```

| Situation | What the caller sees | Do |
| --- | --- | --- |
| responder answers in time | `TResp` | check its outcome fields — success is not implied |
| responder returns an error **as data** | `TResp` with the error status | the house contract: map it, do not throw |
| responder handler **throws** | an `EasyNetQResponderException` carrying only the message text — type and stack stay on the responder | never rely on it: catch inside the responder and return the error as data |
| no responder subscribed (service down, failed bootstrap, renamed contract) | nothing for the whole timeout — 120 s in the committed config — then a cancellation/timeout exception | check the request queue's consumer count before reading code (`operations.md`) |
| responder slow | the same timeout; the late reply is discarded, the work **was still done** | the operation must be idempotent, or the caller must be able to ask "did it happen" |
| per-call deadline | `WithExpiration(...)` on the request | set it shorter for user-facing calls; never longer than the HTTP request awaiting it |

Rules that follow:

1. **Every RPC caller handles the timeout.** An unhandled one surfaces as a 500 two minutes later,
   after the user has retried — so the responder may run twice.
2. **Responders never throw for a business outcome**; the exception message is all that crosses.
3. **Contracts change additively.** Add properties; never rename or move a type during a rolling
   deploy — both sides must run the same name. A breaking change is a new request type, served in
   parallel until every caller has moved.
4. **No RPC chain longer than it must be.** Each hop multiplies the timeout budget; a chain of three
   hops can block a caller for six minutes.
5. **A missing responder looks like slowness.** The first check is the consumer count on the request
   queue, the second the responder service's startup log for exhausted subscribe retries.

Following a request across services hop by hop is the `investigator` agent's trace mode: it maps
`RequestAsync` → `RespondAsync` → onward publishes with `file:line` at each step.

## Publish-subscribe — the subscription id trap

`PubSub.SubscribeAsync<T>(subscriptionId, handler)` builds the queue name from the type **and** the id.
Here the id is a literal naming the handler, with a per-product suffix plus `WithTopic(...)` when one
event type is split by product.

| Situation | Result |
| --- | --- |
| one service, N instances, same id | one queue, N competing consumers — correct scaling |
| two different services, same id (copy-paste) | one shared queue: each sees about half the messages and neither notices |
| an id per instance (machine name) | a queue per instance: every instance handles every message |
| the id changed in a deploy | a new empty queue; the old one keeps filling with nobody consuming it |

One id per logical consumer, constant across instances and deploys, never generated at runtime. When
a subscription is retired, delete its queue — an abandoned bound queue grows until it takes the node's
memory with it.

## Errors and the error queue

A subscriber handler that throws is moved by the error strategy to an **error queue** with the
original message and the exception in the body. It has no consumer by design: alert on its depth, and
replay with `Hosepipe` only after confirming the handler is idempotent. A custom consumer error
strategy is the extension point for "classify, then retry or dead-letter" (`principles.md`).

## When to drop to the advanced bus

`IAdvancedBus` declares exchanges, queues and bindings explicitly, with arguments, and consumes with
manual acknowledgement. Use it for a dead-letter exchange, TTL or length limit on a queue, a queue name
not derived from a type, header access, or a queue someone else declared. Declare each queue in
exactly one place, at startup — declaring it from both APIs with different arguments is the
`PRECONDITION_FAILED` channel death.

## Reviewing EasyNetQ code

| Check | Failure if missing |
| --- | --- |
| the caller handles the RPC timeout and inspects the response's outcome fields | a 500 after two minutes; a failure read as success |
| the responder catches and returns errors as data | only a message string crosses; the caller cannot branch |
| the request/response types live in the shared contract project, changed additively | a rename splits the topology mid-deploy |
| `WithExpiration` on user-facing RPC calls | the HTTP request outlives its own client |
| no RPC call inside a subscriber holding an unacked message | two queues stall on one slow responder |
| subscription id constant, per logical consumer | stolen or duplicated messages |
| handlers async, non-blocking, idempotent | heartbeat-free connections die quietly; duplicates on replay |
| the bus resolved as a singleton | a connection per unit of work |
