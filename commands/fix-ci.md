---
description: A red pipeline or workflow — find the failing run, fetch only the failing step's log, isolate the real error, and propose the fix.
argument-hint: "[run-id | url | branch] [--current]"
---

Turn a red build into a diagnosis. The method is **`debug-systematic`** (reproduce before fixing);
Azure DevOps CLI mechanics and the REST fallback are **`azdo-cli`**; YAML and template knowledge is
**`pipeline`**. This command fetches the evidence and names the cause — it does not push a fix.

**Language** — the diagnosis the user reads is **Italian**: the report of step 6, the class of step 5
and the proposed fix explained. Evidence is never translated — quoted log lines, error codes, job,
stage and step names, branch and commit values, and the YAML or diff of the fix itself are
reproduced exactly as the pipeline gives them.

## Argument grammar

- *(empty)* → the most recent failed run on the current branch, falling back to the repo's most
  recent failed run (say which).
- **`<run-id>`** / a run **URL** → that run.
- **`<branch>`** → the most recent failed run on that branch.
- **`--current`** → only the current branch; no repo-wide fallback.

## Steps

1. **Platform** — `git remote get-url origin`: `dev.azure.com` / `visualstudio.com` → Azure
   Pipelines, `github.com` → GitHub Actions. Both configured → ask which; never assume.

2. **Find the run.**
   ```powershell
   az pipelines runs list --status completed --result failed --branch <branch> --top 5 --query-order FinishTimeDesc -o table
   az pipelines runs show --id <run-id> -o json
   ```
   ```powershell
   gh run list --status failure --branch <branch> --limit 5
   gh run view <run-id> --verbose        # job and step breakdown, marks the failing step
   ```
   `gh pr checks <pr>` is the shortcut when the red thing is a PR's checks.

3. **Fetch the failing step only.** A full log is tens of thousands of lines and buys nothing.
   ```powershell
   gh run view <run-id> --log-failed
   ```
   On Azure DevOps there is no `az pipelines` log verb: get the timeline, find the record whose
   `result` is `failed` and read its log through the REST invoke — the recipe is in `azdo-cli`.
   ```powershell
   az devops invoke --area build --resource timeline -o json `
     --route-parameters project=<project> buildId=<run-id>
   ```
   Save the log to a file and read slices of it; never page a whole log into context.

4. **Isolate the real error.** Search the failing step's log for the first genuine failure, not the
   last line: MSBuild `error CS…`/`error MSB…`, a failed assertion and its test name, a
   non-zero `ExitCode`, `npm ERR!`, a stack trace's innermost frame. Then discard the noise —
   restore warnings, `NU1701`, deprecation notices, a retried download, the summary line that just
   repeats the count. Quote at most ten lines of evidence, with the step name.

5. **Classify the cause. This is the answer, not the log.** The classes are named in English below
   for you; in the report they are stated in Italian — `il codice è sbagliato`, `la pipeline è
   sbagliata`, `l'ambiente è diverso`, `flake`.

   | Class | What the log looks like | Where the fix goes |
   | --- | --- | --- |
   | **The code is wrong** | compiler error, failing assertion, null reference — reproducible locally | the repo; reproduce it locally first |
   | **The pipeline is wrong** | missing task input, bad variable or template parameter, wrong trigger or path filter, missing service connection or permission | the YAML — `pipeline` |
   | **The environment differs** | passes locally, fails on the agent: SDK or image version, case-sensitive path, missing tool, time zone or culture, a service the agent cannot reach | pin or provision it in the YAML, or make the code environment-agnostic |
   | **Flake** | same commit passed before, timeout, port in use, network reset | the test or step, not the change under review |

   Confirm the class before proposing: reproduce the "code is wrong" case with the same command the
   step ran (`dotnet build`, `dotnet test --filter <Name>`, `npm ci` then the script). A cause that
   was never reproduced is labelled `ipotesi` in the report.

6. **Report**, in Italian — run id, pipeline or workflow, branch, commit, failing job and step ·
   the isolated error, quoted · the class from step 5 with the evidence for it · the minimal fix as
   a concrete diff or YAML snippet · one line on what else the same cause would break. Then **ask**
   whether to apply it.

## Guardrails

- **Read-only against CI.** No `gh run rerun`/`cancel`/`delete`, no `az pipelines run`, no variable
  or definition edits, no re-queue "to see if it passes" — a rerun is a guess, not a diagnosis.
- Do not edit code or YAML in this command: it diagnoses and proposes. Applying is a normal edit,
  after the user says yes.
- Never fetch or dump a full run log; step 3 fetches the failing step.
- Never call a cause confirmed on log-reading alone — reproduce, or label it a hypothesis.
- Do not blame flakiness to close the ticket: a flake claim needs the same commit having passed.
- No commit, no push, no PR — that is `/ship`.
