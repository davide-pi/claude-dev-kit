# Consumers — acknowledgements, prefetch, idempotency, poison messages

## Acknowledgement is the contract

The broker keeps a delivered message until the consumer acknowledges it. That single fact defines
every guarantee available.

| Mode                                | Guarantee        | Consequence                                                  |
| ----------------------------------- | ---------------- | ------------------------------------------------------------ |
| `autoAck: true`                     | at-most-once     | the message is gone the moment it is delivered; a crash loses it. Only for a disposable stream |
| Manual ack **after** the work        | at-least-once    | a crash mid-handler redelivers it — the correct default        |
| `BasicNack(requeue: true)`          | at-least-once    | back to the head of the queue, immediately. Only for "not now" |
| `BasicNack(requeue: false)`         | —                | dead-letters it (or discards it if no DLX exists)             |
| Ack **before** the work              | at-most-once     | a lie: the message is lost on failure. Never                   |

There is no exactly-once delivery. There is at-least-once delivery plus an idempotent consumer, and
that combination is what "exactly once" means in practice.

## Prefetch

Prefetch (`BasicQos(0, n, false)`) is how many unacknowledged messages the broker will hand one
consumer. It is a per-channel window, and leaving it unset means unlimited.

| Value        | Behaviour                                                                     |
| ------------ | ----------------------------------------------------------------------------- |
| unset / 0    | the broker pushes the whole queue at one consumer: memory grows, other consumers starve, and a restart redelivers everything |
| 1            | strictly one at a time — correct for long or heavy handlers, and for ordered processing |
| small (5–20) | keeps the pipeline full for fast handlers without hoarding                     |
| large (100+) | only for very fast, very uniform handlers; it destroys fair distribution        |

Rule of thumb: prefetch × handler duration is how long a consumer holds work that another idle
consumer could be doing. Fair distribution matters more than raw throughput in almost every case
here, so start small and raise it with a measurement.

Watch `consumer_utilisation` in the management API: below 1 the consumer is waiting for messages
(raise prefetch or add producers); a full queue with utilisation at 1 means the handler is the
bottleneck, and prefetch will not help.

## The consumer timeout

The broker gives a consumer a bounded time to acknowledge a delivery. Exceed it and the channel is
closed and everything in flight is redelivered — which looks exactly like a mysterious duplicate
storm. Two legitimate answers:

1. Shorten the handler: acknowledge as soon as the work is durably recorded, and continue
   asynchronously from that record.
2. Raise the broker's `consumer_timeout` knowingly, in the broker configuration, and write down why.

Never hold an unacknowledged message across a long external call, a retry sleep, or a batch import.

## Threading

One connection per process; **one channel per consumer or publisher thread**. A channel is not
thread-safe: sharing one across threads produces protocol errors and closed channels that look like
broker faults. Acknowledge on the same channel that delivered the message — a delivery tag is
meaningless on another channel.

Heartbeats travel on the connection, so a handler that blocks the I/O thread can make the broker
declare the connection dead. Keep handlers off the connection's threads and keep them async.

## Idempotency and deduplication

**Redelivery is guaranteed to happen** — on a crash, on a consumer timeout, on a rebalance, on a
network blip. The consumer, not the broker, is responsible for the outcome.

Ranked by preference:

| Approach                                                       | Notes                                                        |
| -------------------------------------------------------------- | ------------------------------------------------------------ |
| **Naturally idempotent work** — an upsert, a set-to-value, a guarded state transition (`UPDATE ... WHERE Status = @expected`) | no bookkeeping at all. Design for this first |
| **A unique constraint** on a business key                      | the database rejects the duplicate; catch the violation and acknowledge |
| **A processed-message table**: message id + handler name, unique index, written in the **same transaction** as the effect | the general solution; a separate transaction reintroduces the race |
| A cache-based dedup check                                      | best-effort only; a cache miss is a duplicate. Acceptable for cosmetic side effects |
| "Check whether it already happened" without a constraint       | a race, not a solution                                        |

The message needs a stable identity for any of this: publishers set a `message_id` (or a business
correlation id) and never regenerate it on a retry. A republished message with a fresh id defeats
every deduplication scheme downstream.

Side effects that are not database writes — sending an e-mail, charging a card, calling another
service — need the same treatment through an idempotency key passed to that system, or a record
written before the call and checked after.

## Poison messages and a retry policy that terminates

A poison message fails every time. Left with `requeue: true` it becomes a hot loop that consumes the
consumer and hides every other message behind it.

The policy, in full:

1. Classify the failure. **Transient** (a timeout, a deadlock victim, a 503, a closed connection) →
   retry. **Permanent** (deserialisation failure, a validation error, a missing referenced entity,
   any 4xx that is not 429) → do not retry, dead-letter immediately with the reason.
2. Retry **out of band**: reject without requeue into a delay tier, so the consumer is free while the
   message waits. Never `Thread.Sleep` in the handler, and never requeue for an immediate retry.
3. Count attempts from the `x-death` header (the dead-letter count per queue) or from an explicit
   header the handler increments. Do not count in memory.
4. Back off across tiers: a few seconds, tens of seconds, minutes. Three to five attempts total is
   almost always enough; if the dependency is down longer than that, a retry loop is the wrong tool.
5. Past the limit, dead-letter to the queue's **own** error queue, with the exception and the attempt
   count in the headers.
6. **Alert on error-queue depth.** An error queue nobody watches is a delete with extra steps.
7. Document the replay path: how a fixed message goes back to the work queue, and who decides.

```csharp
// The shape, independent of the client library
try
{
    await handler(message, ct);
    channel.BasicAck(tag, multiple: false);
}
catch (Exception ex) when (IsTransient(ex) && AttemptsSoFar(props) < MaxAttempts)
{
    channel.BasicNack(tag, multiple: false, requeue: false);   // → delay tier → back to work queue
}
catch (Exception ex)
{
    log.LogError(ex, "poison message {MessageId}", props.MessageId);
    channel.BasicNack(tag, multiple: false, requeue: false);   // → error queue (attempts exhausted)
}
```

Two details the shape hides: the delay tier and the error queue are **different** dead-letter routes,
so the handler decides which by publishing to the right retry exchange rather than relying on one
DLX; and the catch-all must never swallow the failure and acknowledge, because a silently dropped
message is worse than a dead-lettered one.

## Shutdown

On shutdown, stop consuming first, then let in-flight handlers finish, then close the channel and the
connection. Killing the process mid-handler is safe **because** the message is unacked and idempotent
— which is another reason both properties are non-negotiable.
