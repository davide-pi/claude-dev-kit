---
name: pipeline
description: >-
  Authoring and reviewing CI/CD definitions for this stack, which runs on Azure DevOps YAML
  pipelines: the multi-stage build-and-deploy shape used in these repositories, what belongs in a
  template versus in the pipeline that extends it, semantic versioning driven by a version config
  file at the tree root, variables and variable groups against secrets and typed runtime parameters,
  package caching against pipeline artifacts, triggers and path filters, approvals and environments,
  and diagnosing a failed run from the CLI. GitHub Actions is covered briefly because it is barely
  used here. Use when creating, editing or reviewing a file whose purpose is a CI/CD pipeline — an
  Azure DevOps pipeline or template, a version config file, or a workflow. Not for plain YAML that
  merely happens to be YAML, and not for a pipeline failing right now, which is the `/fix-ci` job.
---

# pipeline — Azure DevOps YAML: shape, templates, versioning, diagnosis

## When

- Creating or editing a file whose **purpose** is a CI/CD pipeline: `trigger:`/`pr:` with
  `stages:`/`jobs:`/`steps:`, a template under a `.pipelines/` tree, or the version config file.
- Reviewing a pipeline change: what moved into a template, what a stage is allowed to do.
- Deciding how a value reaches a run: variable, variable group, secret, or runtime parameter.
- Adding caching, or passing build output between stages.
- Changing how the version number is produced, or working out why it jumped.
- Introducing a GitHub Actions workflow — which here needs a conversation first, not a commit.

Not for: a red pipeline needing triage right now — that is the `/fix-ci` command, which pulls the
timeline, isolates the failing step and proposes the fix; plain YAML that is not a pipeline (compose
files, settings, Kubernetes manifests); local container orchestration (`docker-dev-env`); branch and
PR policy (`branch-flow`, `pr-create`). Agent images, task versions and SDK releases are read from
the pipeline and the project files — never assumed.

## Decide

**The shape these repositories use.** Mirror it; do not invent a second layout.

| File                                    | Role                                                            |
| --------------------------------------- | --------------------------------------------------------------- |
| `<tree>/.pipelines/build.yml`            | CI entry point: triggers, version, build, publish the artifact  |
| `<tree>/.pipelines/deploy.yml`           | deploy orchestrator: one stage per environment, nothing else    |
| `<tree>/.pipelines/common/deploy-*.yml`  | one template per deployable, plus one for the database          |
| `<tree>/<version config>.yml`            | the semantic-version rules for that tree                        |

**Template or pipeline?** The pipeline is the *entry point and the policy*; the template is *how*.

| Content                                                | Lives in                                    |
| ------------------------------------------------------ | ------------------------------------------- |
| `trigger`, `pr`, path filters, the stage list           | the pipeline — never a template             |
| Environment, resource and service-connection names      | the pipeline, passed down as `parameters:`  |
| The steps that build, test or deploy one thing          | a step or job template                      |
| Anything repeated in two or more pipelines              | a template, immediately                     |
| Approvals, gates, environment protection                | the Azure DevOps environment, not YAML      |
| Secret values                                           | a variable group, never any YAML file       |

A template must not assume its caller: every environment-specific value arrives as a declared, typed
`parameters:` entry, with no default that would quietly work. A template carrying a hardcoded
environment name is a copy waiting to happen.

**Which mechanism carries a value?**

| Need                                     | Mechanism                                  | Cost                                          |
| ---------------------------------------- | ------------------------------------------ | --------------------------------------------- |
| Fixed for this pipeline                   | `variables:`, at the narrowest scope       | visible in logs — never a secret              |
| Shared by several pipelines               | variable group, linked with `group:`       | the pipeline must be authorized for it once   |
| A secret                                  | secret variable in a group, vault-backed   | **not** placed in a script's environment      |
| Chosen when the run is queued              | typed runtime `parameters:`                | validated, and shown in the run dialog        |
| Computed in one job, read in another       | output variable plus `dependsOn`           | needs a dependency reference expression       |
| Decides the *shape* of the YAML            | template `parameters:`                     | compile time: drives loops and insertion      |

Three syntaxes, three moments — mixing them is the commonest failure in this file type: `${{ }}` at
compile time (template expansion, before an agent exists), `$(var)` at run time inside a step,
`$[ ]` at run time as a job or stage is scheduled.

**Cache or artifact?** Different problems, not interchangeable.

| Goal                                                 | Instrument                                            |
| ---------------------------------------------------- | ----------------------------------------------------- |
| Restore packages faster                               | a cache keyed on the lock or props file hash          |
| Hand build output to a later job or stage             | a pipeline artifact, named explicitly                  |
| Keep output for a release, or share across pipelines   | a published artifact, or a package feed               |
| Skip work already done for this commit                | a condition on an earlier stage's result, not a cache |

A cache is **best-effort**: a miss must leave the build correct, only slower. The moment a step works
only because a cache was warm, the pipeline is broken and nobody knows yet.

**GitHub Actions** is used in almost none of these repositories, so do not add a workflow without
raising it first — it means a second CI system to keep honest. Where one exists the same rules hold
under different names: reusable workflows and composite actions instead of templates, repository and
environment secrets instead of variable groups, the cache and upload-artifact actions instead of the
cache task and pipeline artifacts, environments with required reviewers instead of approvals. Pin
every third-party action to an immutable commit rather than a floating tag.

## Do

```powershell
$org = 'https://dev.azure.com/<org>'; $proj = '<project>'

# what exists, and what is red
az pipelines list --org $org -p $proj -o table
az pipelines runs list --org $org -p $proj --status completed --result failed --top 5 `
  --query "[].{id:id, name:definition.name, branch:sourceBranch, finished:finishTime}" -o table

# which step failed and why — no az verb covers the timeline, so invoke the API
az devops invoke --org $org --area build --resource timeline `
  --route-parameters project=$proj buildId=<runId> --api-version 7.1 `
  --query "records[?result=='failed'].{name:name, log:log.id, issues:issues[].message}" -o json

# that step's log
az devops invoke --org $org --area build --resource logs `
  --route-parameters project=$proj buildId=<runId> logId=<logId> --api-version 7.1

# expand the YAML and validate template parameters WITHOUT queueing anything
'{ "previewRun": true }' | Set-Content .\preview.json
az devops invoke --org $org --area pipelines --resource preview --http-method POST `
  --route-parameters project=$proj pipelineId=<id> --in-file .\preview.json --api-version 7.1
```

`jq` is not installed: shape output with `--query` (JMESPath) or pipe through `ConvertFrom-Json`.
The Azure DevOps MCP server stays the documented fallback for what `az devops invoke` cannot reach.

## Traps

1. A value is empty although the variable is set → `${{ }}` was used for something known only at run
   time → `$(var)` inside a step, `$[ ]` in a job or stage condition.
2. A secret is blank inside a script → secrets are deliberately not injected into the environment →
   map it explicitly through that step's `env:` block.
3. A variable group's values never appear → the pipeline is not authorized for it → grant it in the UI.
4. Template `parameters` used as if they were variables → they are compile-time and typed → use them
   for structure (conditional insertion, loops), variables for values.
5. The pipeline stops triggering after a path-filter change → `include` and `exclude` interact, and
   a template lives outside the filtered paths → verify with the preview endpoint.
6. The version resets or jumps → the version tool needs full history and got a shallow clone → set
   the checkout's fetch depth to 0, and re-read the branch rules in the version config file.
7. An artifact is missing in the deploy stage → the implicit download only covers the default name →
   name the artifact on publish and download it by that name.
8. A deploy stage runs on a pull-request build → the stage has no branch condition → gate deploys by
   branch **and** behind an environment with approvals; YAML alone is not the control.
9. `continue-on-error: true` hides a real failure → the job goes green with a failed step → never
   without a comment naming the reason.
10. It builds locally and fails on the agent → the agent image ships different tooling → install the
    SDK the repository needs explicitly, and pin third-party extensions to an immutable version.
11. A test-results step publishes nothing → that tree has no tests → add tests first (`test-strategy`).

## References

- `references/templates.md` — extends vs includes, typed parameters, loops, conditional insertion.
- `references/versioning.md` — the version config, branch rules, build number, version handover.
- `references/caching-and-artifacts.md` — cache keys, what must not depend on a cache, artifacts.
- `references/diagnosis.md` — a failed run from the CLI: timeline, logs, pool problems, local repro.
