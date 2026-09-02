# Topology — decided once, immutable afterwards

## The parts

A publisher never knows a queue. It publishes to an **exchange** with a **routing key**; the
exchange's **bindings** decide which queues receive a copy. That indirection is the whole point: a
new consumer is a new queue and a new binding, with no change to the publisher.

| Exchange type | Routes by                                       | Use for                                                 |
| ------------- | ----------------------------------------------- | ------------------------------------------------------- |
| `topic`       | routing-key pattern with `*` (one word) and `#` (zero or more) | the default choice — a direct exchange is a topic without wildcards |
| `direct`      | exact routing-key match                          | commands to a single known owner                         |
| `fanout`      | ignores the key; every bound queue gets a copy   | true broadcast, e.g. a cache-invalidation signal         |
| `headers`     | header value matching                            | almost never; a topic key is cheaper and readable        |
| default (`""`)| the queue's own name as the key                   | quick point-to-point; avoid in application code because it hides the binding |

## Routing keys

Design them as a hierarchy, most stable segment first, so a consumer can subscribe to a level it
cares about without knowing the rest:

```text
order.created.it        order.cancelled.it        payment.failed.card
<entity>.<event>.<qualifier>

order.*        every order event, one qualifier deep
order.#        every order event, at any depth
*.failed.#     every failure anywhere
```

Rules that pay for themselves: past tense for events (`order.created`), imperative for commands
(`order.cancel`), never put a mutable value (an id, a tenant) in the key unless consumers really
bind per value, and never encode a payload field a consumer could read from the body.

## Durability — four switches, all of them needed

| Switch                       | Without it                                                       |
| ---------------------------- | ---------------------------------------------------------------- |
| Durable **exchange**          | the exchange disappears on restart; publishes then fail or vanish |
| Durable **queue**             | the queue disappears on restart, bindings with it                 |
| **Persistent** messages       | messages are lost on restart even in a durable queue               |
| **Publisher confirms**        | the publisher cannot tell whether the broker accepted the message  |

All four, or the guarantee is nothing. Persistence costs a disk write per message; a stream of
metrics may legitimately opt out, a business event never does.

Two more that catch people: `mandatory` on publish plus a returned-message handler is the only way to
learn that a message routed **nowhere** (a missing binding is otherwise a silent hole), and an
**alternate exchange** on the exchange catches unroutable messages centrally instead of per
publisher.

## Queue arguments

Set at declaration and **immutable**. Declaring the same queue with different arguments fails with
`PRECONDITION_FAILED` and kills the channel, so a change means a new queue name or a deliberate
delete-and-recreate in a deployment step.

| Argument                  | Effect                                                                 |
| ------------------------- | ---------------------------------------------------------------------- |
| `x-dead-letter-exchange`  | where rejected, expired and over-limit messages go                      |
| `x-dead-letter-routing-key` | overrides the key on dead-lettering — how a retry loop routes back     |
| `x-message-ttl`           | per-message lifetime in this queue; the engine of the delay pattern      |
| `x-expires`               | delete the queue after it is unused for this long (RPC reply queues)     |
| `x-max-length` / `x-max-length-bytes` | cap the backlog                                             |
| `x-overflow`              | `drop-head` (lose the oldest), `reject-publish` (push back on the publisher) |
| `x-single-active-consumer` | one consumer at a time, so a queue can be processed in order            |
| `x-queue-type`            | the queue implementation; which values exist depends on the broker release — check `rabbitmqctl list_queues name type` |
| `x-delivery-limit`        | broker-side redelivery cap, dead-lettering after N attempts (queue-type dependent) |

An unbounded queue is a memory and disk incident waiting for a consumer outage. Either cap it and
choose the overflow behaviour, or monitor its depth with an alert — never neither.

## Dead-letter routes

A message is dead-lettered when it is rejected without requeue, when its TTL expires, when the queue
overflows, or when a broker-side delivery limit is hit. The `x-death` header records the reason and
the count — read it before deciding anything.

```text
orders.exchange (topic) --order.created--> orders.created.q
                                              |  reject(requeue: false)
                                              v
orders.dlx (topic) --order.created--> orders.created.error.q   (no consumer; alerted on depth)
```

Give each work queue its **own** error queue rather than one shared bucket: a shared error queue
loses the routing information that says which handler failed, and makes replay all-or-nothing.

An error queue with no consumer is correct — it is an inbox for a human. What it must have is an
alert on its depth and a documented replay path.

## Delayed retry with TTL plus a dead-letter route

The broker has no native "redeliver in 30 seconds". The standard construction uses a wait queue
whose only job is to expire:

```text
work.exchange --job--> work.q         (DLX: retry.exchange)
retry.exchange --job--> retry.30s.q   (x-message-ttl: 30000, DLX: work.exchange)
```

Reject a failed message without requeue: it dead-letters to `retry.30s.q`, sits there for the TTL,
expires, and dead-letters back onto `work.exchange`. One wait queue per delay tier (a few seconds,
tens of seconds, minutes) gives exponential backoff. Count the attempts from the `x-death` header
and dead-letter to the error queue past the limit — see `consumers.md`.

Caveat: a queue's TTL applies per queue, and messages leave in order, so a single wait queue holding
mixed delays makes a short delay wait behind a long one. Separate queues per tier, not per-message
TTLs on one queue. A delayed-message exchange plugin exists as an alternative; check whether it is
enabled (`rabbitmq-plugins list`) before designing around it.

## Which topology for which problem

| Problem                                                    | Topology                                                                |
| ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| One event, several independent reactions                   | topic exchange, one durable queue **per consumer service**, each bound   |
| One event, work split across N identical workers           | one queue, N consumers (competing consumers), prefetch set              |
| A command with exactly one owner                           | direct exchange, one queue, the owner declares it                        |
| A slow job triggered by a request                          | command out, event back; never RPC                                       |
| A stream several late consumers must replay                | a stream-type queue, or an event store — a classic queue has no replay    |
| Ordered processing of one entity's events                  | route by entity to one queue, single active consumer, prefetch 1          |
| A message that must not be processed before a point in time | a delay tier as above, or the scheduler                                  |
| A fan-out where a consumer may be absent for days          | durable queue bound in advance — an unbound message is gone, not stored   |

The last row is the one that surprises people: RabbitMQ stores messages in **queues**, not in
exchanges. A consumer that does not exist yet receives nothing unless its queue and binding already
exist. Declare consumer queues at deployment, not at first connect.
