# The feasibility probe — answer one question, leave nothing behind

A spike's deliverable is the **answer**, in chat. The code is scaffolding and gets deleted.

## Procedure

| # | Step | Rule |
| --- | --- | --- |
| 1 | State the question as a **testable claim**, one line | "Is the API faster?" is not answerable; "does `GET /orders?page=2` return the second page or repeat the first?" is. Two probes needed → two spikes. Answerable by reading the code → read it, that is not a spike |
| 2 | Pick the cheapest instrument (table below) | first row that fits wins |
| 3 | Timebox it, and say the box out loud | minutes, not an afternoon. Blown box → report what was learned and what is still unknown; a spike that fails to answer is a valid result |
| 4 | Scratch code **outside the repo** | the session scratch directory; nothing in `src`, the solution or any `.csproj`; `git status` stays unchanged |
| 5 | Report in Italian, then delete | shape below; delete unless the user asked to keep it, and then say where it is |

## Instruments

| The question is about | Instrument | Shape |
| --- | --- | --- |
| C# / .NET / library semantics | `csharprepl` | `csharprepl -r <pkg-or-csproj> -u <Namespace>`, then the expression |
| what a query returns, what the data looks like | one SQL statement | `/db "<query>"`, or `sqlcmd -S <s> -d <db> -E -W -Q "..."` |
| an HTTP contract, an auth flow, a payload shape | a raw call | `Invoke-RestMethod -Uri <url> -Method GET -Headers @{...}` |
| JS / JSON / a regex / string handling | `node` | `node -e "<expr>"` |
| a container's or tool's behaviour | the tool itself | `docker …`, `dotnet …`, verified with `--help` first |
| more than a few lines of C# | a `.csx` script | write it, `csharprepl <file>.csx`, delete it |

A probe that needs a new project, a package restored into the solution, config or a test is no
longer a probe: reclassify it as a bounded change or a new subsystem.

## The report — Italian headings, verbatim evidence

| Heading | Content |
| --- | --- |
| **Domanda** | the claim from step 1 |
| **Risposta** | `sì` / `no` / "dipende, da questo" — one line |
| **Prova** | the actual output, verbatim, trimmed to the lines that carry it |
| **Strumento** | the command exactly as typed, so it can be re-run |
| **Cosa non ci dice** | the limit of the probe — mandatory: one input is not a general answer |
| **Eliminato** | the files removed |
| **Prossimo passo** | the change the answer implies, and its route (`dev-loop` class) |

A literal answer — a number, a status code, a JSON body — is quoted exactly as it came out.

## Guardrails

- **Never against production**, never with a real credential: local, a development database or a
  sandbox endpoint. A question only production can answer belongs to production's owner.
- **Read-only**: `GET`, `SELECT`. A probe that must write needs its own confirmation and its own
  throwaway data.
- **Probe code is never promoted** — not moved into `src`, not wrapped in a test, not made "a bit
  more reusable". The real change is written fresh, with the `dev-loop` gate.
- No package, project, compose service or config entry added; no tracked file edited; no commit,
  branch or PR.
- An answer from memory is not a spike: run the probe, or say it was not run.
