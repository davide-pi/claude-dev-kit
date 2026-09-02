---
name: azdo-cli
description: >-
  Azure DevOps from the command line and the foundation every other Azure DevOps asset calls:
  configuring the default organization and project, signing in — including an organization backed by
  a different Entra tenant — WIQL queries, reading, creating, updating, commenting and linking work
  items, discovering the work item types and states a project really has, listing and reading pull
  requests, creating one, setting reviewers and completing it, listing pipeline definitions and runs
  and queueing one. Use whenever an Azure DevOps board, repository, pull request or pipeline has to
  be read or changed from a shell, when an `az devops` call fails on authentication or returns "not
  found", or when deciding whether a capability genuinely needs the MCP fallback. The CLI is always
  the first move; the MCP servers are the documented fallback.
---

# azdo-cli — Azure DevOps through `az`, with the MCP servers as the documented fallback

## When

- Anything on an Azure DevOps board, repository, pull request or pipeline has to be read or written
  from a shell.
- Another asset needs the exact verb and flags: `workitem-create`, `workitem-analyze`, `pr-review`,
  `pr-create`, `branch-flow`, `worklog`, `/ship`, `/status`, `/item`, `/fix-ci`.
- An `az devops`, `az boards`, `az repos` or `az pipelines` call fails on authentication, or reports
  a project or repository it should be able to see.
- A capability might not exist in the CLI and the fallback decision has to be made honestly.
- A flag is about to be guessed from memory.

Not for: GitHub, which is `gh` (`branch-flow`, `pr-create`); authoring pipeline YAML (`pipeline`);
deciding *what* a work item should say (`workitem-create`) or how to attack one
(`workitem-analyze`); reconstructing and logging hours (`worklog`); reviewing a diff (`pr-review`).

## Decide

### 1. Which surface owns the call

| Task | Group | Catalogue |
| --- | --- | --- |
| Organization level: projects, wikis, users, raw REST | `az devops` | `references/auth-and-config.md` |
| Work items, queries, areas, iterations | `az boards` | `references/boards-catalogue.md` |
| Repositories, pull requests, refs, branch policies | `az repos` | `references/repos-and-prs.md` |
| Pipeline definitions, runs, variables, releases | `az pipelines` | `references/pipelines-catalogue.md` |

`az devops invoke` is the raw REST escape hatch inside the CLI. It is still the CLI: reach for it
**before** an MCP tool, not after.

### 2. CLI first — and the gaps are known, not guessed

Every one of these was checked against the command groups' own `--help`. There is no verb for them.

| Capability | In the CLI | Route |
| --- | --- | --- |
| A project's work item types, their states and their field set | no | `az devops invoke` (`wit`), or WIQL-sample the values in use → MCP for the type's field set |
| Read a work item's discussion | no — `--discussion` only *writes* one | `az devops invoke` (`wit`) → MCP work-item read |
| Attach a file to a work item | no | MCP attachment tool |
| Pull request comment threads: read, create, reply, inline anchor | no | MCP PR-thread tools |
| A pipeline run's step logs | no — `runs show` returns links only | `az devops invoke` (`build`) → MCP build-log tool |
| Full-text search over code, wiki or work items | no | MCP search tools |
| Read a file's content at a ref without cloning | no | `git show <ref>:<path>` → MCP repo-file tool |
| Backlog levels and board columns | no | MCP backlog tool |

**How to tell you have hit a real gap** — two cheap signals, both before falling back:

1. The group's `--help` lists no verb for it. A *missing verb* is a gap; a *missing flag* usually
   means the verb is the wrong one.
2. `az devops invoke` would need an area, resource or route you cannot verify. An unverifiable
   route is a gap, not a thing to guess at.

Anything else is not a gap. `references/mcp-fallback.md` holds the discipline and what to say when
you use it.

### 3. Verify before typing

| Question | Answer it with |
| --- | --- |
| Does this verb exist? | `az <group> --help` — read `Commands:` and `Subgroups:` |
| Does this flag exist, and is it required? | `az <group> <verb> --help` |
| What values does the flag accept? | the same help — enums are printed as `Allowed values:` |
| What does the response actually contain? | run the read verb once with `-o json`, then add `--query` |

Never write a flag you have not seen in a `--help` output in this session. The extension
consolidates its surface over time, so memory is not evidence.

### 4. Authentication triage

| Symptom | Cause | Fix |
| --- | --- | --- |
| `az devops` prompts, or "before you can run..." | no credential for that organization | `az login`, or `az devops login --org <url>` with a PAT |
| Signed in, yet the organization is invisible | the organization is backed by a **different Entra tenant** than the current sign-in | sign in again naming the tenant: `az login --tenant <tenant-domain> --allow-no-subscriptions` |
| Works for one organization, fails for another | two organizations, two tenants, one credential | one sign-in (or one PAT) **per tenant**; see `references/auth-and-config.md` |
| "not found" on a project or repository that exists | the default `project`/`organization` points elsewhere, or the PAT lacks that scope | `az devops configure --list`, then override with `--org` / `-p` |
| A read works and the write is refused | PAT scope, or branch/board permission | check the scope before blaming the command |

## Do

```powershell
# Defaults, so every later command can omit --org and -p. They live in the az config directory
# (%USERPROFILE%\.azure), not in the repo, so they are per-machine, not per-project.
az devops configure --defaults organization=https://dev.azure.com/<org> project=<project>
az devops configure --list                      # what is set right now
az devops configure --defaults project=''       # clear one

# Who am I, on which tenant. Do this first when anything smells like permissions.
az account show --query "{user:user.name, tenant:tenantId}" -o jsonc
az devops user show --user <upn> --query "{name:user.displayName, access:accessLevel.licenseDisplayName}" -o jsonc

# Per-command override always beats the default; --detect infers the org from the git remote.
az repos pr list --org https://dev.azure.com/<other-org> -p <other-project> -o table
az boards work-item show --id <id> --detect true

# Read paths, in order of how often they are the answer.
az boards query --wiql "SELECT [System.Id],[System.Title],[System.State] FROM WorkItems WHERE [System.Id] = <id>" -o table
az boards work-item show --id <id> --expand all -o jsonc
az repos pr show --id <pr> --query "{title:title,status:status,src:sourceRefName,tgt:targetRefName}" -o jsonc
az pipelines runs list --top 5 --result failed -o table
```

## Traps

1. Command works in one repository, fails in the next → the defaults are machine-wide while the
   project is not → pass `-p` explicitly in anything scripted, or `--detect true`.
2. `az devops login` succeeds and boards still 401 → the PAT is scoped to the wrong organization or
   lacks the work-item scope → PATs are per organization and per scope; check both.
3. An organization stays invisible after a clean `az login` → its Entra tenant differs from the
   default one → `az login --tenant <tenant-domain> --allow-no-subscriptions`, and keep the tenants'
   credentials apart.
4. A WIQL query returns nothing that a saved query returns → `az boards query` supports **flat**
   queries only → rewrite the tree or one-hop query flat, or query the link table separately.
5. A create fails whole because of one field → the field does not exist on that work item type →
   discover the type's fields first; fold unsupported content into the description.
6. `--fields` silently ignored → `show` takes a **comma-separated** list while `create`/`update`
   take **space-separated** `field=value` pairs → they are different flags with the same name.
7. Reaching for an MCP tool because a flag was not found → the verb was wrong, not missing → re-read
   `Commands:` for the group before declaring a gap.
8. A PR completes by accident → `--status completed` on `update` merges immediately → completing,
   abandoning and `--bypass-policy` are irreversible; confirm before running them.

## References

- `references/auth-and-config.md` — sign-in, PAT versus Entra, multi-tenant organizations, where the
  configuration lives, per-command overrides. Read it on any auth or "not found" failure.
- `references/boards-catalogue.md` — WIQL, read, create, update, state, comment, parent/child links,
  attachments, and discovering the types and states a project really has.
- `references/repos-and-prs.md` — repositories, PR list/read/create/update, reviewers, votes,
  completion, and the thread gap.
- `references/pipelines-catalogue.md` — definitions, runs, queueing, and getting a failed run's logs.
- `references/mcp-fallback.md` — the gap list with its MCP counterpart, and the discipline for using
  it. Read it only once the CLI has actually been tried.
