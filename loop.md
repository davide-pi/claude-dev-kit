# Maintenance pass — Azure DevOps (`/loop`)

**Runs only when the owner types `/loop`.** Never start it, schedule it, or suggest it (nor `/schedule`
or any recurring run in its place) on your own initiative.

Read-only, one pass, report in Italian; follow the `azdo-cli` skill for every `az` call.

1. Target: the org, project and identity from the `ALM:` session line, passed explicitly on every call. No
   line → say so and stop.
2. Pull request of the current branch: `az repos pr list --source-branch <branch> --status active`, then
   `az repos pr show`: status, mergeability, reviewer votes, policy state. Comment threads have no `az repos pr`
   verb: read them with `az devops invoke --area git --resource pullRequestThreads` (`azdo-cli`), active ones only.
3. Latest run of the branch: `az pipelines runs list --branch <branch> --top 1`; a failed run is `result`
   `failed` with `status` `completed`.
4. Report one line per item: PR (status, unresolved threads), run (result). Nothing changed since the last
   pass → "nessuna novità".
5. `result` `failed` → suggest `/fix-ci`, which proposes only.

Never push, comment, resolve a thread, vote, complete the PR or re-run a pipeline.
