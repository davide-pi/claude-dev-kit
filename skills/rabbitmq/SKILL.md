---
name: rabbitmq
description: >-
  Use when code calls RequestAsync, RespondAsync, PublishAsync or SubscribeAsync, a ServiceContract
  type changes, an RPC times out, or a queue backs up or dead-letters.
paths: "**/*ServiceContract*/**,**/*Responder*.cs,**/*Subscriber*.cs,**/*Consumer*.cs"
---

# rabbitmq — RPC is the norm here; design for the timeout and the duplicate

**Contract.** Bus code that survives a timeout and a duplicate, and broker state read without
changing it · never purges, consumes, deletes or requeues while investigating · explanations in
Italian, queue names, counts and exceptions verbatim.

## When

- Writing or reviewing a `RequestAsync`/`RespondAsync` pair, a publish, or a subscriber.
- Adding or changing a type in a `*.ServiceContract` project.
- An RPC call times out or never gets an answer; a queue grows, a consumer idles, messages dead-letter.

Not for: reaching the broker container (`docker-dev-env`), DI and async in C# (`dotnet-backend`),
Redis Streams used as a work queue (`dotnet-backend`, its redis reference).

## Decide

The backend talks over RabbitMQ through EasyNetQ, and **RPC is the default call** (about ten
request/respond pairs per subscription). Two facts shape everything: an RPC caller blocks until an
answer or the timeout, and at-least-once delivery means **every message can arrive twice**.

### Where is the flow — never a grep job for the main thread

| Question | Route |
| --- | --- |
| which service answers this request / handles this event | `investigator` agent, `locate` |
| what happens end to end when X is called (the hop map) | `investigator` agent, `trace` |
| what the broker holds right now | `references/operations.md` |

### RPC, event, or command

| The intent | Shape | Price |
| --- | --- | --- |
| an answer is needed to continue, within seconds | RPC | caller blocks; responder must be up; a per-call deadline on user-facing paths |
| "this happened", zero or more listeners | publish-subscribe | no answer; each subscriber owns its queue and is idempotent |
| an answer is needed, but not now; the work outlives a request | command out, event back | correlation state to carry — the honest replacement for a long RPC |
| several steps with compensation | hand-rolled saga | persisted state and timeouts are yours |

### The two rules every handler obeys

| Rule | Because |
| --- | --- |
| the caller catches the timeout and returns a clean failure | otherwise a 500 arrives minutes later, after the user retried |
| every responder and subscriber is idempotent (same input twice → one effect) | redelivery, a replayed error queue and a timed-out-but-done RPC all repeat work |

### An RPC call failed — which case

| Symptom | Cause | First check |
| --- | --- | --- |
| hangs the full timeout (120 s in the committed appsettings — confirm the deployed value) | no responder: down, failed bootstrap, or the contract type renamed | consumer count on the request queue |
| `EasyNetQResponderException` | the responder threw; only the message crossed | the responder's logs; errors must be data |
| a response with an error status | a business outcome, by design | map it; it is not an exception |
| times out but the effect happened | responder slower than the deadline; the reply was discarded | idempotency, and a shorter `WithExpiration` upstream |

### A contract or a subscription changes

| Change | Rule |
| --- | --- |
| a request, response or event type | additive only; the type name is the routing key, so a rename or move strands every caller → a breaking change is a new type served in parallel; find every user first (Do) |
| a subscription id | unique per service and stable across deploys: a copied id splits messages between two services, a changed id leaves the old queue filling forever |
| a subscriber's failure | transient → bounded retry, then dead-letter; permanent → reject without requeue, dead-letter, alert; already processed → ack, do nothing |

## Do

```powershell
# Before changing a contract: every caller and responder of the type
Get-ChildItem -Recurse -Filter *.cs | Select-String '(Request|Respond|Publish|Subscribe)Async<\s*<Type>\b' |
  Select-Object Path, LineNumber
Get-ChildItem -Recurse -Filter appsettings*.json | Select-String 'host=.*timeout='   # RPC timeout in force

# Broker state: rabbitmqctl lives inside the container — read-only
docker exec <container> rabbitmqctl list_queues --vhost <vhost> name messages messages_ready messages_unacknowledged consumers
docker exec <container> rabbitmqadmin -V <vhost> get queue=<name> count=1 ackmode=reject_requeue_true   # peek only
```

## Traps

1. `requeue: true` on a permanent failure → the poison-message hot loop → reject without requeue.
2. The bootstrap retry gave up on a subscriber → "healthy" service, missing responder → read the
   startup log; `/health` does not check subscriptions.
3. An RPC call inside a subscriber holding an unacked message → one slow responder stalls two queues.
4. `requestedHeartbeat=0` → a half-open connection is seen only by the OS → after a network blip,
   suspect the connection before the code.
5. A work queue with no dead-letter route → a rejected message is silently gone.
6. Publishers block with no error → a memory or disk alarm on the node → `rabbitmq-diagnostics status`.
7. A chain of RPC hops → each adds a full timeout budget → collapse it, or turn the tail into events.

## References

- `references/easynetq.md` — the bus wiring here, RPC semantics, exceptions across the wire, shared
  contracts, the error queue, the advanced bus, a review checklist.
- `references/principles.md` — shape choice, durability switches, acks and prefetch, idempotency, a
  retry policy that terminates.
- `references/operations.md` — the broker-state procedure: health, depth, bindings, a
  non-destructive peek, the report, replay, the guardrails.
