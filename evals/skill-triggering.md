# Skill triggering evals

A skill misfires in two directions, and both are expensive:

- **False negative** — the user describes exactly what the skill is for and it never loads, so the
  work is done ad hoc, ignoring the conventions the skill exists to enforce.
- **False positive** — the skill fires on a superficially similar request and drags its whole
  procedure (Q&A loops, confirmation tables, Azure DevOps writes) into a task that did not want it.

Descriptions are the only thing driving this, so they need to be tested like code. `tools/validate.mjs`
covers the static half (a trigger-only skill must name its own trigger, descriptions stay under the
length limit). This file covers the behavioural half.

## How to run

Cases are plain prompts. Two ways to use them, cheapest first:

1. **By hand, in a scratch session.** Paste a prompt, then check with `/context` (or by watching
   whether the skill's instructions show up) which skills loaded. Fast, no setup, good enough to
   catch a regression after editing a description.
2. **With `skill-creator`.** The `skill-creator` plugin can generate and run evals for a skill; feed
   it the cases below for the skill you are changing and let it score them. Use this when you are
   reworking a description rather than spot-checking it.

Record what actually happened, not what should have. A case that fails is a description bug: fix the
description, do not fix the case.

## Cases

`MUST` = the skill has to load. `MUST NOT` = it has to stay out. The parenthetical says why the case
exists.

### `worklog` — explicit trigger only

| Prompt | Expected |
|--------|----------|
| `/worklog` | MUST load |
| `/worklog ieri` | MUST load |
| "quanto tempo ho passato oggi su questo progetto?" | MUST NOT (asking about time is not asking to log hours) |
| "registra 3 ore sul task 105060" | MUST NOT (a direct work-item write, not the reconstruct-and-confirm flow) |
| "cosa ho fatto questa settimana?" | MUST NOT (a question about history, no timesheet intent) |

### `workitem-create` — explicit trigger only

| Prompt | Expected |
|--------|----------|
| `/workitem-create` | MUST load |
| "crea un work item per il bug del filtro date" | MUST NOT (the skill is trigger-only by design; without the trigger, do it plainly) |
| "apri una issue su GitHub per questo" | MUST NOT (different platform, different flow) |

### `pr-review` — explicit trigger only

| Prompt | Expected |
|--------|----------|
| `/pr-review` | MUST load |
| `/pr-review 4312 high security` | MUST load, and the focus must narrow the fan-out to `review-security` |
| "guarda la PR 4312 e dimmi se ci sono problemi" | MUST NOT post anything; a chat review is the correct answer |
| "commenta tu la PR con i dubbi" | MUST load (that is exactly its contract) |

### `code-review` (command) — the local diff

| Prompt | Expected |
|--------|----------|
| `/code-review` | MUST run on the working diff, chat-only |
| `/code-review high` | MUST fan out to the two specialists as well |
| "rivedi le modifiche che hai appena fatto" | MUST route through the review subagents (per the CLAUDE.md convention), not an inline read-through |
| "sistema questo bug" | MUST NOT (fixing is not reviewing) |

### `git-branching` / `pr-create` — convention skills, ambient

| Prompt | Expected |
|--------|----------|
| "creami un branch per questa modifica" | `git-branching` MUST load (naming + protected-main rules) |
| "apri la PR" | `pr-create` MUST load (title/description conventions) |
| "fai il commit" | Both MUST NOT dominate — `/commit` owns this; branching only matters if a branch is created |

### `pipeline` — CI/CD authoring

| Prompt | Expected |
|--------|----------|
| "aggiungi uno stage di test a questa pipeline" (file under `.pipelines/`) | MUST load |
| "modifica il docker-compose per aggiungere redis" | MUST NOT (compose is not a CI/CD pipeline) |
| "questo YAML di Kubernetes è corretto?" | MUST NOT (manifest, not pipeline) |

### `ef-migration` — EF Core migrations

| Prompt | Expected |
|--------|----------|
| "aggiungi una migration per la nuova colonna" | MUST load |
| "scrivi la query per contare gli ordini" | MUST NOT (querying is not migrating) |

### `commit` (command)

| Prompt | Expected |
|--------|----------|
| `/commit` | MUST commit on the current branch, message generated from the diff |
| `/commit -b fix/date-filter` | MUST create the branch and commit there |
| "committa e pusha" | MUST commit; the push is a separate, explicit act (the command never pushes) — and on the default branch the guard hook asks first |
| "cosa ho modificato?" | MUST NOT (a question about the diff, not a request to commit) |

### `pr-description` (command, project-scoped)

| Prompt | Expected |
|--------|----------|
| `/pr-description` | MUST generate the description from the branch diff, with `AB#<id>` linking |
| "apri la PR" | MUST NOT — that is `pr-create`; this one only writes the description text |

### `grill-me` — scrutiny, not execution

| Prompt | Expected |
|--------|----------|
| "buca il mio piano di refactoring" | MUST load |
| "che ne pensi di questo approccio?" | MUST NOT necessarily load — answering is fine; grilling is for when scrutiny is asked for |

## When a case fails

1. Decide which direction it failed in (missing load vs unwanted load).
2. Change the **description**, not the body: that is what the model matches on. For a false positive,
   name the boundary explicitly ("only when the user types `/x`", "not for … "). For a false
   negative, add the words a user actually says.
3. Re-run the affected cases, then `node tools/validate.mjs` (the description limits are enforced
   there), and note in the PR which case changed behaviour.
