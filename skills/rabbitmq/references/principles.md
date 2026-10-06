# Messaging principles — the few that decide incidents

At-least-once is all the broker offers: **every message can arrive twice, late, or out of order.**
Everything below follows from that.

## Shape before tuning

| Intent | Shape | Price |
| --- | --- | --- |
| "I need an answer now" | RPC (the norm here) | caller blocks; both sides must be up; latency and availability couple |
| "This happened" — N interested parties, or none | publish-subscribe | no reply; each subscriber owns its queue |
| "Do this" — exactly one owner | command to a named queue | the owner must exist; a visible backlog is fine |
| "I need an answer, not now" | command out, event back | correlation state to carry |
| Several steps with compensation | hand-rolled saga: commands out, events back, persisted state | timeouts and compensations are yours — there is no saga engine |
| N identical workers | competing consumers on one queue | no ordering across workers |

Never use RPC for work longer than the caller will wait, and never make an RPC call from inside a
handler that holds an unacknowledged message — one slow responder then stalls two queues.

## Durability — four switches, all needed

Durable queue **and** persistent messages **and** publisher confirms **and** a dead-letter route.
Durable queue with transient messages survives a restart empty; confirms off means a dropped publish
is never known; no dead-letter route means a rejected message is gone. Queue arguments are immutable:
declaring an existing queue with different ones is `PRECONDITION_FAILED` and a dead channel —
declare each queue in exactly one place.

## Acknowledgement, prefetch, threads

| Rule | Why |
| --- | --- |
| ack after the work is committed, never before | a crash between ack and commit loses the message |
| prefetch set explicitly and small; 1 for heavy handlers | unlimited prefetch lets one consumer hoard the queue and the memory |
| handlers async and short | a long handler hits the broker's consumer timeout and everything in flight is redelivered |
| one channel per consumer or publisher thread, one connection per process | a shared channel produces protocol errors and closed channels |
| ordering carried in the payload, never assumed | across instances consumers never run in order |

## Idempotency — the only defence against redelivery

| Technique | Use when |
| --- | --- |
| a natural key with a unique constraint, insert-or-ignore | the message creates something |
| a processed-message table keyed by message id, in the same transaction as the effect | the effect is not naturally idempotent |
| a version or state check in the `UPDATE`'s `WHERE` | the message moves a state machine |
| "already processed" → ack and do nothing | always the first branch of the handler |

A replay from an error queue is a deliberate duplicate: idempotency is what makes it safe.

## Failure handling that terminates

| Cause | Action |
| --- | --- |
| transient (timeout, deadlock victim, dependency briefly down) | bounded retry with backoff — a delay queue (TTL + dead-letter back), not `requeue: true` |
| permanent (bad payload, missing reference) | reject without requeue → dead-letter, and alert |
| unknown | treat as transient with a hard attempt limit, then dead-letter |
| the process crashed | the unacked message returns by itself — which is why idempotency is mandatory |

`requeue: true` on a message that will always fail is the classic poison-message hot loop.
`Thread.Sleep` inside a handler is the same mistake slower: delay the message, not the thread. Alert
on dead-letter and error-queue depth — nothing consumes them by design.
