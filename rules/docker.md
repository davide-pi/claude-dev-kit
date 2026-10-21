---
paths: "**/Dockerfile*,**/docker-compose*.y*ml,**/compose*.y*ml,**/*AppHost*/**"
---
# Docker and the local stack — house facts

- A healthcheck tests readiness (the service answers), not that the process exists; dependants use
  `depends_on` with `condition: service_healthy`.
- Data lives in named volumes; a reset is a decision (keep / reset / throw away), never a reflex
  `down -v`.
- Image tags come from `.env`, never a hardcoded `latest`.
- Database and cache clients run inside the container (`docker compose exec -T <svc> <client>`),
  not installed on the host.
- A backend with an app host runs through Aspire; its old compose file is stale.

Procedure: skill `docker-dev-env`.
