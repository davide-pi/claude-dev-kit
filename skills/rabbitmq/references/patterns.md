# Publish-subscribe, request-response, saga — and what each costs

## The three, compared

| Dimension                | Publish-subscribe             | Request-response              | Saga                                        |
| ------------------------ | ----------------------------- | ----------------------------- | ------------------------------------------- |
| Coupling                 | publisher knows nobody         | caller knows the responder's contract and needs it **up now** | orchestrator knows every step |
| Failure of the other side | invisible; the queue buffers   | the call fails or times out    | a step fails, and compensation runs         |
| Latency                  | asynchronous                   | the caller's latency is the sum of the round trip and the handler | long-running by design |
| Ordering                 | none across consumers          | one exchange per call          | enforced by the state machine               |
| State to keep            | none                           | a correlation id in flight     | persisted, per instance, with timeouts      |
| Failure mode to design for | duplicate delivery           | timeout and a lost reply       | partial completion                          |
| Cost to build            | low                            | low, and deceptively so        | high — the highest in the stack             |

The honest ranking: reach for publish-subscribe first, commands second, request-response only when a
human is waiting for an answer, and a saga only when a business process genuinely spans services and
needs compensation.

## Publish-subscribe

One exchange, one **durable queue per consuming service**, each bound with the keys it cares about.

- The publisher's contract is the **message type and its payload**, nothing else. It must not know
  how many consumers exist, and adding one must require no publisher change.
- Events are facts in the past tense and are immutable. Never publish an event whose meaning depends
  on when the consumer reads it (`order.needsReview` is a command wearing an event's clothes).
- Every consumer gets its own copy, so every consumer must be independently idempotent.
- Two consumers of one queue means competing consumers — a work split, not a fan-out. That is the
  single most common accidental design here; see the subscription-id trap in `easynetq.md`.
- Payload design: include enough for the common consumer to act without a callback, and a stable id
  for the rest to fetch detail. A "thin event" that forces every consumer into an HTTP call has
  reintroduced synchronous coupling through the back door.
- Version the payload from the first day: additive changes only, and a new message type when a change
  is not additive. Two versions coexist during any rolling deploy.

## Request-response

The caller publishes with a `reply_to` and a `correlation_id`, then waits for a message on the reply
queue. The direct reply-to pseudo-queue avoids declaring a queue per call.

What it actually costs:

- **Availability couples.** No responder, no answer. The caller's error budget now includes the
  responder's.
- **Latency couples.** The caller's timeout must exceed the responder's worst case, including its own
  dependencies.
- **A timeout is not a failure.** The work may have completed, with the reply lost. Every RPC
  operation must therefore be idempotent, which is exactly the property people assume they escaped by
  not using a queue.
- **A reply queue is transient.** A caller restart loses in-flight replies, permanently.
- Scaling the caller does not help; scaling the responder does, and only if the queue is shared.

Use it for: a validation or lookup a user is waiting on, where the alternative is a synchronous HTTP
call anyway and the broker is bringing discovery and load balancing. Do **not** use it for: anything
slow, anything that writes and could be retried, or a chain of calls (an RPC calling an RPC multiplies
every timeout and every outage).

When in doubt, invert it: send a command, return an acknowledgement immediately, and publish an event
when the work completes. The caller polls or subscribes. That converts a coupling problem into a
correlation problem, which is far cheaper to operate.

## Saga

Several steps across services, each of which can fail, where a failure must undo what already
happened. There is no saga engine in this stack — EasyNetQ does not provide one — so it is
hand-rolled, and the discipline has to be explicit.

**Orchestration** (one coordinator sends commands and reacts to events) is the form to use here:
the process is readable in one place, and its state is queryable. Choreography (each service reacts
to the previous event) has no coordinator to ask "where is order 42 stuck", and that question is
always asked eventually.

What a hand-rolled saga must have:

| Element                          | Why                                                                    |
| -------------------------------- | ---------------------------------------------------------------------- |
| **Persisted state** per instance, keyed by a correlation id | the process outlives the process; store it in SQL Server, not in memory |
| An explicit state machine        | a set of states and allowed transitions, so an out-of-order event is rejected rather than mis-applied |
| Idempotent transitions           | every event can arrive twice; a transition already applied is a no-op   |
| A timeout per step               | a step whose event never arrives must fail loudly, not hang forever — a scheduled message or a delay queue |
| A **compensating action** per step that has side effects | there is no rollback across services; the undo is a business operation ("refund", not "delete the row") |
| Compensations that are idempotent and can themselves fail | otherwise a failed compensation strands the instance          |
| A terminal state, always         | `Completed` or `Failed`; an instance with no terminal state is a leak   |
| Queryable status                 | "which instances are in flight, and in which state, for how long" is the first operational question |

The transactional-outbox question comes with it: a handler that writes to the database **and**
publishes a message cannot do both atomically. Either write the message to an outbox table in the
same transaction and publish it from there, or design the consumer so that a message lost between the
two is recovered by a reconciliation pass. Pretending the two writes are atomic is the bug that
produces the "the order exists but nothing happened" ticket.

## Choosing, in one pass

1. Does anyone need an answer **synchronously**? No → command or event. Yes → is a human waiting?
   No → command plus event. Yes → request-response, with a timeout and an idempotent handler.
2. Does more than one party care? Yes → event on a topic exchange, one queue each.
3. Does the process span services **and** need undo? Yes → saga, orchestrated, with persisted state
   and per-step timeouts. No → a single handler, one transaction, done.
4. Whatever the answer: the consumer is idempotent, and the failure path is written down before the
   happy path is deployed.
