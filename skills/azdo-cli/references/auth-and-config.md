# Configuration and authentication

## Where the configuration lives

The `azure-devops` extension keeps its defaults in the Azure CLI configuration directory — the one
`az --version` prints as `Config directory`, normally `.azure` under the user profile. Two
consequences worth remembering:

- The defaults are **per machine and per user**, not per repository. A working command is not proof
  that the same command works in the next clone.
- Nothing in the repository selects the organization. If a project needs a different one, either
  pass `--org`/`-p`, or let `--detect true` read it from the git remote.

```powershell
az devops configure --defaults organization=https://dev.azure.com/<org> project=<project>
az devops configure --list                     # read back what is set
az devops configure --defaults project=''      # clear one default
az devops configure --use-git-aliases true     # optional: enables `git pr list` and friends
```

## Precedence, from strongest to weakest

| Rank | Source | Notes |
| --- | --- | --- |
| 1 | `--org` / `--organization`, `--project` / `-p` on the command | always wins; the form to use in anything scripted |
| 2 | `--detect true` | infers the organization from the current repository's remote |
| 3 | `az devops configure --defaults` | the machine default |
| 4 | nothing | the command fails asking for the organization |

Every verb in `az devops`, `az boards`, `az repos` and `az pipelines` accepts `--org`; every
project-scoped verb also accepts `-p`. Organization-level verbs (`az devops project list`,
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
# Interactive, Entra
az login
az account show --query "{user:user.name, tenant:tenantId}" -o jsonc

# PAT, non-interactive. Keep the token out of the shell history and out of any file in the repo.
$env:AZURE_DEVOPS_EXT_PAT = (Read-Host -AsSecureString | ConvertFrom-SecureString -AsPlainText)
az devops login --org https://dev.azure.com/<org>
```

## The case that actually bites: an organization on a different Entra tenant

An Azure DevOps organization is backed by exactly one Entra tenant. Work across two organizations
whose tenants differ and a single `az login` covers only one of them. The failure is confusing
because nothing says "wrong tenant": the CLI is signed in, and the organization simply behaves as if
it did not exist — an empty project list, or a "not found" on a project that is open in the browser.

Sign in naming the tenant. `--allow-no-subscriptions` matters because a tenant that exists only to
back a DevOps organization often has no Azure subscription at all, and without the flag the sign-in
refuses to complete.

```powershell
az login --tenant <tenant-domain> --allow-no-subscriptions
az account show --query tenantId -o tsv          # confirm which tenant is now current
az devops project list --org https://dev.azure.com/<org> --query "value[].name" -o tsv
```

Both tenants stay in the account list once signed in; `az account show` reports which is current and
`az login --tenant …` switches. Treat the tenant as part of the organization's identity: record it
next to the organization URL, so the next failure takes one command instead of an investigation.

A PAT sidesteps tenants entirely — it is issued by the organization, not by a tenant — which makes
it the pragmatic answer for the second organization when switching sign-ins becomes tiresome.

```powershell
# Per-tenant token, when a raw REST call needs a bearer rather than the extension's own credential.
az account get-access-token --tenant <tenant-domain> --query accessToken -o tsv
```

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

Run `az devops invoke` with no `--area`/`--resource` to list every area and resource the
organization exposes — the authoritative way to learn a name instead of guessing it. It enumerates
the whole surface and is slow, so run it once and keep the output. If you cannot verify the area,
resource and route this way, treat the capability as a genuine gap and read `mcp-fallback.md`.
