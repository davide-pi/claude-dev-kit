# retro — the modes beyond one session's friction

## `days <n>` — the suite over a period

The main transcripts (`~/.claude/projects/*/*.jsonl`, not `subagents/`) modified in the last `n` days, newest
first, at most 20; say how many were skipped. Each is read like a single session (Grep, then slices), never whole.

- A friction event counts only when its kind recurs in **2+ sessions**; the proposal names every session
  (id, date) and turn it rests on. A one-off event goes to the line of events without a proposal.
- Every category of the fix table applies; an automated check still comes first.
- Report line 1 reads `Trascritti: N (giorni: n, saltati: N) · eventi ricorrenti: N · singoli: N`.

## Coaching — `Consigli per te`

From the user's own turns only, in the session or in every transcript of the period. One advice per
pattern, each resting on quoted turns:

| Pattern | Seen as | Advice in the shape of |
| --- | --- | --- |
| Vague ask | a question back, or a guess the user corrected | name the target, the done criterion or the file up front |
| Changing direction | "anzi", "no aspetta", a reversal of an earlier decision | settle the choice before the work starts, or say it is open |
| Stacked scope | a new request mid-turn, before the last one closed | queue it, or open a new task for it |
| Repeated instruction | the same correction given twice or more | make it a rule or a memory, once |
| Missing context | facts the model had to search for that the user knew | hand over the path, id or command with the ask |

Limits: session mode at most 3 advices, `days` mode at most 5 and only patterns seen in 2+ sessions. No
pattern, no advice: say `nessun consiglio` rather than invent one. The advice is about how the user steers
the work, never about the person; quote the turn, `<REDACTED>` for secrets.

Report line 4, after the backlog: a table `Consiglio | Evidenza (sessione, turno) | Cosa fare diverso`.

## Monthly — environment health

Runs only when the owner asks, or when the focus argument is `monthly`; never on your own.

| Step | Source | Fix |
| --- | --- | --- |
| Asset usage | the owner's `/skill-doctor` and `/doctor prompt-audit` output, pasted in the arguments (slash commands, a fork cannot run them) | never-invoked or over-budget descriptions → `skill-forge` |
| Automatic warnings | `~/.claude/.cache/done-claim.log`, the worklog reminder, the statusline badge: for each, the false-positive rate (fired, then the user ignored or contradicted it) | a noisy one → a proposal to fix or remove it; the hooks themselves stay untouched here |

Report line 5: `Salute: <outcome, one line per step>`.
