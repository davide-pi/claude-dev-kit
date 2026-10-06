# Operating the broker from the command line — read the state, change nothing

This is the procedure for "what is the broker holding right now". `rabbitmqctl` and `rabbitmqadmin`
are **not on PATH**: they live inside the broker container and are reached with `docker exec`, or the
management HTTP API is called directly. Topology and retry design are in `principles.md`; the client
stack is `docker-dev-env`.

**Language:** the diagnosis and the report are **Italian**; queue, exchange, vhost and container
names, routing keys, header names such as `x-death`, counters and payloads pass through verbatim.

## The procedure

1. **Find the broker.** Nothing running → say so and stop; starting it is `docker-dev-env`'s job.
   Credentials and vhost come from the project's config (compose environment, `appsettings*.json`),
   never from a guess, and are never printed. Development brokers only: a non-local host stops here.

   ```powershell
   docker compose ps
   docker ps --filter "ancestor=rabbitmq" --format "table {{.Names}}\t{{.Ports}}\t{{.Status}}"
   $c = '<container>'; $vh = '<vhost>'
   ```

2. **Health first** — a blocked publisher is usually an alarm, not a bug:

   ```powershell
   docker exec $c rabbitmq-diagnostics check_running
   docker exec $c rabbitmq-diagnostics status       # listeners, memory, disk free, any ALARM
   ```

   Past its memory or disk high-watermark a node stops accepting publishes: the connection is
   *blocked*, not broken, so the application sees writes that never complete and no error at all.

3. **Overview** — depth, ready, unacked and consumers in one call:

   ```powershell
   docker exec $c rabbitmqctl list_queues --vhost $vh name messages messages_ready messages_unacknowledged consumers state
   ```

4. **Read the numbers — the diagnosis is in the combination.**

   | Pattern | Meaning |
   | --- | --- |
   | an RPC request queue (named after the request type) with `consumers` 0 | **the responder is not subscribed** — every caller waits the full RPC timeout, then throws |
   | an RPC request queue with `messages_ready` > 0 and consumers > 0 | the responder is too slow; callers will time out before it answers |
   | many `easynetq.response.*` queues | one reply queue per requesting bus — normal; one with depth is a caller that died mid-request |
   | `messages_ready` high, `consumers` 0, on a subscriber queue | the consumer is down, or its subscription id changed in a deploy |
   | `messages_ready` climbing with consumers > 0 | consumers too slow, or prefetch too low |
   | `messages_unacknowledged` high and static | a handler took messages and never acked — stuck, or a swallowed exception |
   | the error or dead-letter queue growing | messages fail repeatedly; the payload in step 6 is the evidence |
   | a familiar type name in an unexpected queue, or two consumers where one was expected | a stray or copy-pasted subscription id (`easynetq.md`) |
   | a queue with no consumers and no publishers | dead topology — a binding that no longer matches |

5. **Dead letters, bindings, consumers.** Read the arguments rather than guessing from a name:

   ```powershell
   docker exec $c rabbitmqctl list_queues --vhost $vh name arguments messages
   docker exec $c rabbitmqctl list_bindings --vhost $vh
   docker exec $c rabbitmqctl list_consumers --vhost $vh      # queue, channel, prefetch, ack mode
   ```

   A missing **binding** is the silent failure: the publish succeeds, the exchange routes to nothing.

6. **Peek, non-destructively.** The message must go back on the queue:

   ```powershell
   docker exec $c rabbitmqadmin -V $vh get queue=<name> count=1 ackmode=reject_requeue_true
   ```

   `ackmode=reject_requeue_true` is the only mode allowed — every `ack_*` mode removes the message.
   Report the routing key, the headers (`x-death`: original queue, reason, count; an EasyNetQ error
   message carries the exception text in its body), and the payload with any token or connection
   string redacted. A peek reorders the head of the queue — say so when order matters.

7. **Report**: broker container and vhost · a table of queues worst first (Italian headers over the
   real field values) · dead-letter and error queues separately with their reason · the peeked
   message if asked · one line with the most likely cause from step 4 and the next look
   (`/logs <service>`, the `investigator` agent in trace mode for which service should be answering).

## The management HTTP API, when a CLI is awkward

```powershell
$auth = @{ Authorization = 'Basic ' + [Convert]::ToBase64String(
    [Text.Encoding]::ASCII.GetBytes("$env:RABBIT_USER`:$env:RABBIT_PASS")) }
$base = 'http://localhost:15672/api'      # the default vhost '/' is '%2F' in every path
(Invoke-RestMethod "$base/queues" -Headers $auth) |
  Select-Object name, messages, messages_ready, messages_unacknowledged, consumers, idle_since |
  Sort-Object messages -Descending | Format-Table
Invoke-RestMethod "$base/connections" -Headers $auth | Select-Object name, user, client_properties, state
```

The management listener and the AMQP listener are different ports: the UI answering proves nothing
about the port the services use.

## Replaying and moving messages

| Goal | Tool |
| --- | --- |
| Republish an EasyNetQ error queue | `Hosepipe`: dump to disk, inspect, republish selectively |
| Move a queue's contents elsewhere | a one-off dynamic shovel, deleted afterwards |
| Republish one message | read it with `get`, publish it to the original exchange and routing key |

Replay re-runs handlers: confirm they are idempotent (`principles.md`) and replay a sample of one
before the batch. An RPC request is never replayed — its caller gave up long ago.

## Guardrails

- **Never purge** (`rabbitmqctl purge_queue`, `rabbitmqadmin purge queue`, `DELETE …/contents`)
  unless the user says purge explicitly *and* confirms the queue name and the count just read. Never
  as cleanup, never to "unstick" a consumer: the backlog is data.
- **Never consume**: no `ack_requeue_false`, no `ack_requeue_true`, no drain to a file.
- Never publish, never replay a dead letter by hand without the steps above, never declare or delete
  a queue, exchange, binding, policy or vhost.
- Never `rabbitmqctl stop_app`, `reset`, `force_reset`, and never restart the container.
- Never print broker credentials or a management URL carrying them.
- Do not fix the consumer here: this reads state; the fix is a normal change.

## Policies

Queue arguments are immutable, but a policy applies settings to every queue matching a pattern and can
be changed later — the way to add a TTL or a length limit to existing queues. It is broker
configuration: it belongs in provisioning, not applied by hand and forgotten.

```powershell
docker exec $c rabbitmqctl list_policies --vhost $vh
```
