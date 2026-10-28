# The local stack, service by service

One compose file per repository, at the repository root, holding **only backing services** — the
databases, the broker, the cache and the supporting pieces. The application itself runs from the IDE
or from an Aspire app host; putting it in the same file means rebuilding an image on every edit.

Every image tag comes from the `.env` file next to the compose file, never hardcoded in the YAML:
bumping an engine is a one-line `.env` change.

```yaml
name: <this-stack>            # explicit project name: without it, the folder name wins

services:
  sqlserver:
    image: mcr.microsoft.com/mssql/server:${MSSQL_TAG}
    environment:
      ACCEPT_EULA: "Y"
      MSSQL_SA_PASSWORD: ${MSSQL_SA_PASSWORD}   # from .env, never a literal
    ports: ["${MSSQL_PORT}:1433"]
    volumes: ["mssql-data:/var/opt/mssql"]
    healthcheck:
      test: ["CMD-SHELL", "SQLCMDPASSWORD=\"$$MSSQL_SA_PASSWORD\" /opt/mssql-tools/bin/sqlcmd -S localhost -U sa -Q 'SELECT 1' || exit 1"]
      interval: 10s
      retries: 12
      start_period: 40s        # the engine takes a while on first start; without this it flaps

  postgres:
    image: postgres:${POSTGRES_TAG}
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    ports: ["${POSTGRES_PORT}:5432"]
    volumes:
      - "pg-data:/var/lib/postgresql/data"
      - "./db/init:/docker-entrypoint-initdb.d:ro"   # runs ONLY on an empty data directory
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER -d $$POSTGRES_DB"]
      interval: 5s
      retries: 10

  redis:
    image: redis:${REDIS_TAG}
    command: ["redis-server", "--requirepass", "${REDIS_PASSWORD}", "--appendonly", "yes"]
    ports: ["${REDIS_PORT}:6379"]
    volumes: ["redis-data:/data"]
    healthcheck:
      test: ["CMD-SHELL", "REDISCLI_AUTH=\"$$REDIS_PASSWORD\" redis-cli ping | grep -q PONG"]
      interval: 5s
      retries: 10

  rabbitmq:
    image: rabbitmq:${RABBITMQ_TAG}   # the -management variant, so the UI is there
    environment:
      RABBITMQ_DEFAULT_USER: ${RABBITMQ_USER}
      RABBITMQ_DEFAULT_PASS: ${RABBITMQ_PASSWORD}
    ports:
      - "${RABBITMQ_PORT}:5672"       # AMQP — what the app connects to
      - "${RABBITMQ_UI_PORT}:15672"   # management UI and HTTP API
    volumes: ["rabbit-data:/var/lib/rabbitmq"]
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "check_running", "check_port_connectivity"]
      interval: 10s
      retries: 10
      start_period: 30s

  mail:
    image: axllent/mailpit:${MAIL_TAG}   # or mailhog; the compose file names which
    ports:
      - "${MAIL_SMTP_PORT}:1025"        # the SMTP host the app is configured with
      - "${MAIL_UI_PORT}:8025"          # where the mail is read
    # deliberately no volume: local mail is disposable

  proxy:
    image: nginx:${NGINX_TAG}
    ports: ["${PROXY_HTTP_PORT}:80", "${PROXY_HTTPS_PORT}:443"]
    volumes:
      - "./proxy/nginx.conf:/etc/nginx/conf.d/default.conf:ro"
      - "./proxy/certs:/etc/nginx/certs:ro"   # a locally trusted dev certificate, never committed
    depends_on:
      - sqlserver

volumes:
  mssql-data:
  pg-data:
  redis-data:
  rabbit-data:
```

## What each piece is for

| Service       | Why it is here                                                                  |
| ------------- | ------------------------------------------------------------------------------- |
| SQL Server    | the primary database of every solution in this stack                            |
| Postgres      | the read-cache database, and one solution's alternative EF provider             |
| Redis         | cache-aside and the SignalR backplane in one platform                           |
| RabbitMQ      | the message bus; the management variant so queues and dead letters are visible  |
| Mail catcher  | every mail the app sends locally, trapped and readable — never a real SMTP host  |
| Reverse proxy | one hostname and one TLS termination in front of several services, as in prod    |

## Ports: the collision surface

| Service        | Container port | Why it collides                                         |
| -------------- | -------------- | ------------------------------------------------------- |
| SQL Server     | 1433           | a locally installed instance already owns it            |
| Postgres       | 5432           | another stack, or a locally installed server            |
| Redis          | 6379           | another stack                                           |
| RabbitMQ       | 5672 / 15672   | another stack                                           |
| Mail catcher   | 1025 / 8025    | rarely                                                  |
| Reverse proxy  | 80 / 443       | IIS, another proxy, or anything already serving HTTP    |

Every published port is a `${VAR}` read from `.env`, so a second stack on the same machine changes
one file and nothing else. **The container port never changes** — only the host side does. Inside the
compose network, services address each other by service name and container port, so an override never
touches application configuration.

## Profiles and overrides

`profiles: ["seed"]` on a one-shot job (a seeder, a migration runner) or a heavy piece keeps it inert
unless named (`docker compose --profile seed up`); cheaper than commenting services out, which gets
committed by accident.

Commit `compose.yaml`, gitignore `compose.override.yaml` (merged automatically; personal port changes
go there). `docker compose config` shows the merged, resolved result: read it, not the file;
`docker compose -f compose.yaml config` ignores the override. A shared variant:
`docker compose -f compose.yaml -f compose.integration.yaml up -d`. **Lists are replaced, not
appended** — an override that re-declares `ports:` replaces the whole list, the usual reason a port
silently disappears.

## Networks

The default network is enough for a single stack. Declare one only when something outside this file
has to join it; then it is an `external: true` network created once by hand, so neither stack owns
its lifecycle.
