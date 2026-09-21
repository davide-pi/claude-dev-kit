---
description: Answer one question with throwaway code — pick the cheapest instrument, get the answer, report it, delete the code.
argument-hint: "<the question to answer> [--keep]"
---

A spike answers **one** question and leaves nothing behind. The classification that sends work here
is **`dev-loop`**'s spike lane; this command runs it. The deliverable is the answer, in chat — the
code is scaffolding, and it gets deleted in step 5.

## Steps

1. **State the question as a testable claim, in one line**, and get it right before writing
   anything. "Is the API faster?" is not answerable; "does `GET /orders?page=2` return the second
   page or repeat the first?" is. If the question needs more than one probe, it is two spikes: split
   it. If it is answerable by reading the code, read the code — that is not a spike.

2. **Pick the cheapest instrument.** First row that fits wins:

   | The question is about | Instrument | Shape |
   | --- | --- | --- |
   | C# / .NET / library semantics | `csharprepl` | `csharprepl -r <pkg-or-csproj> -u <Namespace>` then type the expression |
   | what a query returns, or what the data looks like | one SQL statement | `/db "<query>"`, or `sqlcmd -S <s> -d <db> -E -W -Q "..."` |
   | an HTTP contract, an auth flow, a payload shape | a raw call | `Invoke-RestMethod -Uri <url> -Method GET -Headers @{...}` |
   | JS / JSON / a regex / string handling | `node` | `node -e "<expr>"` |
   | a container's or tool's behaviour | the tool itself | `docker …`, `dotnet …`, verified with `--help` first |
   | more than a few lines of C# | a `.csx` script | write it, `csharprepl <file>.csx`, delete the file |

   A probe that needs a new project, a NuGet restore into the solution, config, or a test is not a
   probe any more: stop and reclassify it with `dev-loop`.

3. **Timebox it and say the box out loud** — a few minutes, not an afternoon. Blown box → report
   what was learned and what is still unknown; a spike that fails to answer is a valid result, and
   far cheaper than one that quietly turns into a project.

4. **Write scratch code outside the repository**, in the session's scratch directory, so it cannot
   be committed by accident and never appears in `git status`. Nothing goes into `src`, the solution
   file, or any `.csproj`.

5. **Report in Italian, then delete.** Headings and prose are Italian; the command and the probe's
   raw output are pasted verbatim, and when the answer *is* a literal value — a number, a status
   code, a JSON body, an exit code — it is quoted exactly as it came out, never translated nor
   turned into prose.
   - **Domanda** — the claim from step 1.
   - **Risposta** — `sì` / `no` / "dipende, da questo", in one line.
   - **Prova** — the actual output, verbatim, trimmed to the lines that carry it.
   - **Strumento** — what was run, so it can be re-run: the command exactly as typed.
   - **Cosa non ci dice** — the limit of the probe. One line, and it is not optional: a
     probe on one input is not a general answer.
   - **Eliminato** — the files removed. Then remove them, unless `--keep` was passed, and say where
     they are if it was.
   - **Prossimo passo** — one line: the change this answer implies, and the route for it.

## Guardrails

- **Never against production**, and never with a real credential: local, a development database, or
  a sandbox endpoint. A question that can only be answered in production is a question for the
  owner of production, not for a spike.
- **Never write** in the probe: reads, `GET`, `SELECT`. A probe that must write needs its own
  confirmation and its own throwaway data.
- **Probe code is never promoted.** It does not get moved into `src`, wrapped in a test, or made
  "just a bit more reusable". The real change is written fresh, as a bounded change, with the gate
  `dev-loop` prescribes.
- Do not add a package, a project, a compose service or a config entry to the repository, and do not
  edit any tracked file. A spike leaves `git status` unchanged.
- No commit, no branch, no PR. Nothing to ship — that is the point.
- Do not answer from memory and label it a spike: an unmeasured answer is a guess. Either run the
  probe, or say it was not run.
