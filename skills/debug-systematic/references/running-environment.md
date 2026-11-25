# Running environment — a symptom in staging or production, cause unknown

The failure happens somewhere you cannot attach a debugger to, and you cannot yet make it happen
locally. The work is to read three sources together, then turn the best hypothesis into a local repro.

## When to use it

| Situation | Use it? |
| --- | --- |
| a symptom in a running environment, cause unknown, no local repro yet | yes |
| a failure you can already reproduce on demand | no: phase 1 of `SKILL.md` is done, isolate |
| one log read or one query, no analysis | no: the `logs` or `db` skill alone |
| a slow or leaking process to measure | no: counters and a trace first (`SKILL.md`, symptom table) |

## Read-only rule

- Never write to the environment: no `INSERT`/`UPDATE`/`DELETE`, no config edit, no manual message replay.
- Never restart, redeploy or scale a service without the owner's explicit yes: it destroys the evidence.
- A non-dev database is read through the `db` skill only; the credential must be read-only.

## Order of work

| # | Step | Output |
| --- | --- | --- |
| 1 | Fix the window and one concrete identifier (order id, trace id, user), in UTC with the offset | a case card: symptom verbatim, window, id, environment, already ruled out |
| 2 | Logs for that id and window: the `logs` skill, run by the `ops-analyst` agent | first error and first occurrence, rate before and after, the lines verbatim |
| 3 | Data state for that id: the `db` skill, run by the `db-analyst` agent, `SELECT` only | current state, timestamps, related rows; what is missing or doubled |
| 4 | The code path that joins the two: the `investigator` agent | the handler or consumer that writes that state, `file:line`, the branch that fits the logs |
| 5 | A timeline | the table below |
| 6 | Hypotheses, ranked by likelihood | each with the one observation that would confirm or kill it |
| 7 | A local reproduction of the top hypothesis | a failing command or test; the normal flow of `SKILL.md` takes over at phase 1 |

Steps 2–4 are independent reads: run them in parallel when the id and window are known.

```text
| time (UTC) | source | fact |
| 14:02:11 | log | POST /orders 500, NullReferenceException, trace 9f3a |
| 14:02:11 | db | order 4711 row exists, status = Pending, no payment row |
| 14:02:12 | code | OrderHandler.cs:88 writes the order before calling the payment client |
```

An empty log or an empty result is not a healthy one: name the gap (retention, wrong environment,
wrong id format) before reading silence as "nothing happened".

## Hypotheses

| Rank | Hypothesis | Confirms | Kills |
| --- | --- | --- | --- |
| 1 | the payment client times out after the order is saved | a timeout line at 14:02:11 for trace 9f3a | a payment row exists, or no timeout in the window |

Three ranked at most; each prediction is falsifiable and names the probe (one query, one log filter).
If none can be probed in the environment, the next step is instrumentation in a local run, not a guess.

## Redaction

Before quoting any log line or row in the chat or a file: replace secrets, tokens, connection strings and
personal data (names, emails, addresses, phone numbers) with `<redacted>`. Keep ids, timestamps and
error text verbatim: a rewritten line is no longer evidence.

## What to report

1. The timeline.
2. The most likely cause, as the one causal sentence of phase 3, marked proven or not proven.
3. The evidence for it: log lines, rows, `file:line`, each with its source.
4. What is not verified, and the read that would settle it.
5. The local reproduction, or why none exists yet.
