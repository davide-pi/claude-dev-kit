---
name: pipeline
description: >-
  CI/CD pipeline authoring conventions for this repo (Azure DevOps YAML). Use when creating,
  editing, or reviewing a file that DEFINES a CI/CD pipeline or workflow — Azure DevOps
  build/deploy pipelines and their templates (usually under a service's `.pipelines/`, but apply
  wherever they live), `GitVersion.yml`, or any YAML whose purpose is a CI/CD build / deploy /
  release pipeline (`stages:`/`jobs:`/`steps:`/`trigger:`) or a GitHub Actions workflow (`on:`/`jobs:`).
  Covers layout, templating, scripts-over-tasks, variables/secrets, triggers, reliability, security.
  Do NOT use for non-pipeline YAML — docker-compose, appsettings, Kubernetes manifests, or other
  config files that merely happen to be `.yml`/`.yaml`.
---

# CI/CD Pipeline Conventions

**Applies to a file only if it defines a CI/CD pipeline or workflow** — not every `.yml`/`.yaml`.
Recognize one by its purpose/shape: Azure DevOps (`trigger:`/`pr:`, `stages:`/`jobs:`/`steps:`,
`GitVersion.yml`) or GitHub Actions (`on:` + `jobs:`). Plain config YAML (docker-compose,
appsettings, k8s manifests) is out of scope — leave it alone.

This repo deploys via **Azure DevOps YAML pipelines**. **GitHub Actions is not currently used** — if
you're introducing a workflow, raise it with the user first rather than assuming it's wanted. Mirror
the established layout — don't invent a new one:

- Per service tree: `<Service>/.pipelines/build.yml` (CI) + `<Service>/.pipelines/deploy.yml` (deploy orchestrator).
- Reusable deploy templates live in `<Service>/.pipelines/common/` — one `deploy-*-service.yml` per deployable, plus `deploy-database.yml`.
- Versioning via `GitVersion.yml` at each tree root.

## Structure

- Split build / deploy / per-service concerns into templates under `.pipelines/common/` — never one monolithic file.
- Templates must be composable and must not assume a caller context; pass all env-specific values as `parameters:`, never hardcode them.
- Extract anything repeated across ≥2 pipelines into a `common/` template.

## Scripts over platform tasks

- Prefer CLI (`dotnet build`, `dotnet publish`) over `DotNetCoreCLI@2` when a direct CLI equivalent exists.
- Use platform tasks only where there's no CLI (code signing, SSH deploy, artifact publish).
- Pin tool versions explicitly.

## Readability

- Descriptive `displayName` on every step and job — never rely on auto-generated names.
- Move inline scripts longer than ~10 lines into a `.ps1`/`.sh` file; don't embed logic in YAML.
- `#`-comment the *why* when it's not self-evident. Declare variables in a top `variables:` block, at the narrowest scope needed.

## Variables and secrets

- Never hardcode secrets or connection strings — use variable groups / environment secrets. This backend externalizes secrets via env-vars; keep that discipline in pipelines.
- Descriptive names that reveal intent: `PUBLISH_PROFILE_PROD`, not `PP`.

## Triggers, conditions, reliability

- Explicit `trigger:` / `pr:` conditions + path filters; never rely on platform defaults.
- Restrict production deploys to `master` / release branches; gate deploy stages with approvals.
- Fail-fast: no `continue-on-error: true` without a `#` reason. Begin PowerShell scripts with `$ErrorActionPreference = 'Stop'`, bash with `set -euo pipefail`.
- Cache NuGet keyed on the lockfile hash.
- **No test/coverage stage** — this repo has no automated tests, so don't add a "publish test results" step that will never produce artifacts.

## Security

- Least-privilege service connections; never admin/owner tokens for standard build jobs.
- Never echo secrets in logs. Pin third-party tasks/extensions to an immutable version; no floating `@latest`.
