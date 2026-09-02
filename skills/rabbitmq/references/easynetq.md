# EasyNetQ — the conventions in use here

EasyNetQ is an opinionated layer over the RabbitMQ client: it derives exchange names, queue names
and routing keys from the **message type**, so the topology is implicit. That is convenient until a
name collides, and then the failure is silent. Know the conventions.

## Registration and the connection string

```csharp
services.AddEasyNetQ(cfg.GetConnectionString("Rabbit")!);   // one bus per process, singleton
```

```text
host=localhost;virtualHost=/;username=app;password=<from-secret-store>;
publisherConfirms=true;persistentMessages=true;prefetchcount=10;timeout=20;product=orders-api
```

| Setting              | Why it is set explicitly                                                     |
| -------------------- | ---------------------------------------------------------------------------- |
| `publisherConfirms`  | without it a publish is fire-and-forget against the broker                     |
| `persistentMessages` | keep it on; combined with durable queues it is the only survivable setup       |
| `prefetchcount`      | the library's default applies to every consumer; set it deliberately            |
| `timeout`            | the RPC and connection timeout, in seconds                                     |
| `product` / `platform` | shows up in `CLIENT LIST`-equivalent connection listings — set it per service |
| `virtualHost`        | the cheapest isolation between two applications on one broker                   |
| `password`           | never a literal in a committed file — user secrets, environment, or a vault      |

The bus is a **singleton**: it owns the connection and the channels. Resolve `IBus` from DI; never
construct one per handler or per request.

## What the conventions produce

| API                                              | Exchange                          | Queue                                     |
| ------------------------------------------------ | --------------------------------- | ----------------------------------------- |
| `bus.PubSub.Publish<OrderCreated>(msg)`          | topic exchange named after the type (namespace, type name and assembly) | none — the publisher declares no queue |
| `bus.PubSub.Subscribe<OrderCreated>("billing", h)` | the same exchange                 | `<type-name>_billing` bound to it          |
| `bus.PubSub.Publish(msg, "it.north")`            | the same exchange, routing key `it.north` | subscribers filter with `WithTopic("it.*")` |
| `bus.SendReceive.Send("orders.import", cmd)`     | the default exchange              | the named queue `orders.import`            |
| `bus.Rpc.Request<Req, Resp>(req)`                | an RPC exchange plus a reply queue | `<type>` request queue, transient reply     |
| `bus.Scheduler.FuturePublishAsync(delay, msg)`   | depends on the scheduler in use    | check which scheduler is configured        |

Because names derive from the **CLR type**, renaming or moving a message class renames the exchange
and the queue. During a rolling deploy the two names coexist and neither side talks to the other. So:
message contracts live in a shared assembly, in a namespace nobody refactors casually, and a rename
is a deliberate migration with both subscriptions running.

## The subscription id — the trap that steals messages

`Subscribe<T>(subscriptionId, handler)` builds the queue name from the type **and** the id.
Therefore:

| Situation                                                     | Result                                                          |
| ------------------------------------------------------------- | --------------------------------------------------------------- |
| One service, N instances, **same** id                          | one queue, N competing consumers — correct horizontal scaling     |
| Two **different** services, same id (copy-paste)               | one shared queue: each service receives roughly half the messages and neither notices |
| Two subscriptions in the same process, same type, same id      | the same queue subscribed twice — handlers compete, order is arbitrary |
| Different ids per instance (e.g. the machine name)             | one queue **per instance**: every instance handles every message, so the work runs N times |
| Id changed in a deploy                                         | a new empty queue; the old one keeps filling with nobody consuming it, unbounded |

Rules: **one id per logical consumer**, derived from the service and the purpose
(`billing`, `orders-projection`), constant across instances, constant across deploys, and never
generated at runtime. When a subscription is retired, delete its queue — an abandoned bound queue
grows until it takes the node's memory with it.

The symptom to recognise: "half the messages are missing" or "the handler only fires sometimes".
List the queues (`operations.md`) and look for one queue with two unexpected consumers, or for two
queues where you expected one.

## Error handling and the error queue

A handler that throws is retried by the consumer's error strategy; by default the message is
republished to an **error queue** with the original message, its properties and the exception in the
body. The default queue name is a single shared one, and `Hosepipe` is the companion tool that dumps,
inspects and republishes its contents.

What to do with that default:

- Keep the error queue **per consumer**, not shared, by customising the conventions or the error
  strategy — a shared bucket loses which handler failed and makes replay all-or-nothing.
- Alert on its depth. It has no consumer by design.
- Do not implement retry by catching and rethrowing in a loop inside the handler: use the delay-tier
  construction in `topology.md`, or a bounded retry in the error strategy.
- A custom `IConsumerErrorStrategy` is the correct extension point for "classify, then retry or
  dead-letter" — see the policy in `consumers.md`.
- Republishing from the error queue re-runs the handler: everything in `consumers.md` about
  idempotency applies double here, because a replay is a deliberate duplicate.

## When to drop to the advanced bus

`IAdvancedBus` gives explicit control: declare exchanges, queues and bindings with arguments, publish
with your own `MessageProperties`, consume with manual acknowledgement.

Use it when the simple API cannot express the topology:

| Need                                                    | Simple API | Advanced bus |
| ------------------------------------------------------- | ---------- | ------------ |
| Dead-letter exchange, TTL, max length, delivery limit on a queue | no  | yes          |
| A queue name that is not derived from the type           | no         | yes          |
| Manual ack / nack decisions in the handler               | no         | yes          |
| Reading or setting headers, `message_id`, priority       | limited    | yes          |
| Binding one queue to several routing keys                | limited    | yes          |
| Consuming a queue somebody else declared                 | no         | yes          |
| Straightforward type-based publish-subscribe             | yes        | unnecessary  |

Mixing both in one service is normal: the simple API for ordinary events, the advanced bus for the
work queues that need dead-lettering and retries. What is not normal is declaring the same queue from
both with different arguments — that is the `PRECONDITION_FAILED` channel death. Declare each queue
in exactly one place, at startup, and let the subscribers attach to it.

## Reviewing EasyNetQ code

| Check                                                              | Failure if missing                        |
| ------------------------------------------------------------------ | ----------------------------------------- |
| `IBus` resolved as a singleton                                     | a connection per unit of work              |
| Subscription id constant, per logical consumer, not per instance    | stolen or duplicated messages              |
| `publisherConfirms` and `persistentMessages` on                     | silent message loss                        |
| `prefetchcount` set, and small for heavy handlers                   | one consumer hoards the queue               |
| Every work queue has a dead-letter route (advanced bus)             | rejected messages discarded                 |
| Handlers are async and do not block                                 | heartbeat loss, closed connections          |
| Handlers are idempotent                                            | duplicates on every redelivery and replay   |
| Message contracts in a shared assembly, additive changes only        | a rename splits the topology mid-deploy     |
| No RPC call inside a message handler                                | a stalled handler holding an unacked message |
