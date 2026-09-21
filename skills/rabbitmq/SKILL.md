---
name: rabbitmq
description: >-
  RabbitMQ messaging for .NET services: choosing a topology on purpose (exchange type, routing keys,
  queue durability, dead-letter exchanges, TTL and length limits), picking between publish-subscribe,
  request-response and saga and paying the right price for it, consumer-side idempotency and
  deduplication because redelivery is guaranteed, acknowledgements and prefetch, poison messages and
  a retry policy that terminates, the EasyNetQ conventions in use here including why a wrong
  subscription id silently steals messages, and operating a broker through the management HTTP API
  and CLI instead of a UI. Use when publishing or consuming messages, designing a queue or exchange,
  investigating a stuck queue or a dead-letter backlog, or reviewing messaging code.
---

# rabbitmq — topology on purpose, consumers that survive redelivery

RabbitMQ runs in compose in two workspaces; **one** has an application client, EasyNetQ, using
request-response, publish-subscribe and hand-rolled sagas. Everything below assumes at-least-once
delivery, because that is what the broker offers: **every message can arrive twice.**

## When

- Publishing or consuming a message, or adding a new message type.
- Declaring or reviewing an exchange, a queue, a binding, a dead-letter route.
- A queue is growing, a consumer is idle, messages are in an error or dead-letter queue.
- A handler fails and the message comes back forever, or vanishes.
- Choosing between an event, a command, an RPC call and a multi-step process.
- Inspecting or draining a broker without clicking through the management UI.

Not for: the compose service definition (`docker-dev-env`), general async and concurrency in C#
(`dotnet-backend`), Redis pub/sub as a SignalR backplane (`redis-dotnet`), tracing a slow handler
(`dotnet-diagnostics`). Broker-release-specific features (queue types, per-queue options): check
`rabbitmq-diagnostics status` and the official docs rather than assuming.

## Decide

**What shape is this?** Get this wrong and no amount of tuning helps.

| The intent                                          | Shape             | Exchange                       | Price                                                     |
| --------------------------------------------------- | ----------------- | ------------------------------ | --------------------------------------------------------- |
| "This happened" — N interested parties, or none      | publish-subscribe | topic (or fanout)              | no reply, no ordering across consumers; each consumer owns its queue |
| "Do this" — exactly one owner                        | command           | direct, or the default exchange | the owner must exist; a backlog is visible and fine        |
| "I need an answer now"                               | request-response  | direct reply-to                | **caller blocks; both sides must be up.** Latency and availability couple |
| "I need an answer, but not now"                      | command + event   | direct out, topic back          | correlation state to carry                                 |
| Several steps across services, with compensation     | saga              | commands out, events back      | persisted state, timeouts, compensating actions — the most expensive option |
| Work distributed over N identical workers            | competing consumers | any, one shared queue        | no per-consumer ordering                                   |
| Same message needed by two *different* services      | two queues bound to one exchange | topic             | none — this is what an exchange is for                     |

**Never** use request-response for work that takes longer than a caller is willing to wait, and never
put a synchronous HTTP request inside a message handler that holds an unacknowledged message.

**Topology decisions, and the default answer.**

| Decision                | Default here                              | Change it when                                          |
| ----------------------- | ----------------------------------------- | ------------------------------------------------------- |
| Exchange type           | topic — a direct exchange is a topic with no wildcards | fanout for true broadcast; headers almost never |
| Queue durability        | durable                                   | never, for anything that matters                         |
| Message persistence     | persistent                                | a transient metric stream, where loss is acceptable      |
| Publisher confirms      | on                                        | never off in a service that owns data                    |
| Dead-letter exchange    | on every work queue                       | never omit it — without one, a rejected message is gone   |
| Message TTL             | set on retry/delay queues                  | on a work queue only when a stale message is worthless   |
| `x-max-length`          | set on anything unbounded                  | with `x-overflow` chosen deliberately                     |
| Auto-delete / exclusive | only for RPC reply queues                  | never for a work queue                                    |
| Prefetch                | a small number, set explicitly              | 1 for long or heavy handlers                              |

**A message failed. What now?**

| Cause                                      | Action                                                        |
| ------------------------------------------ | ------------------------------------------------------------- |
| Transient (a timeout, a deadlock victim)   | retry with backoff, bounded — a delay queue, not `requeue: true` |
| Permanent (bad payload, missing reference) | reject without requeue → dead-letter, and alert                |
| Unknown                                    | treat as transient, with a hard attempt limit, then dead-letter |
| Already processed                          | acknowledge and do nothing — this is the idempotency check      |
| The handler crashed the process            | the unacked message returns on its own; make sure it is idempotent |

`BasicNack(requeue: true)` on a message that will always fail is an infinite loop that saturates the
consumer — the classic poison-message incident. Requeue is only correct for "not now" (a shutdown, a
dependency that is briefly down), never for "this is broken".

## Do

```powershell
# The management CLI and HTTP API, through the container. No local rabbitmq tools needed.
$c = @('compose','exec','-T','rabbitmq')

docker @c rabbitmqctl list_queues name messages messages_ready messages_unacknowledged consumers
docker @c rabbitmqctl list_consumers
docker @c rabbitmq-diagnostics status          # alarms, memory, disk, listeners
docker @c rabbitmq-diagnostics check_running

# The HTTP API is the scriptable interface (management plugin, default port 15672).
$auth = @{ Authorization = 'Basic ' + [Convert]::ToBase64String(
    [Text.Encoding]::ASCII.GetBytes("$env:RABBIT_USER`:$env:RABBIT_PASS")) }
$base = 'http://localhost:15672/api'

# Queue depth, consumer count and rates, sorted by backlog
(Invoke-RestMethod "$base/queues" -Headers $auth) |
  Select-Object name, messages, messages_ready, messages_unacknowledged, consumers, idle_since |
  Sort-Object messages -Descending | Format-Table

# Peek at a dead-letter queue WITHOUT consuming: reject and requeue what you read
$body = @{ count = 5; ackmode = 'reject_requeue_true'; encoding = 'auto'; truncate = 50000 } | ConvertTo-Json
Invoke-RestMethod "$base/queues/%2F/my.queue.error/get" -Method Post -Headers $auth `
  -ContentType 'application/json' -Body $body
```

**Purging is destructive and irreversible.** `DELETE $base/queues/%2F/<queue>/contents` (or
`rabbitmqctl purge_queue`) deletes every message in the queue. Read a sample first, save what you
need, say out loud what will be lost, and only then purge — never as a first response to a backlog.

## Traps

1. A wrong or copied EasyNetQ subscription id → two different services share one queue and each sees
   half the messages → one id per logical consumer; see `references/easynetq.md`.
2. Durable queue, non-persistent messages → the queue survives a restart, the messages do not → both
   flags, or neither.
3. No dead-letter exchange → a rejected message is silently discarded → declare a DLX on every work
   queue at creation; it cannot be added to an existing queue without recreating it.
4. `requeue: true` on a permanent failure → a hot loop that starves the queue → bounded retry via a
   delay queue, then dead-letter.
5. Unlimited prefetch → one consumer buffers the whole queue, distribution collapses, memory grows →
   set it explicitly, small.
6. A long handler holding an unacked message → the broker's consumer timeout closes the channel and
   redelivers everything in flight → shorten the handler, or raise that broker setting knowingly.
7. Publishing without confirms → the broker rejects or drops and the publisher never knows → confirms
   on, plus `mandatory` and a return handler for unroutable messages.
8. Consumers assumed to run in order → they never do, across instances → carry the ordering in the
   payload, or use one queue and one consumer for the ordered stream.
9. An `IModel`/channel shared across threads → protocol errors and closed channels → one channel per
   consumer or publisher thread, one connection per process.
10. A queue declared with different arguments than it has → `PRECONDITION_FAILED` and a dead channel
    → arguments are immutable; recreate the queue as part of a deployment, deliberately.
11. Publishers suddenly blocked → a memory or disk alarm on the node → `rabbitmq-diagnostics status`
    before touching the application.
12. Retrying inside the handler with `Thread.Sleep` → the message stays unacked and prefetch fills
    with sleepers → delay the *message*, not the thread.

## References

- `references/topology.md` — exchanges, routing keys, durability, dead-letter routes, TTL and length
  limits, and which topology fits which problem.
- `references/patterns.md` — publish-subscribe, request-response and saga: what each costs, and how
  to run a multi-step process without a saga engine.
- `references/consumers.md` — acknowledgements, prefetch, idempotency and deduplication, poison
  messages, and a retry policy that terminates.
- `references/easynetq.md` — the conventions in use here: naming, subscription ids, the error queue,
  and when to drop to the advanced bus.
- `references/operations.md` — the management HTTP API and CLI: queue depth, dead-letter inspection,
  shovelling and purging with care.
