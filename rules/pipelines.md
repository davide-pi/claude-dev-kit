---
paths: "**/.pipelines/**,**/azure-pipelines*.y*ml,**/.github/workflows/*.y*ml,**/GitVersion.yml"
---
# Pipelines — house facts

- Scripts over tasks: `dotnet build`/`publish` as a script wherever a CLI exists; a task only where
  none does. Pin tool versions.
- A stage repeated per environment or deployable is a template under `common/`.
- No secret in YAML: secrets come from variable groups or the secret store, mapped explicitly into
  the step's `env`.
- PowerShell steps start with `$ErrorActionPreference = 'Stop'`, bash with `set -euo pipefail`.
- No test stage in a tree with no tests.
- A red run is diagnosed with `/fix-ci` before any YAML edit.

Procedure: skill `pipeline`.
