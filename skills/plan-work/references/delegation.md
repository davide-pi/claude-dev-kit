# Delegation — when to fan out, the contract every agent returns, what never leaves

The independence test and the never-delegate list are in `SKILL.md` §6. This page holds the rest.

## Sizing and routing

**Size by merge capacity, not spawn capacity**: 2–4 agents for distinct judgement, up to 6–8 for one
mechanical job over many targets, then waves. Unread reports are where fabricated success survives.
Spawn a wave in **one message**.

| Job | Agent |
| --- | --- |
| code for a decided scope (tests included: the brief names `dotnet-testing`) | `implementer`: effort `medium` by default, the brief says `high` for a delicate change |
| multi-lens review | `/code-review` (a PR too) — never a hand-rolled review fan-out |
| locate code, trace a flow | `investigator` |
| wide read-only search | `Explore` |
| SQL, logs | `/db`, `/logs` (their forks run `db-analyst`, `ops-analyst`) |

## The brief — what an agent cannot infer

1. The absolute paths it owns, and that everything else is read-only.
2. The change, one sentence per file or behaviour.
3. The conventions skill by name.
4. The verify command and what its output must show.
5. The forbidden operations: commit, push, migration, deploy, MCP writes.
6. That "zero findings" or "nothing to change" is a valid answer.
7. The output contract and its cap — below.

## Output contract

Agents with their own contract (`implementer`, the reviewers, `investigator`, `doc-keeper`) keep it;
say only "concise, your output contract". Everyone else gets this, pasted verbatim:

```text
Return at most 30 lines, exactly these sections — no narrative, no restated task.
Prose in Italian; paths, commands, quoted output, test names and verdict values verbatim.

## Scope
One sentence: what you were asked, as you understood it.

## Files
One line per file: absolute path · new | edited | unchanged · what changed.

## Evidence
Per claim: the command you ran and the output line that settles it, quoted.

## Not verified
What you could not check, why, and the command that would. "none" is valid.

## Open questions
Each guess and its alternative; out-of-scope findings, one line each. "none" is valid.
```

Ask for the conclusion, never the dump: every report lands in the main context, and a long report
costs on every later turn.

## When a report is wrong — one correction round, never five

| Symptom | Move |
| --- | --- |
| misread scope | re-message once with the corrected scope in one sentence |
| right scope, small defect | fix it yourself |
| no quoted output ("tests pass") | re-run the command; unverified until you see output |
| evidence that does not match the repo | distrust the whole report, redo the task |
| two agents edited the same file | resolve it yourself; never a third agent to merge |
