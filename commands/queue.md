---
description: Broker state at a glance — queue depth, dead-letter queues, unacknowledged messages, and a non-destructive peek at a stuck message.
argument-hint: "[queue-name] [--peek [n]] [--dlq]"
---

See what the broker is holding right now. Topology, dead-letter design, poison-message and
idempotency patterns are **`rabbitmq`**; the container stack is **`docker-dev-env`**. This command
reads the state and reports it. `rabbitmqctl` and `rabbitmqadmin` are **not on PATH** — they live
inside the broker container and are reached with `docker exec`.

## Argument grammar

- *(empty)* → the overview: every queue with a non-zero depth, plus every dead-letter queue whether
  or not it is empty.
- **`<queue-name>`** → that queue in detail, plus the dead-letter queue it routes to.
- **`--peek [n]`** → read `n` (default 1) messages from the queue **without consuming them**.
- **`--dlq`** → dead-letter queues only.

## Steps

1. **Find the broker.**
   ```powershell
   docker compose ps
   docker ps --filter "ancestor=rabbitmq" --format "table {{.Names}}\t{{.Ports}}\t{{.Status}}"
   ```
   Nothing running → say the broker is not up and stop. Do not start it: that is `docker-dev-env`.
   Credentials and vhost come from the project's config (compose environment, `appsettings*.json`),
   never from a guess, and are never printed.

2. **Overview** — depth, ready, unacked and consumers in one call:
   ```powershell
   docker exec <container> rabbitmqctl list_queues --vhost <vhost> name messages messages_ready messages_unacknowledged consumers state
   ```
   or, through the management plugin:
   ```powershell
   docker exec <container> rabbitmqadmin -V <vhost> list queues name messages messages_ready messages_unacknowledged consumers
   ```

3. **Read the numbers, do not just print them.** The diagnosis is in the combination:

   | Pattern | What it means |
   | --- | --- |
   | `messages_ready` high, `consumers` 0 | nobody is listening — the consumer is down or never bound |
   | `messages_ready` high, `consumers` > 0 | consumers too slow, or prefetch too low |
   | `messages_unacknowledged` high and static | a consumer took messages and never acked — stuck handler or a swallowed exception |
   | dead-letter queue growing | messages are failing repeatedly; the payload in step 5 is the evidence |
   | a queue with no consumers and no producers | dead topology — a binding that no longer matches |

4. **Dead letters and bindings.** Dead-letter queues are the ones a `x-dead-letter-exchange`
   argument points at — read the arguments rather than pattern-matching a name:
   ```powershell
   docker exec <container> rabbitmqctl list_queues --vhost <vhost> name arguments messages
   docker exec <container> rabbitmqctl list_bindings --vhost <vhost>
   docker exec <container> rabbitmqctl list_consumers --vhost <vhost>
   ```

5. **Peek, non-destructively.** The message must go back on the queue:
   ```powershell
   docker exec <container> rabbitmqadmin -V <vhost> get queue=<name> count=1 ackmode=reject_requeue_true
   ```
   `ackmode=reject_requeue_true` is the only mode this command uses — every `ack_*` mode removes the
   message. Report the routing key, the headers (`x-death` gives the failure count and the original
   queue), and the payload; redact any token or connection string in it. A peek reorders the queue's
   head — say so when order matters.

6. **Report** — broker container and vhost · a table of queues with depth, ready, unacked and
   consumers, worst first · dead-letter queues separately with their `x-death` reason · the peeked
   message if asked · one line naming the most likely cause from step 3 and what to look at next
   (`/logs <consumer>`, `debug-systematic`).

## Guardrails

- **Never purge.** `rabbitmqctl purge_queue` and `rabbitmqadmin purge queue` are destructive and
  irreversible: they run only after the user says purge explicitly *and* confirms the queue name and
  the message count just read. Never as a cleanup, never to "unstick" a consumer.
- **Never consume.** No `ack_requeue_false`, no `ack_requeue_true`, no `--payload-file` drain — only
  `ackmode=reject_requeue_true`.
- **Never publish**, never replay a dead letter by hand, never `declare` or `delete` a queue,
  exchange, binding, policy or vhost.
- Never `rabbitmqctl stop`/`stop_app`/`reset`/`force_reset`, and never restart the container.
- Never print broker credentials or the management URL with credentials in it.
- Development brokers only: a host that is not local stops the command.
- Do not fix the consumer here. This reports state; the fix is a normal change.
