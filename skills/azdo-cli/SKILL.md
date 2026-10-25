---
name: azdo-cli
description: >-
  Use when an Azure DevOps item, PR, wiki or pipeline is written via `az`, a type name is
  resolved, or an `az` call fails.
---

# azdo-cli — Azure DevOps through `az`, MCP only for a proven gap

**Contract.** Exact `az` calls with explicit `--org` and `-p` · never the `az devops configure`
default, never an MCP call before the gap is proven · chat Italian, commands and output verbatim.

## When

- A board, work item, repository, PR, wiki or pipeline is written from a shell, or read beyond a plain
  item view (a plain item read is `item`).
- Another asset needs the verb and flags: `workitem-create`, `pr-create`, `pr-review`,
  `branch-flow`, `worklog`, `items-qa`, `estimate`.
- A type name, field reference or flag is about to be typed, or a call fails on auth or "not found".

Not for: GitHub (`gh`, in `branch-flow` and `pr-create`); pipeline YAML (`pipeline`); what an item
should say (`user-story-standard`).

## Decide

### 1. Target — the `ALM:` line, passed on every call

Org, project and az identity come from the session's `ALM:` line (written at start by the
`workspace-context.js` hook from the local `workspaces.json`). Pass `--org` and `-p` on **every**
command. No line, `unmapped`, or a directory added later → **ask**; never let `--detect` or the
machine default fill the hole — it may still point at the previous client. `-p` does not scope a
query reliably: every WIQL repeats `WHERE [System.TeamProject] = '<project>'`.

### 2. Which surface owns the call

| Task | Group | Catalogue |
| --- | --- | --- |
| Org level: projects, users, raw REST | `az devops` | `references/auth-and-config.md` |
| Work items, queries, areas, iterations | `az boards` | `references/boards-catalogue.md` |
| Which type name fills a role here | `az devops invoke` | `references/work-item-roles.md` |
| Fields, attachments, inline images | `az boards` + REST | `references/workitem-content.md` |
| Wiki tree, read, create, update | `az devops wiki` + REST | `references/wiki-rest.md` |
| Repos, PRs, refs, branch policies | `az repos` | `references/repos-and-prs.md` |
| Pipelines, runs, variables, logs | `az pipelines` | `references/pipelines-catalogue.md` |

`az devops invoke` reaches any REST route with the current login — it is still the CLI. For a call
with no verb at all, the bearer token of `az login` drives plain REST (resource id in `## Do`).

### 3. CLI first — gaps are a list, not a feeling

`references/mcp-fallback.md` is the **single owner** of the gap list; other assets point there. Not
gaps: types and states, a work item's discussion, PR threads, run logs (`invoke`); attachments,
inline images, wiki writes (REST with the login token). A real gap needs both: `--help` lists no
verb **and** no `invoke` route can be verified. The `azdo-*` MCP servers sit behind an `ask`
permission: before the call, say in one line which capability and which CLI route failed.

### 4. A type name is discovered, never assumed

Type names come from the process template and are case-sensitive; the technical-activity type is
often custom. **Before any `--type`, WIQL predicate or confirmation table that names a type, list the
project's types** (`invoke --area wit --resource workItemTypes`) and use a name only as returned. The
role table in `references/work-item-roles.md` is a hypothesis to confirm. `Issue` is the *analysis*
role on Agile and the *backlog item* on Basic. No type fills a role → say so and ask; never
substitute the nearest. Only the time role (`Task`) carries hours; a PR links the item above a Task
(`references/work-item-roles.md` §5–6).

### 5. Verify before typing

| Question | Answer it with |
| --- | --- |
| Does this verb exist? | `az <group> --help` — `Commands:` and `Subgroups:` |
| Does this flag exist, which values? | `az <group> <verb> --help` — enums print as `Allowed values:` |
| What does the response contain? | the read verb once with `-o json`, then `--query` |
| Does this type have that field? | `references/work-item-roles.md` §1, then `references/workitem-content.md` §1 |

### 6. Authentication triage

Prompts, an org that is invisible after sign-in, "not found" on something that exists, the wrong account:
the symptom table in `references/auth-and-config.md` § Triage by symptom.

## Do

```powershell
$org = 'https://dev.azure.com/<org>'; $proj = '<project>'   # from the ALM: line
az account show --query "{user:user.name, tenant:tenantId}" -o jsonc
az devops invoke --org $org --area wit --resource workItemTypes --route-parameters project=$proj --query "value[].name" -o tsv
$w = "SELECT [System.Id],[System.Title],[System.State] FROM WorkItems WHERE [System.TeamProject] = '$proj' AND [System.Id] = <id>"
az boards query --org $org -p $proj --wiql $w -o table
az boards work-item show --org $org --id <id> --fields System.Title,System.State -o jsonc
az repos pr show --org $org --id <pr> --query "{title:title,status:status,tgt:targetRefName}" -o jsonc
$token = az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv   # REST bearer
```

## Traps

1. A WIQL returns nothing a saved query returns → `az boards query` is flat-only → rewrite it flat,
   or query the link table separately.
2. A created item looks empty, or its image goes unnoticed → the text went into a field the form
   does not show (a Bug has no Description) and an `AttachedFile` shows only in Attachments →
   discover the type's fields; inline the `<img>` into the field HTML.
3. An accented wiki page reads as mojibake → `wiki page create`/`update` re-read the content in the
   system codepage → REST `PUT` with `charset=utf-8`, then read it back.
4. `--fields` ignored → `show` wants a comma list, `create`/`update` space-separated `field=value`.
5. A PR completes by accident → `--status completed` merges at once → confirm it, abandon and
   `--bypass-policy` with the user first.

## References

- `references/auth-and-config.md` — any auth or "not found" failure: sign-in, PAT versus Entra,
  tenants, the per-root config dir, the identity to assign to.
- `references/boards-catalogue.md` — before any WIQL or work item write: queries, reads, updates, links.
- `references/work-item-roles.md` — before naming a type: role-to-type per template, the confirming query.
- `references/workitem-content.md` — before writing any field: real field names, the Bug form, images.
- `references/wiki-rest.md` — before any wiki write: the page tree, reading, the REST `PUT` and eTag.
- `references/repos-and-prs.md` — anything on a repository or a PR: reviewers, votes, completion, threads.
- `references/pipelines-catalogue.md` — anything on a pipeline: definitions, runs, queueing, failed logs.
- `references/mcp-fallback.md` — only once the CLI is exhausted: the gap list and its counterparts.
