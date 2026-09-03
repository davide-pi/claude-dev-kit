---
name: azdo-cli
description: >-
  Azure DevOps from the command line, and the foundation every other Azure DevOps asset calls:
  resolving the organization and project instead of trusting a default, signing in — including an
  organization on a different Entra tenant — WIQL queries, reading, creating, updating, commenting
  and linking work items, the fields, states and types a project really has and which type name
  fills each role (backlog item, defect, analysis, technical activity, time, grouping), attachments
  and inline images, wiki pages, pull requests from listing to completion, and pipelines. Use
  whenever an Azure DevOps board, repository, pull request, wiki or pipeline has to be read or
  changed from a shell, when a work item type has to be named, when an `az devops` call fails on
  authentication or returns "not found", or when a capability may need MCP. CLI first, MCP fallback.
---

# azdo-cli — Azure DevOps through `az`, with the MCP servers as the documented fallback

## When

- A board, repository, pull request, wiki or pipeline has to be read or written from a shell — or
  the organization, the project or the work item **type** it belongs to has to be resolved first.
- Another asset needs the exact verb and flags: `workitem-create`, `workitem-analyze`, `pr-review`,
  `pr-create`, `branch-flow`, `worklog`, `/ship`, `/status`, `/item`, `/fix-ci`.
- A call fails on authentication, or cannot see a project or repository it should.
- A capability might not exist in the CLI and the fallback decision has to be made honestly, or a
  flag, a field reference name or a **type name** is about to be guessed from memory.

Not for: GitHub, which is `gh` (`branch-flow`, `pr-create`); authoring pipeline YAML (`pipeline`);
deciding *what* a work item should say (`workitem-create`) or how to attack one
(`workitem-analyze`); reconstructing and logging hours (`worklog`); reviewing a diff (`pr-review`).

## Decide

### 1. The organization and the project outrank every other rule here

**Never hardcode an organization or a project, and never trust the configured default.** The
`az devops configure` defaults may still point at the previous session's client, which is how work
lands in the wrong customer's project. Resolve both from the **current working directory**, through
the workspace-to-platform mapping the user keeps in their `CLAUDE.md`, and pass them with `--org`
and `-p` on every command. If the path is not mapped, **ask** — never let `--detect` or the machine
default fill the hole. `-p` is not a filter either: **`az boards query --project` does not scope
reliably**, having returned items of other projects, so every WIQL repeats the scope itself,
`WHERE [System.TeamProject] = '<project>'`, in addition to `-p`.

### 2. Which surface owns the call

| Task | Group | Catalogue |
| --- | --- | --- |
| Organization level: projects, users, raw REST | `az devops` | `references/auth-and-config.md` |
| Work items, queries, areas, iterations | `az boards` | `references/boards-catalogue.md` |
| Which type name fills a role here | `az devops invoke` | `references/work-item-roles.md` |
| Work item fields, attachments, inline images | `az boards` + REST | `references/workitem-content.md` |
| Wiki: page tree, read, create, update | `az devops wiki` + REST | `references/wiki-rest.md` |
| Repositories, pull requests, refs, branch policies | `az repos` | `references/repos-and-prs.md` |
| Pipeline definitions, runs, variables, releases | `az pipelines` | `references/pipelines-catalogue.md` |

`az devops invoke` is the raw REST escape hatch **inside** the CLI — reach for it before any MCP
tool, as for a REST call bearing the token of the current `az login` (the resource id is in `Do`).

### 3. CLI first — and the gaps are known, not guessed

The genuine gaps are few, and each is listed with its counterpart in `references/mcp-fallback.md`:
PR comment threads, full-text search, backlog levels and board columns, and a type's field set. A
type's states, a work item's discussion and a run's step logs are **not** gaps — `az devops invoke`
on the `wit` and `build` areas reaches them, and the `az login` token reaches attachments, inline
images and wiki writes over REST. **A real gap needs both signals**: `--help` lists no verb (a
missing *flag* usually means the wrong verb), and `invoke` would need a route you cannot verify.

### 4. A work item type name is discovered, never assumed

Type names come from the project's **process template** and are **case-sensitive**; the
technical-activity type is usually **custom**, so it exists only where someone created it.
**Query the project's own type list before any command, WIQL predicate or confirmation table that
names a type; a name from the role table is used only after that query has returned it, spelled
identically.** That query is `invoke --area wit --resource workItemTypes`, and the role-to-type
table in `references/work-item-roles.md` is a hypothesis to confirm, never a source of names.

`Issue` is why this is not advisory: in **Agile** it fills the *analysis* role, in **Basic** it is
the *backlog item* — one name, two meanings, so a name taken from a table without checking lands in
the wrong place. When the project has no type for a role, **say so and ask**; never substitute the
closest one. Two facts the rest of the kit routes here for: the time role (`Task`) is the **only**
type that carries hours, and a pull request never links a Task — a PR links the backlog item, defect
or analysis item above it. Walking that hierarchy: `references/work-item-roles.md`, sections 5-6.

### 5. Verify before typing

Never write a flag, a field reference name or a type name you have not seen in output this session.

| Question | Answer it with |
| --- | --- |
| Does this verb exist? | `az <group> --help` — read `Commands:` and `Subgroups:` |
| Does this flag exist, is it required, what values does it take? | `az <group> <verb> --help` — enums print as `Allowed values:` |
| What does the response actually contain? | run the read verb once with `-o json`, then add `--query` |
| Does this project have that type, and the type that field? | never assume a process — `references/work-item-roles.md` §1, then `references/workitem-content.md` §1 |

### 6. Authentication triage

| Symptom | Cause | Fix |
| --- | --- | --- |
| `az devops` prompts, or "before you can run..." | no credential for that organization | `az login`, or `az devops login --org <url>` with a PAT |
| Signed in, yet the organization is invisible, or one organization works and the next does not | the organization is backed by a **different Entra tenant** than the current sign-in | sign in naming the tenant: `az login --tenant <tenant-domain> --allow-no-subscriptions`; one sign-in or PAT **per tenant** |
| "not found" on a project or repository that exists | the org/project passed (or defaulted) points elsewhere, or the PAT lacks that scope | re-resolve per decision 1, then pass `--org` / `-p` explicitly |

## Do

```powershell
$org = 'https://dev.azure.com/<org>'; $proj = '<project>'   # resolved from the path — decision 1
az account show --query "{user:user.name, tenant:tenantId}" -o jsonc   # who and which tenant
az devops configure --list        # inspect the machine default; never rely on it
az devops invoke --org $org --area wit --resource workItemTypes --route-parameters project=$proj --query "value[].name" -o tsv   # the types this project really has — before any --type
# Reads, most useful first. The scope lives in the WIQL, not only in -p.
$w = "SELECT [System.Id],[System.Title],[System.State] FROM WorkItems WHERE [System.TeamProject] = '$proj' AND [System.Id] = <id>"
az boards query --org $org -p $proj --wiql $w -o table
az boards work-item show --org $org --id <id> --expand all -o jsonc
az repos pr show --org $org --id <pr> --query "{title:title,status:status,tgt:targetRefName}" -o jsonc
$token = az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv   # bearer for the REST steps with no verb
```

## Traps

1. A query returns items nobody recognises → `--project` did not scope it → repeat
   `[System.TeamProject] = '<project>'` inside the WIQL, every time.
2. Works in one repository, fails in the next → machine-wide defaults → pass `--org` / `-p` always.
3. An organization stays invisible after a clean `az login` → its Entra tenant differs → `az login
   --tenant <tenant-domain> --allow-no-subscriptions`.
4. A WIQL query returns nothing a saved query returns → `az boards query` is **flat**-only → rewrite
   it flat, or query the link table separately.
5. `--type` is rejected, or the item lands as the wrong kind of thing → the name came from another
   process template → list `workItemTypes` first; `Issue` is *analysis* on Agile, *backlog* on Basic.
6. A created item looks empty, or an image on a Bug goes unnoticed → the text went into a field the
   form does not show (a Bug has no Description at all), and an `AttachedFile` relation shows only in
   the Attachments tab → discover the type's real fields, and inline the `<img>` into the field HTML.
7. An accented wiki page reads as mojibake → `wiki page create`/`update` re-read the content in the
   system codepage → write over REST with `charset=utf-8`, then read the page back.
8. `--fields` ignored → `show` wants a **comma-separated** list, `create`/`update` **space-separated**
   `field=value` pairs → different flags, same name.
9. Hours logged on the wrong item, or a PR linked to a Task → only the time role carries hours, and
   a PR links the item above it → `references/work-item-roles.md`, section 5.
10. A PR completes by accident → `--status completed` on `update` merges at once; that, abandoning
    and `--bypass-policy` are irreversible → confirm first.

## References

- `references/auth-and-config.md` — any auth or "not found" failure: sign-in, PAT versus Entra, tenants.
- `references/boards-catalogue.md` — before any WIQL or work item write: queries, reads, updates, links.
- `references/work-item-roles.md` — before naming a type: role-to-type per template, the confirming query.
- `references/workitem-content.md` — before writing any field: real field names, the Bug form, images.
- `references/wiki-rest.md` — before any wiki write: the page tree, reading, the REST `PUT` and eTag.
- `references/repos-and-prs.md` — anything on a repository or a PR: reviewers, votes, completion, threads.
- `references/pipelines-catalogue.md` — anything on a pipeline: definitions, runs, queueing, failed logs.
- `references/mcp-fallback.md` — only once the CLI is exhausted: the gap list and its counterparts.
