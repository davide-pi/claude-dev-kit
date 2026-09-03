# Repositories and pull requests — the command catalogue

## Repositories

```powershell
az repos list -p <project> --query "[].{name:name, default:defaultBranch, size:size}" -o table
az repos show --repository <repo> -p <project> -o jsonc
az repos ref list --repository <repo> --filter heads -p <project> --query "[].name" -o tsv
az repos policy list -p <project> --repository-id <repo-guid> --branch main -o table
```

`az repos` has no verb for reading a file's content: use `git show <ref>:<path>` in a clone, or the
MCP repo-file tool when there is no clone. Branch policies are what actually decide whether a PR can
complete, so read them before diagnosing a PR that will not merge.

## Listing pull requests

```powershell
az repos pr list --status active -o table
az repos pr list --repository <repo> --status active `
  --query "[].{id:pullRequestId, title:title, by:createdBy.displayName, src:sourceRefName, tgt:targetRefName}" -o table

az repos pr list --creator <upn> --status all --top 20 -o table    # mine
az repos pr list --reviewer <upn> --status active -o table         # awaiting me
az repos pr list --target-branch main --status completed --top 10 -o table
```

| Flag | Note |
| --- | --- |
| `--status` | `active`, `completed`, `abandoned`, `all` — default is active only |
| `--creator`, `--reviewer` | a UPN or a resolvable display name, not an id |
| `--source-branch` / `-s`, `--target-branch` / `-t` | branch names, with or without `refs/heads/` |
| `--top`, `--skip` | page explicitly; the default page is not the whole list |
| `--repository` / `-r` | omit it to list across every repository in the project |
| `--include-links` | adds `_links`, which is where the web URL of the PR lives |

## Reading one pull request

```powershell
az repos pr show --id <pr> -o jsonc
az repos pr show --id <pr> --query "{title:title, status:status, merge:mergeStatus, draft:isDraft, src:sourceRefName, tgt:targetRefName, reviewers:reviewers[].{name:displayName, vote:vote}}" -o jsonc
az repos pr reviewer list --id <pr> -o table
az repos pr work-item list --id <pr> -o table
az repos pr policy list --id <pr> --query "[].{policy:configuration.type.displayName, status:status}" -o table
```

`vote` is numeric: `10` approved, `5` approved with suggestions, `0` no vote, `-5` waiting for the
author, `-10` rejected.

`az repos pr show` returns the PR's metadata and reviewers — **not its comment threads**. There is no
thread verb anywhere under `az repos pr`; see the gap section below.

## Creating a pull request

```powershell
az repos pr create --repository <repo> -p <project> `
  --source-branch <branch> --target-branch main `
  --title '<title>' --description '<first line>' '<second line>' `
  --work-items <id1> <id2> `
  --required-reviewers '<upn>' --optional-reviewers '<upn>' `
  --squash true --delete-source-branch true --draft false
```

| Flag | Note |
| --- | --- |
| `--source-branch` / `-s` | required in practice; `--target-branch` defaults to the repo's default branch |
| `--description` / `-d` | **each value becomes a new line**, so pass one argument per line; markdown is allowed |
| `--work-items` | space-separated ids, linked at creation — cheaper than linking afterwards |
| `--required-reviewers`, `--optional-reviewers` | space-separated; `--reviewers` is an alias of the optional one |
| `--draft` | open as work in progress; policies and reviewer notifications hold off |
| `--squash`, `--delete-source-branch` | set the merge intent now so completion needs no extra flags |
| `--auto-complete` | complete by itself once policies pass — a **deferred merge**, treat it as a write |
| `--transition-work-items` | moves linked items to their next state on completion |
| `--labels` | space-separated tags on the PR |
| `--open` | opens a browser; never in a scripted flow |

Long descriptions read badly as a pile of arguments. Build the lines in PowerShell instead:

```powershell
$lines = @(
  '## What',
  '- <change>',
  '',
  '## Why',
  '- <reason>'
)
az repos pr create -r <repo> -s <branch> -t main --title '<title>' --description @lines
```

## Reviewers and votes

```powershell
az repos pr reviewer add --id <pr> --reviewers '<upn1>' '<upn2>' --required true
az repos pr reviewer remove --id <pr> --reviewers '<upn>'
az repos pr set-vote --id <pr> --vote approve
```

`--vote` takes `approve`, `approve-with-suggestions`, `reject`, `reset`, `wait-for-author`. The vote
is cast as the signed-in identity — never cast one on someone's behalf, and never as part of a
review flow that was asked only to report.

## Updating and completing

```powershell
az repos pr update --id <pr> --title '<title>' --description '<line>' --draft false
az repos pr update --id <pr> --auto-complete true --squash true --delete-source-branch true
az repos pr update --id <pr> --status completed --squash true --delete-source-branch true `
  --merge-commit-message '<message>' --transition-work-items true
az repos pr update --id <pr> --status abandoned
```

| Flag | Effect |
| --- | --- |
| `--status` | `active`, `abandoned`, `completed` — `completed` **merges now** |
| `--squash` | squash the source commits into one on merge |
| `--delete-source-branch` | delete the source branch after the merge |
| `--merge-commit-message` | the message the merge commit carries |
| `--bypass-policy`, `--bypass-policy-reason` | merge over failing required policies |
| `--auto-complete` | complete when policies pass, rather than now |
| `--draft` | `false` publishes a draft, `true` sends it back to draft |

Completing, abandoning and `--bypass-policy` are irreversible in practice: they merge code, close a
review or defeat a gate. State what will happen and get confirmation first. `--auto-complete true`
is equally a merge — it just happens later, when nobody is watching.

`az repos pr checkout --id <pr>` checks the source branch out locally, and refuses if the working
tree is dirty. It is the cheapest way to run a PR's code without hand-copying the branch name.

## The gap: comments and threads

There is no comment or thread verb under `az repos pr` — only `reviewer`, `policy`, `work-item`,
`checkout`, `create`, `list`, `set-vote`, `show`, `update`. Reading a discussion, posting a comment,
replying in a thread, anchoring a thread to a file and line, and resolving a thread are all outside
the CLI's verbs.

Two routes, in order:

1. `az devops invoke` against the `git` area — still the CLI, still the configured credential. The
   resources are `pullRequestThreads` and `pullRequestThreadComments`:

   ```powershell
   az devops invoke --area git --resource pullRequestThreads `
     --route-parameters project=<project> repositoryId=<repo> pullRequestId=<pr> `
     --query "value[].{id:id, status:status, file:threadContext.filePath, comments:comments[].{by:author.displayName, text:content}}" -o jsonc
   ```

   Writing a thread is the same resource with `--http-method POST --in-file <body.json>`, and the
   inline anchor lives in the body's thread context, not in a flag. Confirm the route parameters
   against the resource listing in `auth-and-config.md` before a write.
2. The MCP PR-thread tools, which model the thread and its inline anchor directly. This is the one
   PR capability where MCP is routinely the right answer: an inline thread needs a file path, a line
   range and an iteration context, and a hand-built body gets one of them wrong.

`pr-review` depends on this: it reads threads to avoid repeating an existing comment, and it posts
inline. Both halves take route 2 unless route 1 has been verified.
