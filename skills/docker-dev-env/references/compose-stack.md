# The local stack, service by service

One compose file per repository, at the repository root, holding **only backing services** — the
databases, the broker, the cache and the supporting pieces. The application itself runs from the IDE
or from an Aspire app host; putting it in the same file means rebuilding an image on every edit.

Every image tag comes from the `.env` file next to the compose file, never hardcoded in the YAML.
That is what keeps the file version-agnostic: bumping an engine is a one-line `.env` change, and the
file itself never has to be edited or reviewed for it.

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
      test: ["CMD-SHELL", "/opt/mssql-tools/bin/sqlcmd -S localhost -U sa -P \"$$MSSQL_SA_PASSWORD\" -Q 'SELECT 1' || exit 1"]
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
      test: ["CMD-SHELL", "redis-cli -a \"$$REDIS_PASSWORD\" ping | grep -q PONG"]
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
one file and nothing else. **The container port never changes** — only the host side does, and only
the host side is what collides. Inside the compose network, services address each other by service
name and container port, so an override never touches application configuration.

## Profiles: not everything has to start

```yaml
  seeder:
    image: postgres:${POSTGRES_TAG}
    profiles: ["seed"]        # only with: docker compose --profile seed up
```

A service in a profile is inert unless the profile is named. Use it for one-shot jobs (a seeder, a
migration runner), for the pieces only one workflow needs, and for anything heavy that most days is
dead weight. It is cheaper than commenting services out, which always gets committed by accident.

## Overrides: local changes that are not committed

`docker compose` merges `compose.yaml` with `compose.override.yaml` automatically when the latter
exists. Commit the first, gitignore the second. That is where a personal port change, an extra
mounted folder, or a temporarily bumped memory limit goes — not in the shared file.

```powershell
docker compose config          # ALWAYS read this, not the file: it shows the merged, resolved result
docker compose -f compose.yaml config   # the committed file alone, ignoring the override
```

An explicit second file works the same way and is the pattern when the variant is shared rather than
personal: `docker compose -f compose.yaml -f compose.integration.yaml up -d`. Later files win on
scalars, and **lists are replaced, not appended** — an override that re-declares `ports:` replaces
the whole list, which is the usual reason a port silently disappears.

## Networks

The default network compose creates is enough for a single stack: every service is reachable from
every other by service name. Declare a network explicitly only when something outside this file has
to join it — a throwaway client container, or a second stack that must reach this one. Then it is an
`external: true` network created once by hand, so neither stack owns its lifecycle.
