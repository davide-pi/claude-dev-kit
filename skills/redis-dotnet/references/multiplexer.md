# The multiplexer — one connection, for the life of the process

## Why a singleton is not a style choice

The .NET client does not use a connection pool. One `ConnectionMultiplexer` opens a small number of
sockets and **multiplexes** every caller's commands over them, pipelining aggressively. It is
thread-safe, expensive to create, and designed to be shared.

| Anti-pattern                                     | What happens                                                     |
| ------------------------------------------------ | ---------------------------------------------------------------- |
| `using var mux = ConnectionMultiplexer.Connect()` per request | a handshake per request, sockets in `TIME_WAIT`, then connection timeouts |
| A new multiplexer per scoped service              | the same, hidden inside DI                                       |
| A `Lazy<ConnectionMultiplexer>` static, plus a second one in a library | two connection sets, two sets of timeouts to debug     |
| One multiplexer for two logically separate uses (cache and backplane) with no channel prefix | cross-talk on pub/sub |

**Register one singleton per logical Redis endpoint**, resolve `IConnectionMultiplexer`, and take
`GetDatabase()` per operation — that call is a cheap handle, not a connection. If the framework's
distributed-cache integration is also registered, it manages a connection of its own: either give it
the existing multiplexer through its options or accept that there are two, deliberately.

## The options that matter

```csharp
var o = ConfigurationOptions.Parse(connectionString);
o.AbortOnConnectFail = false;      // do not throw when the server is not up yet
o.ConnectRetry       = 3;
o.ConnectTimeout     = 5_000;      // ms, the initial handshake
o.SyncTimeout        = 5_000;      // ms, a synchronous command
o.AsyncTimeout       = 5_000;      // ms, an asynchronous command
o.KeepAlive          = 60;         // seconds between pings; detects a silently dead socket
o.ClientName         = "orders-api";
o.DefaultDatabase    = 0;
o.AllowAdmin         = false;
o.Ssl                = true;       // a managed instance; false for a local container
o.ChannelPrefix      = RedisChannel.Literal("orders:");
```

| Option                | Why                                                                              |
| --------------------- | -------------------------------------------------------------------------------- |
| `AbortOnConnectFail`  | with it on, one unavailable server at startup permanently fails the multiplexer, so a cold container becomes a crash loop. Off, the client keeps reconnecting. |
| `ConnectTimeout`      | separate from the command timeouts; a slow DNS or TLS handshake lives here         |
| `SyncTimeout` / `AsyncTimeout` | the number in the timeout exception. Raising it hides a starved thread pool instead of fixing it |
| `KeepAlive`           | a dropped connection behind a load balancer is otherwise discovered by the next command, minutes later |
| `ClientName`          | the only way to tell which service a row in `CLIENT LIST` belongs to              |
| `AllowAdmin`          | gates `FLUSHDB`, `CONFIG`, `INFO`-style server commands. Off in every application |
| `ChannelPrefix`       | namespaces pub/sub so two applications can share one instance                      |
| `DefaultDatabase`     | numbered databases are not isolation; they do not exist in cluster mode. Prefer key prefixes |
| `ReconnectRetryPolicy` | exponential backoff instead of hammering a server that is restarting             |

The connection string may also carry these (`abortConnect=false`, `ssl=true`, `connectTimeout=…`);
what is in configuration wins over what is in code only if the code parses first and does not
overwrite. Keep the split explicit: endpoints and credentials in configuration, behaviour in code.

Never commit a connection string with a password. Read it from user secrets, the environment, or a
vault; the compose file's own environment section is the source for local runs.

## Health, reconnection and events

The multiplexer reconnects on its own. Subscribe to its events to make that visible instead of
guessing from timeouts:

```csharp
mux.ConnectionFailed   += (_, e) => log.LogWarning("Redis {Endpoint} failed: {Type}", e.EndPoint, e.FailureType);
mux.ConnectionRestored += (_, e) => log.LogInformation("Redis {Endpoint} restored", e.EndPoint);
mux.ErrorMessage       += (_, e) => log.LogWarning("Redis error: {Message}", e.Message);
```

`mux.IsConnected` is a snapshot, not a guarantee — by the time the caller acts on it the state may
have changed. Health checks should issue a real `PING` with a short timeout, and a cache health check
should be **degraded, not unhealthy**: a cache being down must not take the service down.

The design rule that follows: **every Redis read is on a fallback path.** A miss and a failure look
the same to the caller, and both fall through to the source of truth. A cache whose outage becomes an
error page is a database with worse durability.

## Diagnosing a timeout from its message

The exception text is a diagnostic dump, and it names the culprit:

```text
Timeout performing GET orders:42 (5000ms), inst: 0, qs: 812, in: 0, serverEndpoint: redis:6379,
mgr: 10 of 10 available, clientName: orders-api, IOCP: (Busy=0,Free=1000,Min=8),
WORKER: (Busy=193,Free=32574,Min=8), v: <client version>
```

| Field                        | Reading it                                                                |
| ---------------------------- | ------------------------------------------------------------------------- |
| `WORKER: Busy` >> `Min`      | **thread-pool starvation.** The response arrived; no thread ran the continuation |
| `qs` large                   | commands queued to the server: something ahead is slow, or a huge value is in flight |
| `inst`                       | commands issued since the last heartbeat — a burst from one caller          |
| `in` / `in-pipe`             | bytes still being read: the response is large                              |
| `mgr` not "available"        | the socket manager is busy or reconnecting                                 |
| `sync-ops` growing           | synchronous calls; find and remove them                                    |
| All counters small, one endpoint slow | genuine server-side latency — check the slow log             |

**Sync-over-async is the cause most of the time.** `.Result`, `.Wait()`, `GetAwaiter().GetResult()`
or the synchronous API on a request path consumes a thread pool thread while waiting for a network
round trip. Under load the pool grows only slowly, so every continuation — Redis, HTTP, the database
— queues behind the injection rate, and Redis is simply the first to notice because it is the fastest
dependency.

| Fix                                              | Status                                             |
| ------------------------------------------------ | -------------------------------------------------- |
| Make the whole path async, including the callers  | the actual fix                                     |
| `ThreadPool.SetMinThreads` raised at startup      | a stopgap that buys time during an incident         |
| Raising `SyncTimeout`                             | hides the problem; the latency stays                |
| Adding multiplexers                               | makes it worse — more sockets, same starved pool    |

Large values are the second cause: one multi-megabyte payload blocks the pipeline for everybody on
that connection. Find them with `--bigkeys` (see `inspect-via-docker.md`), then split or compress
them. Redis is single-threaded per command, so one slow command is everyone's slow command.
