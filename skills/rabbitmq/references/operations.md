# Operating the broker from the command line

Everything here works against a broker in compose, without opening the management UI, so it can be
scripted, diffed and pasted into a ticket.

## Two interfaces

| Interface                 | Reach it with                                 | Good for                                        |
| ------------------------- | --------------------------------------------- | ----------------------------------------------- |
| `rabbitmqctl`             | `docker compose exec -T rabbitmq rabbitmqctl`  | node state, queues, consumers, users, purging    |
| `rabbitmq-diagnostics`    | same, `rabbitmq-diagnostics`                   | health checks, alarms, memory breakdown          |
| Management HTTP API       | `http://localhost:15672/api/...`               | everything, as JSON — rates, bindings, peeking at messages |
| `rabbitmqadmin`           | shipped with the management plugin              | a thin CLI over that API, when curl-shaped work is awkward |

The HTTP API needs the management plugin enabled: `docker compose exec -T rabbitmq rabbitmq-plugins
list` shows it. Credentials come from the compose file's environment, and the default virtual host
`/` must be URL-encoded as `%2F` in every path.

```powershell
$c = @('compose','exec','-T','rabbitmq')
$auth = @{ Authorization = 'Basic ' + [Convert]::ToBase64String(
    [Text.Encoding]::ASCII.GetBytes("$env:RABBIT_USER`:$env:RABBIT_PASS")) }
$base = 'http://localhost:15672/api'
$vh   = '%2F'
```

## Is the broker healthy?

```powershell
docker @c rabbitmq-diagnostics check_running
docker @c rabbitmq-diagnostics status            # listeners, memory, disk free, and any ALARM
docker @c rabbitmq-diagnostics memory_breakdown
docker @c rabbitmq-diagnostics list_unresponsive_queues
(Invoke-RestMethod "$base/overview" -Headers $auth) |
  Select-Object rabbitmq_version, @{n='ready';e={$_.queue_totals.messages_ready}},
                @{n='unacked';e={$_.queue_totals.messages_unacknowledged}}
```

**Memory and disk alarms are the first thing to check when publishers hang.** When a node crosses its
high-watermark, it stops accepting publishes: the connection is *blocked*, not broken, so the
application sees writes that never complete and no error at all. `status` names the alarm.

## Queue state — the numbers that matter

```powershell
docker @c rabbitmqctl list_queues name messages messages_ready messages_unacknowledged consumers
(Invoke-RestMethod "$base/queues" -Headers $auth) |
  Select-Object name, messages, messages_ready, messages_unacknowledged, consumers,
                consumer_utilisation, idle_since,
                @{n='in';e={$_.message_stats.publish_details.rate}},
                @{n='out';e={$_.message_stats.deliver_get_details.rate}} |
  Sort-Object messages -Descending | Format-Table
```

| Reading                                              | Diagnosis                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------ |
| `consumers = 0` on a work queue                       | nobody is consuming: the service is down, or its subscription id changed |
| `messages_ready` climbing, `in` > `out`               | the consumers cannot keep up: scale out, or the handler is the bottleneck |
| `messages_unacknowledged` high and static             | handlers are stuck — a blocking call, or a consumer timeout about to fire |
| `messages_unacknowledged` ≈ prefetch × consumers      | normal saturation                                             |
| `consumer_utilisation` well below 1                   | consumers idle waiting for deliveries: raise prefetch          |
| `idle_since` old on an error queue                    | good — nothing new is failing                                  |
| An unexpected queue with a familiar type name         | a stray subscription id; see `easynetq.md`                     |
| Two consumers on a queue you expected to be exclusive | a copy-pasted subscription id                                  |

```powershell
docker @c rabbitmqctl list_consumers                      # queue, channel, prefetch, ack mode
Invoke-RestMethod "$base/queues/$vh/orders.created.q" -Headers $auth   # one queue, everything
Invoke-RestMethod "$base/bindings" -Headers $auth |
  Select-Object source, destination, routing_key            # is the binding you think exists there?
Invoke-RestMethod "$base/connections" -Headers $auth |
  Select-Object name, user, client_properties, state        # `product` set per service pays off here
Invoke-RestMethod "$base/channels" -Headers $auth |
  Select-Object name, prefetch_count, messages_unacknowledged
```

A missing **binding** is the silent failure mode: the publisher succeeds, the exchange routes to
nothing, and the queue stays empty. Check `/bindings` before debugging the consumer, and enable the
`mandatory` flag plus a returned-message handler so the publisher learns about it next time.

## Inspecting a dead-letter or error queue without consuming it

```powershell
$body = @{ count = 10; ackmode = 'reject_requeue_true'; encoding = 'auto'; truncate = 50000 } |
        ConvertTo-Json
$msgs = Invoke-RestMethod "$base/queues/$vh/orders.created.error.q/get" -Method Post `
        -Headers $auth -ContentType 'application/json' -Body $body
$msgs | Select-Object -ExpandProperty properties | Select-Object message_id, headers
$msgs | Select-Object routing_key, payload_bytes, redelivered, @{n='body';e={$_.payload}}
```

`ackmode = reject_requeue_true` puts the messages back — this is a **peek**. Any other ackmode
consumes them. Two caveats: peeking moves the messages to the back of the queue's ordering, and it
is a manual operation that must never be wired into monitoring.

Read the `x-death` header first: it carries the original queue, the reason (`rejected`, `expired`,
`maxlen`, `delivery_limit`) and the count. That tells you whether this is a poison message, a
timeout, or an overflow, and the three have different fixes.

## Replaying and moving messages

| Goal                                     | Tool                                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------- |
| Move a queue's contents somewhere else   | the shovel plugin — a one-off dynamic shovel, deleted afterwards        |
| Republish an EasyNetQ error queue        | `Hosepipe` (dump to disk, inspect, republish selectively)               |
| Republish one message                    | read it with `get`, then publish it to the original exchange and key    |
| Drain a queue nobody will ever consume   | purge — see below                                                       |

Replay re-runs handlers. Confirm the handlers are idempotent (`consumers.md`) before replaying
anything, and replay a sample of one before the batch.

## Destructive operations — the rules

```powershell
# PURGE: deletes every message in the queue. Irreversible. Not a response to a backlog.
Invoke-RestMethod "$base/queues/$vh/<queue>/contents" -Method Delete -Headers $auth
docker @c rabbitmqctl purge_queue <queue>

# DELETE a queue (and its bindings), or an exchange
Invoke-RestMethod "$base/queues/$vh/<queue>" -Method Delete -Headers $auth
```

Before any of these:

1. Record the depth and a sample of the payloads, and save them.
2. Say explicitly which messages will be lost and why that is acceptable.
3. Confirm the queue is not simply waiting for a consumer that is being restarted.
4. Never purge a work queue to "clear a backlog" — the backlog is data.

`rabbitmqctl stop_app`, `reset`, `force_reset`, `delete_vhost` and `set_policy` on a shared broker
are operator actions, not debugging steps: `reset` erases the node's entire configuration and every
queue on it.

## Policies

Queue arguments are immutable, but a **policy** applies settings to queues matching a pattern and can
be changed afterwards — the way to add a TTL or a length limit to queues that already exist:

```powershell
docker @c rabbitmqctl list_policies
docker @c rabbitmqctl set_policy error-ttl '.*\.error\.q$' '{"message-ttl":604800000}' --apply-to queues
```

A policy is broker configuration, so it belongs in the compose or provisioning setup rather than
being applied by hand and forgotten — an argument set by an invisible policy is the hardest topology
bug to find.
