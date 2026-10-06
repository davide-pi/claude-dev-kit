---
name: rabbitmq
description: >-
  Use whenever code calls RequestAsync, RespondAsync, PublishAsync or SubscribeAsync, a message
  contract changes, an RPC call times out or gets no responder, a queue backs up or dead-letters, or
  the broker's state must be inspected without the UI.
---

# rabbitmq — RPC is the norm here; design for the timeout and the duplicate

The large backend talks service-to-service over RabbitMQ through EasyNetQ, and **RPC is the default
call**: request/respond outnumbers subscribe by about ten to one. Two facts shape everything below —
an RPC caller blocks until an answer or a two-minute timeout, and at-least-once delivery means
**every published message can arrive twice.**

## When

- Writing or reviewing a `RequestAsync`/`RespondAsync` pair, a publish, or a subscriber.
- Adding or changing a request, response or event type in a `*.ServiceContract` project.
- An RPC call times out, hangs for minutes, or a responder never answers.
- A queue is growing, a consumer is idle, messages sit in an error or dead-letter queue.
- Inspecting the broker from the command line, or replaying failed messages.
- Following a flow that crosses several services over the bus.

Not for: the compose service or reaching the broker's CLI (`docker-dev-env`), general async and DI in
C# (`dotnet-backend`), a slow handler's internals (`dotnet-diagnostics`), Redis Streams, which some
services use as a work queue next to the bus (`redis-dotnet`). Broker-release features: check
`rabbitmq-diagnostics status` and the official docs rather than assuming.

## Decide

**Where is the flow?** Locating code that spans services is not a grep job for the main thread.

| Question | Route |
| --- | --- |
| "Which service answers this request / handles this event?" | `investigator` agent, locate mode |
| "What happens end to end when X is called?" — the hop map | `investigator` agent, trace mode |
| "What is the broker holding right now?" | `references/operations.md`, the procedure |

**RPC, event, or command?**

| The intent | Shape | Price |
| --- | --- | --- |
| an answer is needed to continue, within seconds | RPC | caller blocks; responder must be up; set a per-call deadline for user-facing paths |
| "this happened", zero or more listeners | publish-subscribe | no answer; each subscriber owns its queue and must be idempotent |
| an answer is needed, but not now; or the work outlives a request | command out, event back | correlation state to carry — the honest replacement for a long RPC |
| several steps with compensation | hand-rolled saga | persisted state and timeouts are yours |

**An RPC call failed. Which case is it?** (details in `references/easynetq.md`)

| Symptom | Cause | First check |
| --- | --- | --- |
| hangs for the full RPC timeout (120 s in the committed appsettings — confirm the deployed value), then a timeout/cancellation exception | no responder subscribed — down, failed bootstrap, or the contract type renamed | consumer count on the request queue |
| `EasyNetQResponderException` | the responder threw; only the message crossed | the responder's own logs — its handler must return errors as data |
| a response with an error status | a business outcome, by design | map it; it is not an exception |
| times out but the effect happened | responder slower than the deadline; the reply was discarded | idempotency, and a shorter `WithExpiration` upstream |

**A subscriber's message failed. What now?** Transient → bounded retry with backoff, then
dead-letter. Permanent → reject without requeue, dead-letter, alert. Already processed → ack and do
nothing. `requeue: true` on a permanent failure is the poison-message hot loop
(`references/principles.md`).

## Do

```powershell
# Who answers, who calls — before changing a contract, find every user of the type
Get-ChildItem -Recurse -Filter *.cs | Select-String -Pattern 'RequestAsync<<Request>|RespondAsync<<Request>' |
  Select-Object Path, LineNumber
Get-ChildItem -Recurse -Filter appsettings*.json | Select-String -Pattern 'host=.*timeout='   # the RPC timeout in force

# Broker state: rabbitmqctl lives inside the container (procedure in references/operations.md)
docker exec <container> rabbitmqctl list_queues --vhost <vhost> name messages messages_ready messages_unacknowledged consumers
docker exec <container> rabbitmqadmin -V <vhost> get queue=<name> count=1 ackmode=reject_requeue_true   # peek only
```

**Never purge, consume or delete** while investigating — the guardrails are in
`references/operations.md`. Exec and throwaway-container mechanics are in the `docker-dev-env`
skill's clients-in-containers reference.

## Traps

1. An RPC caller with no timeout handling → a 500 two minutes later, after the user retried → catch
   the timeout, return a clean failure, and make the responder idempotent.
2. A responder that throws for a business rule → the caller gets a bare message string → return the
   error in the response's outcome fields.
3. A request type renamed or moved → the routing key changes and the old callers wait out every call →
   contracts change additively; a breaking change is a new type served in parallel.
4. The bootstrap retry gives up on a subscriber → the service is "healthy" with a missing responder →
   read the startup log; `/health` does not check subscriptions.
5. An RPC call inside a subscriber holding an unacked message → one slow responder stalls two queues.
6. A copied subscription id → two services share one queue and each sees half the messages.
7. A subscription id changed in a deploy → a new empty queue, and the old one fills forever.
8. `requestedHeartbeat=0` → a half-open connection is detected only by the OS → after a network blip,
   suspect the connection before the code.
9. No dead-letter route on a work queue → a rejected message is silently gone.
10. Publishers block with no error → a memory or disk alarm on the node → `rabbitmq-diagnostics status`.
11. Replaying an error queue without idempotent handlers → every effect happens twice.
12. A chain of RPC hops → each hop adds a full timeout budget → collapse it, or turn the tail into events.

## References

- `references/easynetq.md` — how the bus is wired here, RPC semantics (timeouts, missing responder,
  exceptions across the wire, shared contracts), the subscription-id trap, the error queue, the
  advanced bus, and a review checklist.
- `references/principles.md` — shape choice, the durability switches, acknowledgement and prefetch,
  idempotency, and a retry policy that terminates.
- `references/operations.md` — the broker-state procedure: health, queue depth, reading the numbers,
  bindings, a non-destructive peek, the report, replay, and the guardrails.
