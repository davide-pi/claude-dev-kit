---
name: azdo-cli
description: >-
  Azure DevOps from the command line and the foundation every other Azure DevOps asset calls:
  resolving the organization and project instead of trusting a default, signing in — including an
  organization on a different Entra tenant — WIQL queries, reading, creating, updating, commenting
  and linking work items, discovering the fields, types and states a project really has, attaching
  files and inlining images, reading and writing wiki pages, pull requests from listing to
  completion, and pipeline definitions, runs and queueing. Use whenever an Azure DevOps board,
  repository, pull request, wiki or pipeline has to be read or changed from a shell, when an
  `az devops` call fails on authentication or returns "not found", or when deciding whether a
  capability genuinely needs the MCP fallback. The CLI is the first move; MCP is the fallback.
---

# azdo-cli — Azure DevOps through `az`, with the MCP servers as the documented fallback

## When

- An Azure DevOps board, repository, pull request, wiki or pipeline has to be read or written from
  a shell — or the organization and project the work belongs to have to be resolved first.
- Another asset needs the exact verb and flags: `workitem-create`, `workitem-analyze`, `pr-review`,
  `pr-create`, `branch-flow`, `worklog`, `/ship`, `/status`, `/item`, `/fix-ci`.
- A call fails on authentication, or cannot see a project or repository it should.
- A capability might not exist in the CLI and the fallback decision has to be made honestly, or a
  flag or a field reference name is about to be guessed from memory.

Not for: GitHub, which is `gh` (`branch-flow`, `pr-create`); authoring pipeline YAML (`pipeline`);
deciding *what* a work item should say (`workitem-create`) or how to attack one
(`workitem-analyze`); reconstructing and logging hours (`worklog`); reviewing a diff (`pr-review`).

## Decide

### 1. The organization and the project outrank every other rule here

**Never hardcode an organization or a project, and never trust the configured default.** The
`az devops configure` defaults may still point at the previous session's client, which is how work
lands in the wrong customer's project. Resolve both from the **current working directory**, through
the workspace-to-platform mapping the user keeps in their `CLAUDE.md`, and pass them explicitly with
`--org` and `-p` on every command. If the path is not mapped, **ask** — never guess, and never let
`--detect` or the machine default fill the hole.

`-p` is not a filter, either: **`az boards query --project` does not scope reliably** — it has been
observed returning work items of other projects. Every WIQL therefore repeats the scope itself,
`WHERE [System.TeamProject] = '<project>'`, in addition to `-p`.

### 2. Which surface owns the call

| Task | Group | Catalogue |
| --- | --- | --- |
| Organization level: projects, users, raw REST | `az devops` | `references/auth-and-config.md` |
| Work items, queries, areas, iterations | `az boards` | `references/boards-catalogue.md` |
| Work item fields, attachments, inline images | `az boards` + REST | `references/workitem-content.md` |
| Wiki: page tree, read, create, update | `az devops wiki` + REST | `references/wiki-rest.md` |
| Repositories, pull requests, refs, branch policies | `az repos` | `references/repos-and-prs.md` |
| Pipeline definitions, runs, variables, releases | `az pipelines` | `references/pipelines-catalogue.md` |

`az devops invoke` is the raw REST escape hatch inside the CLI — still the CLI, so reach for it
**before** an MCP tool. So is a REST call bearing the token of the current `az login`:
`az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798` — the fixed Azure
DevOps resource id, identical in every organization, no PAT.

### 3. CLI first — and the gaps are known, not guessed

No verb exists for these — checked against each group's own `--help`.

| No verb for | Nearest route still inside the CLI |
| --- | --- |
| A type's states and field set; a work item's discussion (`--discussion` only *writes*) | `az devops invoke --area wit`, or WIQL-sample the values in use |
| A pipeline run's step logs (`runs show` returns links only) | `az devops invoke --area build` |
| PR comment threads; full-text search; backlog levels and board columns | none — these are the genuine MCP cases |

**Two things that are no longer gaps**, because that token reaches them — do not fall back:
attachments (POST the bytes, then PATCH an `AttachedFile` relation — but on a Bug inline the image
in the field instead: `references/workitem-content.md`), and wiki page writes plus the page tree (the
write verbs corrupt accents and there is no `list` verb: `references/wiki-rest.md`).
**A real gap needs both signals**: `--help` lists no verb (a missing *flag* usually means the wrong
verb), and `az devops invoke` would need a route you cannot verify.

### 4. Verify before typing

| Question | Answer it with |
| --- | --- |
| Does this verb exist? | `az <group> --help` — read `Commands:` and `Subgroups:` |
| Does this flag exist, is it required, what values does it take? | `az <group> <verb> --help` — enums print as `Allowed values:` |
| What does the response actually contain? | run the read verb once with `-o json`, then add `--query` |
| Does this type have that field? | never assume — `references/workitem-content.md`, section 1 |

Never write a flag, or a field reference name, you have not seen in output this session.

### 5. Authentication triage

| Symptom | Cause | Fix |
| --- | --- | --- |
| `az devops` prompts, or "before you can run..." | no credential for that organization | `az login`, or `az devops login --org <url>` with a PAT |
| Signed in, yet the organization is invisible, or one organization works and the next does not | the organization is backed by a **different Entra tenant** than the current sign-in | sign in naming the tenant: `az login --tenant <tenant-domain> --allow-no-subscriptions`; one sign-in or PAT **per tenant** |
| "not found" on a project or repository that exists | the org/project passed (or defaulted) points elsewhere, or the PAT lacks that scope | re-resolve per decision 1, then pass `--org` / `-p` explicitly |
| A read works and the matching write is refused | PAT scope, or branch/board permission — PATs are per organization **and** per scope | check the scope before blaming the command |

## Do

```powershell
$org = 'https://dev.azure.com/<org>'; $proj = '<project>'   # resolved from the path — decision 1
az account show --query "{user:user.name, tenant:tenantId}" -o jsonc   # who and which tenant
az devops configure --list        # inspect the machine default; never rely on it

# Reads, most useful first. The scope lives in the WIQL, not only in -p.
$w = "SELECT [System.Id],[System.Title],[System.State] FROM WorkItems WHERE [System.TeamProject] = '$proj' AND [System.Id] = <id>"
az boards query --org $org -p $proj --wiql $w -o table
az boards work-item show --org $org --id <id> --expand all -o jsonc
az repos pr show --org $org --id <pr> --query "{title:title,status:status,tgt:targetRefName}" -o jsonc

# The bearer for the REST steps with no verb: attachments, inline images, wiki writes.
$token = az account get-access-token --resource 499b84ac-1321-427f-aa17-267ca6975798 --query accessToken -o tsv
```

## Traps

1. A query returns items nobody recognises → `--project` did not scope it → repeat
   `[System.TeamProject] = '<project>'` inside the WIQL, every time.
2. Works in one repository, fails in the next → machine-wide defaults → pass `--org` / `-p` always.
3. An organization stays invisible after a clean `az login` → its Entra tenant differs → `az login
   --tenant <tenant-domain> --allow-no-subscriptions`.
4. A WIQL query returns nothing a saved query returns → `az boards query` is **flat**-only → rewrite
   it flat, or query the link table separately.
5. A created item looks empty on the board → the text went into a field the form does not show, and
   a Bug has no Description field at all → discover the type's real fields first.
6. An image on a Bug goes unnoticed → an `AttachedFile` relation only shows in the Attachments tab →
   inline the `<img>` into the field's existing HTML instead.
7. An accented wiki page reads as mojibake → `wiki page create`/`update` re-read the content in the
   system codepage → write over REST with `charset=utf-8`, then read the page back.
8. `--fields` ignored → `show` wants a **comma-separated** list, `create`/`update` **space-separated**
   `field=value` pairs → different flags, same name.
9. Reaching for MCP because a flag was not found → the verb was wrong → re-read `Commands:` first.
10. A PR completes by accident → `--status completed` on `update` merges at once; that, abandoning
    and `--bypass-policy` are irreversible → confirm first.

## References

- `references/auth-and-config.md` — sign-in, PAT versus Entra, multi-tenant organizations,
  precedence, `az devops invoke`. Read it on any auth or "not found" failure.
- `references/boards-catalogue.md` — WIQL and its scoping rule, read, create, update, state,
  comment, links, and discovering the types and states a project really has.
- `references/workitem-content.md` — a type's real field reference names, the Bug form's three
  fields, attaching and inlining an image over REST. Read it before writing any field.
- `references/wiki-rest.md` — the page tree, reading a page, writing one over REST with the eTag
  discipline. Read it before any wiki write.
- `references/repos-and-prs.md` — repositories, PRs, reviewers, votes, completion, reading a file at
  a ref, the thread gap.
- `references/pipelines-catalogue.md` — definitions, runs, queueing, a failed run's logs.
- `references/mcp-fallback.md` — the gap list, its MCP counterpart, the discipline. Read it last.
