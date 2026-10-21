# Skill triggering evals

A skill misfires in two directions, and both are expensive:

- **False negative** — the user describes exactly what the skill is for and it never loads, so the
  work is done ad hoc, ignoring the conventions the skill exists to enforce.
- **False positive** — the skill fires on a superficially similar request and drags its whole
  procedure (Q&A loops, confirmation tables, Azure DevOps writes) into a task that did not want it.

Descriptions are the only thing driving this, so they need to be tested like code. `tools/validate.mjs`
covers the static half (a trigger-only skill must name its own trigger, descriptions stay under the
length limit). This file covers the behavioural half.

## Automated suites

Thirteen skills are covered by `claude plugin eval` suites under `evals/<skill>/`: `pr-create`,
`azdo-cli`, `worklog`, `branch-flow`, `user-story-standard` and the `paths:` skills (`angular`,
`react`, `ef-core`, `sql-server`, `rabbitmq`, `pipeline`, `docker-dev-env`, `dotnet-backend`). Their
MUST / MUST NOT rows moved there, one case folder per row (`prompt.md` + `graders/*.md`); run them with
`pwsh tools/run-evals.ps1` (only the suites whose skill changed) and see the README row for the flags.
A case that fails is a description bug: fix the description, do not fix the case.

### Not expressible in a suite

| Row | Why it stays manual |
|-----|---------------------|
| `angular`, `react` and the other `paths:` skills: **hidden until a matching file is read, listed after** | The harness loads a skill folder as a plugin and lists it from the first turn (`angular:angular` is in the `init` skills of a run that never read a file), so the gate is never exercised; `add_dirs` only grants read access, and the only way to put a file in the sandbox is `--scaffold`, which runs shell as you. The suites measure the description; the gate is checked with `tools/instructions-log.js` in a real session. |

## How to run the rest

The skills below have no suite yet. Cases are plain prompts; paste one in a scratch session and check
with `/context` (or by watching whether the skill's instructions show up) which skills loaded. Record
what actually happened, not what should have.

## Cases

`MUST` = the skill has to load. `MUST NOT` = it has to stay out. The parenthetical says why the case
exists.

### `workitem-create` — explicit trigger only

| Prompt | Expected |
|--------|----------|
| `/workitem-create` | MUST load |
| "crea un work item per il bug del filtro date" | MUST NOT (the skill is trigger-only by design; without the trigger, do it plainly) |
| "apri una issue su GitHub per questo" | MUST NOT (different platform, different flow) |
| "abbiamo fatto una riunione, ti racconto i punti" | MUST NOT without the trigger (meeting-driven creation, writes to a real board) |

### `pr-review` — explicit trigger only

| Prompt | Expected |
|--------|----------|
| `/pr-review` | MUST load |
| `/pr-review 4312 high security` | MUST load, and the focus must narrow the fan-out to `review-security` |
| "guarda la PR 4312 e dimmi se ci sono problemi" | MUST NOT post anything; a chat review is the correct answer |
| "commenta tu la PR con i dubbi" | MUST load (that is exactly its contract) |
| "il code-reviewer dice che questo id può essere null, ha ragione?" | MUST load (receiving findings) |

### `code-review` — the local diff

| Prompt | Expected |
|--------|----------|
| `/code-review` | MUST run on the working diff, chat-only |
| `/code-review high` | MUST fan out to the two specialists as well |
| "rivedi le modifiche che hai appena fatto" | MUST route through the review subagents (per the CLAUDE.md convention), not an inline read-through |
| "sistema questo bug" | MUST NOT (fixing is not reviewing) |

### `commit`

| Prompt | Expected |
|--------|----------|
| `/commit` | MUST commit on the current branch, message generated from the diff |
| `/commit -b fix/date-filter` | MUST create the branch and commit there |
| "committa e pusha" | MUST commit; the push is a separate, explicit act (the command never pushes) — and on the default branch the guard hook asks first |
| "cosa ho modificato?" | MUST NOT (a question about the diff, not a request to commit) |

### `grill-me` — scrutiny, not execution

| Prompt | Expected |
|--------|----------|
| `/grill-me` | MUST load |
| "buca il mio piano di refactoring" | MUST load |
| "fammi le pulci a questo design" | MUST load (natural phrasing, no slash: the skill is auto-invocable) |
| "attack this design" | MUST load |
| "che ne pensi di questo approccio?" | MUST NOT necessarily load — answering is fine; grilling is for when scrutiny is asked for |
| "grill me su questo design" | MUST load, and the first round MUST ask every unblocked question at once, each with a recommended answer |

## When a case fails

1. Decide which direction it failed in (missing load vs unwanted load).
2. Change the **description**, not the body: that is what the model matches on. For a false positive,
   name the boundary explicitly ("only when the user types `/x`", "not for … "). For a false
   negative, add the words a user actually says.
3. Re-run the affected cases (a suite: `pwsh tools/run-evals.ps1 -Suite <skill>`), then `node tools/validate.mjs` (the description limits are enforced
   there), and note in the PR which case changed behaviour.

### `plan-work`

| Prompt | Expected |
|--------|----------|
| "prima di scrivere codice buttiamo giù i passi per il nuovo modulo di import" | MUST load |
| "spezza questo lavoro in task che posso seguire" | MUST load |
| "rinomina questa variabile in `orderTotal`" | MUST NOT (single-file change: a plan is pure overhead) |
| "leggi il piano e comincia dal task 2" | MUST NOT (executing a plan, not writing one) |
| "prendi in carico la story 4711, da dove parto?" | MUST load (item analysis) |
| "crea gli item per questa feature" | MUST NOT (creation belongs to workitem-create) |
| "si può leggere quel campo senza toccare l'ORM? provalo e buttalo" | MUST load (throwaway spike, `references/spike.md`) |
| "conviene spezzare questo lavoro su più agent?" | MUST load (fan-out, `references/delegation.md`) |

### `debug-systematic`

| Prompt | Expected |
|--------|----------|
| "l'API va in timeout solo in produzione, non capisco perché" | MUST load |
| "questo test passa in locale e fallisce in pipeline" | MUST load |
| "aggiungi un endpoint per esportare gli ordini in CSV" | MUST NOT (a new feature, not a defect) |
| "spiegami come funziona il garbage collector" | MUST NOT (knowledge question, nothing to diagnose) |

### `skill-forge`

| Prompt | Expected |
|--------|----------|
| "voglio aggiungere una skill al kit per i deploy" | MUST load |
| "questa skill è troppo lunga, come la spezzo?" | MUST load |
| "crea una skill per Cosmos DB" | MUST NOT (generic or Microsoft-specific authoring belongs to the skill-creator plugins) |
| "cosa fa la skill pr-review?" | MUST NOT (reading an asset, not authoring one) |

### `dotnet-testing`

| Prompt | Expected |
|--------|----------|
| "aggiungi i test a OrderService, il repo non ne ha nessuno" | MUST load |
| "questo test tocca il database vero o lo fingo?" | MUST load |
| "il test in CI fallisce con timeout, guarda il log della build" | MUST NOT (a red pipeline routes to the CI command) |
| "questo servizio non ha nessun test, da dove inizio?" | MUST load (test strategy) |
| "vale la pena testare questo mapper?" | MUST load |

### `dotnet-diagnostics`

| Prompt | Expected |
|--------|----------|
| "il pod va al 100% di CPU in produzione, come capisco cosa fa?" | MUST load |
| "questo endpoint è lento ma non so dove perde tempo" | MUST load |
| "mostrami i log di produzione dell'api nelle ultime 2 ore" | MUST load, and the Grafana reads MUST run inside `ops-analyst`, never on the main thread |
| "la pagina Angular ci mette 4 secondi a renderizzare" | MUST NOT (browser runtime belongs to the browser tools) |
| "aggiungi un log qui" | MUST NOT (a one-line edit, no investigation) |

## One-shot skill cases

The ex-commands are invoked by name, so the risk is different from a reference skill's: the failure
mode is the model *acting* on a phrasing the skill does not own, or doing by hand what the skill would
have done in one shot. The forked ones (`/db`, `/logs`, `/fix-ci`) add a second check: the raw output
must stay in the subagent.

### `/docs-sync`

| Prompt | Expected |
|--------|----------|
| `/docs-sync` | MUST run `doc-keeper` on the working diff against the repo's docs tree |
| `/docs-sync wiki --audit` | MUST audit the wiki tree against the source |
| "aggiorna il README del progetto" | MUST NOT (a single edit, no docs-tree sync) |

### `/retro`

| Prompt | Expected |
|--------|----------|
| `/retro` | MUST invoke on the current session and return proposals only, one row per friction event |
| "facciamo una retrospettiva di questa sessione: cosa miglioriamo nel kit?" | MUST NOT invoke on its own (`disable-model-invocation`): suggest `/retro` |
| "com'è andato lo sprint?" | MUST NOT (a team retrospective, not a session's environment) |

### `/item`

| Prompt | Expected |
|--------|----------|
| "fammi vedere i criteri di accettazione del 4821" | MUST invoke |
| "crea un bug per il crash del login" | MUST NOT (creation belongs to workitem-create) |

### `/fix-ci`

| Prompt | Expected |
|--------|----------|
| "la build su feature/orders è rossa, perché?" | MUST invoke, forked: only the failing step's log and the verdict return |
| "questo test fallisce in locale" | MUST NOT (belongs to debug-systematic) |

### `/db`

| Prompt | Expected |
|--------|----------|
| "quante righe ha Orders con Status = 3?" | MUST invoke, forked into `db-analyst` |
| `/db "SELECT 1"` | MUST return the result in the same turn, from the fork |
| "come indicizzo questa tabella?" | MUST NOT (belongs to sql-server) |

### `/logs`

| Prompt | Expected |
|--------|----------|
| "mostrami gli errori dell'api negli ultimi 30 minuti" | MUST invoke, forked into `ops-analyst` |
| "aggiungi Serilog al progetto" | MUST NOT (belongs to dotnet-diagnostics) |

### `items-qa` — explicit trigger only

| Prompt | Expected |
|--------|----------|
| `/items-qa 101 102 https://test.example mobile` | MUST load |
| `/items-qa` | MUST load |
| "controlla se questo componente rispetta gli AC" | MUST NOT (no explicit trigger: it drives a real browser and posts a comment) |
| "apri il sito e fai uno screenshot" | MUST NOT (browser use is not a work-item verdict) |

### `estimate` — explicit trigger only

| Prompt | Expected |
|--------|----------|
| `/estimate 12345` | MUST load |
| `/estimate` with a pasted request and "analisi di mercato" | MUST load |
| "quante ore ci vogliono per questa feature?" | MUST NOT (no explicit trigger; answer from the code or ask) |
| "dividi questa epica in item" | MUST NOT (splitting items is workitem-create / user-story-standard) |

## Cases for the standards ported from the PM's own skills

### `project-wiki-standard` — explicit trigger only

| Prompt | Expected |
|--------|----------|
| `/project-wiki-standard` | MUST load |
| "aggiorna la documentazione di architettura del repo" | MUST NOT (a repository docs tree is doc-keeper) |
| "scrivi la pagina Vincoli sulla wiki" | MUST NOT without the trigger (it writes to a real wiki) |
