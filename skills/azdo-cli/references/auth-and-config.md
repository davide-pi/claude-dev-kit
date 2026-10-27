# Configuration and authentication

## Configuration

Never rely on defaults (`az devops configure`, `--detect true`): they are per machine and user, and may point at
another client. Pass `--org` and `-p` on every call. Organization-level verbs (`az devops project list`,
`az devops user list`, `az boards work-item relation list-type`) take only `--org`.

## Two credential models

| Model | How | Good for |
| --- | --- | --- |
| **Entra sign-in** | `az login`, then `az devops …` reuses the Azure CLI token | interactive work; nothing to store or rotate |
| **PAT** | `az devops login --org <url>`, then paste the token, or set `AZURE_DEVOPS_EXT_PAT` | non-interactive contexts, and organizations where the interactive sign-in is awkward |

`az devops login` binds a PAT to **one organization**. `az devops logout` clears it — with `--org`
for one organization, without it for all of them. A PAT carries scopes: a token that reads work
items does not necessarily write them, and one that reads code does not necessarily complete a PR.
When a read succeeds and the matching write is refused, suspect the scope before the command.

```powershell
# PAT, non-interactive. Keep the token out of the shell history and out of any file in the repo.
$env:AZURE_DEVOPS_EXT_PAT = (Read-Host -AsSecureString | ConvertFrom-SecureString -AsPlainText)
az devops login --org https://dev.azure.com/<org>
```

## The case that actually bites: an organization on a different Entra tenant

An organization is backed by one Entra tenant; a single `az login` covers one. Nothing says "wrong tenant":
the organization behaves as if it did not exist (an empty project list, "not found" on a project open in the
browser). Sign in naming the tenant; `--allow-no-subscriptions` is needed when the tenant has no Azure subscription.

```powershell
az login --tenant <tenant-domain> --allow-no-subscriptions
az account show --query tenantId -o tsv          # confirm which tenant is now current
az devops project list --org https://dev.azure.com/<org> --query "value[].name" -o tsv
```

Both tenants stay in the account list; `az account show` reports the current one and `az login --tenant …`
switches. Record the tenant next to the organization URL. A PAT is issued by the organization, so it sidesteps tenants.

```powershell
# Per-tenant bearer for a raw REST call.
az account get-access-token --tenant <tenant-domain> --query accessToken -o tsv
```

## One az identity per workspace root

`az account set` and `az login` switch a **machine-global** default: two sessions on roots of
different tenants flip each other mid-command. Never run `az account set`. Each identity owns a
private config dir `~/.azure-<identity>` (signed in once into that dir); the SessionStart hook
`workspace-context.js` reads `workspaces.json` and exports `AZURE_CONFIG_DIR` (Bash) and
`AZ_IDENTITY` (PowerShell drops values holding `\`). The shell guard (`guard-shell.js`) then pins the
identity itself: an `az` command the allow list already covers (the read-only queries), in a mapped
directory, is rewritten to start with `$env:AZURE_CONFIG_DIR='<dir>'; ` (PowerShell) or
`AZURE_CONFIG_DIR='<dir>' ` (Bash), unless it already sets one or ends in `# raw`.

**Fallback, by hand.** Every other `az` call — a write, `cd x && az …`, a redirect, a pipe into a tool
no allow rule names — is not rewritten, so in PowerShell prefix it yourself:

```powershell
$env:AZURE_CONFIG_DIR="$HOME\.azure-$env:AZ_IDENTITY"; az boards query --org https://dev.azure.com/<org> ...
```

Git credentials follow the same split, bound once per organization:
`git credential-manager azure-repos bind <org> <user>`.

## Resolving the identity to assign to

`--assigned-to` needs a value the **organization** can resolve, and that is not the machine's git
identity: an organization backed by a different Entra tenant knows the same person under a different
UPN, so `git config user.email` is a plausible-looking wrong answer that silently assigns nobody.
Resolve it against the organization, every run:

```powershell
# Canonical: ask the service who @Me is, and read the UPN back off any item it already owns.
az boards query --org <org-url> -p <project> `
  --wiql "SELECT [System.Id],[System.AssignedTo] FROM WorkItems WHERE [System.AssignedTo] = @Me ORDER BY [System.ChangedDate] DESC" `
  --query "[0].fields.\"System.AssignedTo\".{name:displayName, upn:uniqueName}" -o jsonc
```

| Order | Source | When it fails |
| --- | --- | --- |
| 1 | the WIQL `@Me` probe above | the signed-in identity owns no item in that project — a genuinely new project |
| 2 | `az account show --query user.name -o tsv`, then confirm it exists in the organization with `az devops user list --org <org-url> --query "items[].user.mailAddress" -o tsv` | the tenant signed in is not the organization's |
| 3 | ask which identity to use, listing what `az devops user list` returned | — |

Resolve once per organization and reuse it for the whole run. Never carry an identity over from
another organization, and never write one into a skill, a script or a template.

## Discovery, once signed in

```powershell
az devops project list --query "value[].{name:name, id:id}" -o table
az devops project show --project <project> --query "{process:capabilities.processTemplate.templateName}" -o jsonc
az devops user list --top 200 --query "items[].user.mailAddress" -o tsv
az devops user show --user <upn> -o jsonc
az repos list -p <project> --query "[].{name:name, default:defaultBranch}" -o table
```

`az devops project show` is also how you find out which process a project runs on — read it rather
than assuming a template, because the work item types and states follow from it.

## The escape hatch inside the CLI

`az devops invoke` calls any Azure DevOps REST endpoint with the credential already configured, so
it stays on the CLI side of the CLI-before-MCP rule.

```powershell
az devops invoke --area <area> --resource <resource> `
  --route-parameters project=<project> `
  --query-parameters api-version=<version> `
  --http-method GET -o json
```

| Flag | Use |
| --- | --- |
| `--area`, `--resource` | the REST area and resource names |
| `--route-parameters` | the `{…}` segments of the route, as `name=value` pairs |
| `--query-parameters` | the query string, same shape |
| `--http-method` | `GET` by default; `POST`/`PATCH`/`PUT`/`DELETE` for writes |
| `--in-file`, `--media-type` | the request body for a write, and its content type |
| `--out-file`, `--accept-media-type` | write the response to a file; ask for a non-JSON response |
| `--api-version` | pin the API version when the default is too old for the endpoint |

Run `az devops invoke` with no `--area`/`--resource` to list every area and resource the organization
exposes. It is slow: run it once and keep the output. The three tests before a gap: `mcp-fallback.md`.

## Triage by symptom

| Symptom | Cause | Fix |
| --- | --- | --- |
| prompts, or "before you can run…" | no credential for that org | `az login`, or `az devops login --org <url>` with a PAT |
| signed in, yet the org is invisible | the org lives on another Entra tenant | `az login --tenant <tenant-domain> --allow-no-subscriptions`; one sign-in per tenant |
| "not found" on something that exists | org/project defaulted elsewhere, or PAT scope | re-read the `ALM:` line, pass `--org` / `-p` |
| wrong account used | the shared az config dir | the shell guard pins `AZURE_CONFIG_DIR` per root on the `az` commands it can (read-only ones); prefix the rest by hand; never `az account set` (machine-global) — `references/auth-and-config.md` |
