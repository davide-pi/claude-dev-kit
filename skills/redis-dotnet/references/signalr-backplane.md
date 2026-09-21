# Redis as the SignalR backplane

## What it does, and what it does not

Two web servers each hold their own WebSocket connections. When server A broadcasts to a group, only
its own clients hear it — unless the servers share a bus. The backplane is that bus: every server
publishes hub invocations to Redis pub/sub and subscribes to what the others publish.

| It gives you                                              | It does **not** give you                                    |
| --------------------------------------------------------- | ----------------------------------------------------------- |
| Broadcast across all servers                              | Delivery to a client that is not connected right now         |
| Group and user targeting across servers                   | Message persistence — pub/sub has no queue and no replay      |
| Group membership shared between servers                   | Ordering guarantees between different publishers              |
| A shared connection-id registry                           | Reduced fan-out cost: every server still receives every message |

Because pub/sub is fire-and-forget, a message published while a server is disconnected from Redis is
simply gone. Anything a client must not miss belongs in a durable store the client reconciles against
on reconnect — the backplane is for live notification only.

## Wiring it

```csharp
builder.Services.AddSignalR()
    .AddStackExchangeRedis(cfg.GetConnectionString("Redis")!, o =>
    {
        // Namespaces every channel: mandatory when the instance is shared with the cache or
        // with another application. Two apps without a prefix will deliver each other's messages.
        o.Configuration.ChannelPrefix = RedisChannel.Literal("orders-hub:");
        o.Configuration.AbortOnConnectFail = false;
        o.Configuration.ClientName = "orders-api-signalr";
    });
```

The backplane creates its **own** connection by default. That is usually what you want — a saturated
cache path should not stall hub traffic — but it means one more client in `CLIENT LIST` and one more
set of timeouts, so give it a distinct `ClientName`. To share the application's multiplexer instead,
supply it through the options' connection factory, and then accept that a big cache payload can
delay a broadcast.

## Non-negotiables when more than one server runs

| Requirement                                             | Failure if missed                                              |
| ------------------------------------------------------- | -------------------------------------------------------------- |
| Every server on the **same hub protocol** and serialiser | clients connected to one server cannot decode messages from another |
| Every server on the same SignalR and backplane packages  | protocol drift between instances during a rolling deploy        |
| A distinct `ChannelPrefix` per application               | cross-application message delivery on a shared instance         |
| Shared data-protection keys across servers               | negotiation and reconnect tokens rejected by the next server    |
| Sticky sessions **unless** every client uses WebSockets  | long-polling and server-sent-events clients break without affinity |
| Non-WebSocket transports considered in the load balancer | intermittent "connection closed" that looks like a Redis fault  |

Sticky sessions are the trap that looks like a backplane bug: the backplane fixes broadcasting, not
the multi-request handshake that the other transports need.

## Sizing and cost

Every published message goes to every server, whether or not it has a subscriber for that group. The
cost is therefore *messages × servers*, not *messages × clients*.

- Prefer targeted sends (`Clients.Group`, `Clients.User`) over `Clients.All` — the network cost is
  the same, but the client-side work is not.
- Chatty per-client updates are the wrong shape: batch on the server and send a digest.
- Large payloads on the hub hit the same head-of-line blocking as a large cache value, on the
  backplane connection. Send an identifier and let the client fetch.
- Group membership operations are Redis writes; adding thousands of connections to groups on
  connect is a burst worth measuring.

## When something is wrong

| Symptom                                                    | Look at                                                       |
| ---------------------------------------------------------- | ------------------------------------------------------------- |
| Works with one server, breaks when scaled out              | the backplane is not registered, or each server has a different prefix |
| Some clients get messages, some do not                     | mixed hub protocols, or a server that lost its Redis connection |
| Messages from another application appear                   | missing `ChannelPrefix` on a shared instance                   |
| Reconnect loops after a deploy                             | data-protection keys not shared, or no sticky sessions for the transport in use |
| Broadcast latency spikes with cache load                   | backplane and cache sharing one multiplexer                    |
| Everything looks fine but nothing arrives                  | `PUBSUB CHANNELS` in the CLI: are the servers even subscribed? |

`docker compose exec -T redis redis-cli PUBSUB CHANNELS "<prefix>*"` and `PUBSUB NUMSUB <channel>`
are the two commands that answer "is the backplane connected at all" without touching the app. See
`inspect-via-docker.md`.

## The metrics exporter

This platform runs an exporter alongside the instance that scrapes server statistics and republishes
them for the monitoring stack. Two consequences for a .NET developer:

- The exporter is a client too: it appears in `CLIENT LIST` and in the connection count. A connection
  budget must include it.
- Which metrics exist, what to alert on, and how to read them belongs to the `redis-development`
  plugin's observability skill — not here. This skill's contribution is the **client-side** counters
  worth correlating with them: the timeout counters in `multiplexer.md`, and the cache hit ratio the
  application itself records.

Record the hit ratio in the application, not only at the server: a per-key-family hit ratio is what
tells you a TTL is wrong, and the server-side aggregate cannot show that.
