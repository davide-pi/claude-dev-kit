# estimate — guide for people

> For whoever uses or installs the skill. The skill never reads this file: its instructions are
> `SKILL.md` and `references/`.

**`/estimate` sizes a piece of work in hours by deducing it from the request and from everything the
team completed on Azure DevOps in the last 3 months — after deciding whether the requirements allow
an honest estimate at all — and states how approximate the result is.**

## 1. How it works

| Phase | What happens |
| --- | --- |
| 1. Input | a work item (`/estimate 12345`), pasted text or a file; org and project from the session's `ALM:` line |
| 2. Sufficiency | a check of the existing code (when a repository is at hand), then a **functional-only** checklist — written for a PO, not a developer — reviewed by judgement → **sufficiente**, **scarso** or **insufficiente**. Missing technical detail becomes a declared assumption |
| 3. Market (optional) | only on request: similar products on the web → a checklist of expected features, never hours |
| 4. History | `candidates.ps1` reads **every** item closed in the last 3 months (6 when fewer than 10), with hours, owner and outliers marked, and writes an index meant to be read whole |
| 5. Deduction | the model derives the team's "price list" from the history (what an endpoint, a screen, a table costs), decomposes the request and sizes each component against the work it resembles in structure, always citing the reference items |
| 6. Report | estimate per component with its references (`AB#id`, hours), the approximation and its sources, days, compreso / NON compreso, calibration |

**The three levels:**

| Level | Result |
| --- | --- |
| Sufficiente | `50h – 60h (+20%) · 6,5 – 7,5 giorni` — approximation at most +20% |
| Scarso | same shape, approximation at most +40%, plus the list of what is missing |
| Insufficiente | no hours: an order of magnitude and the questions for the PO |

**Rules that matter:**

| Rule | Effect |
| --- | --- |
| Tag `estimation-excluded` | the item is never used; children inherit it (Feature → backlog item → Task) |
| Hours | the Tasks' `CompletedWork`; `OriginalEstimate` only when that is missing, corrected by your historical error; neither → discarded |
| Outliers | the shortest and the longest 10% of the team (5% and 5% for a person) never act as references |
| References | each component cites the items it was sized against; with nothing comparable it is a declared **stima a giudizio** |
| Approximation | a sum of declared shares: requirement level (+10% / +25%), reference quality, disagreement between references, thin history |
| Person | named → their own items first (more than half the hours theirs); fewer than 5 → team items **+5%** |
| Total | the sum of the components, in hours and in **days** (8h/day unless told otherwise) |
| Calibration | every estimate is saved under `$HOME\.claude\estimate\history`; `calibrate.ps1` compares it with the hours logged after closure. A report only: it corrects nothing automatically |

**Examples:**

```text
/estimate 12345
/estimate 12345 per <user>@<domain>
/estimate <PO text> analisi di mercato
/estimate 12345 commenta
```

`commenta` posts the result on the work item, only after you approve the text. The skill never
writes fields, tags or states.

## 2. Installing the skill

**With the kit** (recommended), from the kit repository root:

```powershell
.\install.ps1          # copies skills, agents, hooks, rules, workflows and scripts into the Claude config
.\install.ps1 -Check   # verifies: exit 1 when something is missing or differs
```

**By hand**, without the kit: copy the whole `skills/estimate` folder to
`$HOME\.claude\skills\estimate` and restart Claude Code. Check: typing `/estimate` must show the skill
among the suggestions.

## 3. Prerequisites

| What | Why | Check |
| --- | --- | --- |
| PowerShell 7 (`pwsh`) | the scripts require it | `pwsh -v` |
| Azure CLI with the `azure-devops` extension | reads boards and work items | `az extension show --name azure-devops` |
| Access to the Azure DevOps project | read permission on work items | the check below |
| Azure DevOps MCP (optional) | only for what the CLI lacks (full-text search) | `claude mcp list` |
| Node.js with `npx` (MCP only) | starts the MCP server | `npx -v` |

### Azure CLI

```powershell
winget install --exact --id Microsoft.PowerShell      # if pwsh 7 is missing
winget install --exact --id Microsoft.AzureCLI        # then open a new terminal
az extension add --name azure-devops
az login --allow-no-subscriptions                     # another tenant: add --tenant <tenant-domain>
```

Check, replacing the placeholders:

```powershell
az devops invoke --org https://dev.azure.com/<org> --area wit --resource workItemTypes `
  --route-parameters project=<project> --query "value[].name" -o tsv
```

If it prints the types (`Feature`, `Product Backlog Item`, `Task`, …), the skill can read the board.
An organization that stays invisible after a successful login usually belongs to another Entra
tenant: `az login --tenant <tenant-domain> --allow-no-subscriptions`.

### Azure DevOps MCP (optional)

```powershell
winget install --exact --id OpenJS.NodeJS.LTS         # if node/npx is missing
claude mcp add --scope user azdo-<alias> -- npx -y @azure-devops/mcp <org> -d core work-items search
claude mcp list                                       # azdo-<alias> must appear
```

One server per organization. Without MCP the skill still works: it skips full-text search and says
so in the report.

### Org and project

The skill takes org and project from the session's `ALM:` line, which the kit's
`workspace-context.js` hook writes at session start from your local-only
`$HOME\.claude\workspaces.json` (start from the kit's `workspaces.example.json`). A folder not mapped
there → the skill asks. Example entry:

```json
{ "path": "C:\\workspaces\\<client>", "platform": "azure-devops", "org": "<org>", "project": "<Project>", "identity": "<identity>" }
```

## 4. A prompt to have Claude do the setup

Paste this into a Claude Code session opened in the kit folder (or anywhere, for a manual install):

```text
Set up the /estimate skill on this machine. Go step by step and stop to ask me only when you need
a value from me or an interactive login.

1. Check pwsh 7, Azure CLI, the azure-devops extension, node/npx: for each, present or missing.
   For the missing ones propose the winget command and run it only after my ok.
2. If we are in the kit folder run .\install.ps1 and then .\install.ps1 -Check; otherwise copy
   skills/estimate to $HOME\.claude\skills\estimate.
3. Ask me for the Azure DevOps org and project. If az is not signed in, tell me to run
   `! az login --allow-no-subscriptions` myself (with --tenant if the org is on another tenant).
4. Check access with az devops invoke --area wit --resource workItemTypes on the project and show
   me the types found.
5. Ask whether I want the Azure DevOps MCP; if yes register it with
   claude mcp add --scope user azdo-<alias> -- npx -y @azure-devops/mcp <org> -d core work-items search
   and check it with claude mcp list.
6. Check that $HOME\.claude\workspaces.json maps my working folder to org and project; if not,
   propose the entry and write it only after my ok.
7. Finish with a table: component, state (verified / not verified / failed), command used. Remind
   me to restart Claude Code and to try /estimate on a real work item.
```

## 5. Common problems

| Symptom | Cause | Fix |
| --- | --- | --- |
| `/estimate` does not appear | skill not installed, or Claude not restarted | `.\install.ps1 -Check`, then restart |
| "not found" on the project | wrong org or project, or the `az devops configure` default | check the `ALM:` line and `workspaces.json` |
| Thin history | young project, or no hours logged on Tasks | the skill widens to 6 months and raises the approximation; log hours with `/worklog` |
| Estimates always "team" based | the person has fewer than 5 items of their own in the window | normal at first; the report says so |
| One odd item skews estimates | hours logged wrongly | tag the item `estimation-excluded` |
