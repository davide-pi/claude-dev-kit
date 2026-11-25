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

Seven skills are covered by `claude plugin eval` suites under `evals/<skill>/`: `pr-create`,
`azdo-cli`, `branch-flow`, `user-story-standard`, `deliver`, `commit` and `code-review`. Their
MUST / MUST NOT rows moved there, one case folder per row (`prompt.md` + `graders/*.md`); run them with
`pwsh tools/run-evals.ps1` (only the suites whose skill changed) and see the README row for the flags.
A case that fails is a description bug: fix the description, do not fix the case.

## How to run the rest

The skills below have no suite yet. Cases are plain prompts; paste one in a scratch session and check
with `/context` (or by watching whether the skill's instructions show up) which skills loaded. Record
what actually happened, not what should have.

## Cases

`MUST` = the skill has to load. `MUST NOT` = it has to stay out. The parenthetical says why the case
exists.

### `code-review` — the local diff or a PR

| Prompt | Expected |
|--------|----------|
| `/code-review` | MUST run on the working diff, chat-only |
| `/code-review high` | MUST fan out to the two specialists as well |
| "rivedi le modifiche che hai appena fatto" | MUST route through the review subagents (per the CLAUDE.md convention), not an inline read-through |
| `/code-review 4312 high security` | MUST run in PR mode, and the focus must narrow the fan-out to `review-security` |
| `/code-review https://dev.azure.com/org/proj/_git/repo/pullrequest/4312` | MUST run in PR mode on that PR (the URL is the scope) and post only genuine tagged questions |
| "guarda la PR 4312 e dimmi se ci sono problemi" | MUST review in PR mode, and post nothing before the owner's ok (not typed as `/code-review <pr>`) |
| "sistema questo bug" | MUST NOT (fixing is not reviewing) |

### `commit`

| Prompt | Expected |
|--------|----------|
| `/commit` | MUST commit on the current branch, message generated from the diff |
| `/commit -b fix/date-filter` | MUST create the branch and commit there |
| "committa e pusha" | MUST commit; the push is a separate, explicit act (the command never pushes) — and on the default branch the guard hook asks first |
| "ok, committa" after an edit turn | MUST load the skill before the first `git commit` |
| "cosa ho modificato?" | MUST NOT (a question about the diff, not a request to commit) |

### `finding-format` — preloaded by the review agents

| Prompt | Expected |
|--------|----------|
| `code-reviewer` started on a diff | MUST have the skill in its context at start (`skills:` frontmatter), and return its Finding blocks |
| "fammi la review" in the main session | MUST NOT load it directly (`code-review` owns the review; the agents carry the format) |

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
| "crea gli item per questa feature" | MUST NOT (creation is `azdo-cli`, after `user-story-standard`) |
| "si può leggere quel campo senza toccare l'ORM? provalo e buttalo" | MUST NOT load first (a spike routes to `deliver`; its spike scenario then reads `references/spike.md` here) |
| "conviene spezzare questo lavoro su più agent?" | MUST load (fan-out, `references/delegation.md`) |

### `deliver` — every code change, before the first edit

| Prompt | Expected |
|--------|----------|
| "l'export degli ordini è lento, rendilo più veloce" | MUST load (perf scenario: baseline first) |
| "aggiungi il filtro per stato alla lista ordini" | MUST load (feature: plan, then `build`) |
| "spiegami cosa fa OrdersQuery" | MUST NOT (reading code, no change) |
| "rivedi il diff che ho in working tree" | MUST NOT (review of an existing diff belongs to code-review) |
| "si può leggere quel campo senza toccare l'ORM? provalo e buttalo" | MUST load first, scenario `spike` (not `plan-work`: the spike reference is read from the scenario) |
| "OrdersQueryTests è rosso e non so perché, sistemalo" | MUST load first, scenario `bug` (not `debug-systematic`: the triage sends an unproven cause there) |
| "perché questo test fallisce? non toccare niente" | MUST NOT (diagnosis only, no edit asked: `debug-systematic`) |

### `debug-systematic`

| Prompt | Expected |
|--------|----------|
| "l'API va in timeout solo in produzione, non capisco perché" | MUST load (a prod symptom: gather the evidence with `/logs` and `/db` first, then phase 2 here) |
| "questo test passa in locale e fallisce in pipeline" | MUST load |
| "aggiungi un endpoint per esportare gli ordini in CSV" | MUST NOT (a new feature, not a defect) |
| "spiegami come funziona il garbage collector" | MUST NOT (knowledge question, nothing to diagnose) |
| "OrdersQueryTests è rosso e non so perché, sistemalo" | MUST NOT load first (a fix request routes to `deliver`, whose triage calls this skill for the unproven cause) |
| "perché questo test fallisce? non toccare niente" | MUST load (diagnosis only, no edit asked) |

### `skill-forge`

| Prompt | Expected |
|--------|----------|
| "voglio aggiungere una skill al kit per i deploy" | MUST load |
| "questa skill è troppo lunga, come la spezzo?" | MUST load |
| "crea una skill per Cosmos DB" | MUST NOT (generic or Microsoft-specific authoring belongs to the skill-creator plugins) |
| "cosa fa la skill code-review?" | MUST NOT (reading an asset, not authoring one) |

### `dotnet-testing`

| Prompt | Expected |
|--------|----------|
| "aggiungi i test a OrderService, il repo non ne ha nessuno" | MUST load |
| "questo test tocca il database vero o lo fingo?" | MUST load |
| "il test in CI fallisce con timeout, guarda il log della build" | MUST NOT (a red pipeline routes to the CI command) |
| "questo servizio non ha nessun test, da dove inizio?" | MUST load (test strategy) |
| "vale la pena testare questo mapper?" | MUST load |

### `ef-core` — migrations generated, never hand-written

| Prompt | Expected |
|--------|----------|
| "aggiungi una migration per la nuova colonna Email" | MUST load |
| "ho cambiato l'entità Order, crea la migrazione" | MUST load |
| "la migration applicata in staging è sbagliata, come la sistemo?" | MUST load (repair: a corrective migration) |
| "questa query LINQ è lenta" | MUST NOT necessarily load (a slow query is `db-analyst` or `review-performance`) |

### `questionnaire`

| Prompt | Expected |
|--------|----------|
| "sono fermo, non so come il cliente calcola lo sconto: preparami cosa chiedergli" | MUST load and write the file |
| `/questionnaire` | MUST load |
| "fammi le pulci su questo piano" | MUST NOT (`grill-me`: the owner holds the answers) |
| "dove viene calcolato lo sconto nel codice?" | MUST NOT (the environment answers) |

### `grill-me` — scrutiny, not execution

| Prompt | Expected |
|--------|----------|
| `/grill-me` | MUST load |
| "fammi le pulci a questo design" | MUST load (natural phrasing, no slash: the skill is auto-invocable) |
| "attack this design" | MUST load |
| "che ne pensi di questo approccio?" | MUST NOT necessarily load — answering is fine; grilling is for when scrutiny is asked for |
| "grill me su questo design" | MUST load, and the first round MUST ask every unblocked question at once, each with a recommended answer |

### `kowalski`, `skipper`, `rico`, `soldato` — the named entry points

| Prompt | Expected |
|--------|----------|
| "kowalski, analisi: aggiungere l'export CSV degli ordini" | MUST load `kowalski` (analysis and plan, no edit) |
| "/kowalski ticket 4711" | MUST load `kowalski` |
| "spezza questo lavoro in task che posso seguire" | MUST NOT load `kowalski` (no name: `plan-work`) |
| "skipper, procedi con il piano" | MUST load `skipper`, which runs `deliver` |
| "aggiungi il filtro per stato alla lista ordini" | MUST NOT load `skipper` (a plain change: `deliver`) |
| "/rico il saldo risulta negativo dopo il rimborso" | MUST load `rico` (repro, root cause, fix through `skipper`) |
| "perché questo test fallisce? non toccare niente" | MUST NOT load `rico` (diagnosis only: `debug-systematic`) |
| "soldato, testa" after an edit turn | MUST load `soldato`: unit and integration run, real tests only after one question |
| "/kowalski testa" after an edit turn | MUST load `kowalski`, which says so in one line and calls `soldato` |
| "/skipper implementa l'export CSV degli ordini" with no approved plan, size M | MUST load `skipper`, which calls `kowalski` before `deliver` |
| "aggiungi i test a OrderService" | MUST NOT load `soldato` (writing tests: `dotnet-testing`) |

## One-shot skill cases

The ex-commands are invoked by name, so the risk is different from a reference skill's: the failure
mode is the model *acting* on a phrasing the skill does not own, or doing by hand what the skill would
have done in one shot. The forked ones (`/db`, `/logs`) add a second check: the raw output
must stay in the subagent.

### `/db`

| Prompt | Expected |
|--------|----------|
| "quante righe ha Orders con Status = 3?" | MUST invoke, forked into `db-analyst` |
| `/db "SELECT 1"` | MUST return the result in the same turn, from the fork |
| "come indicizzo questa tabella?" | MUST NOT (a schema or index question is answered from `rules/sql.md`) |

### `/logs`

| Prompt | Expected |
|--------|----------|
| "mostrami gli errori dell'api negli ultimi 30 minuti" | MUST invoke, forked into `ops-analyst` |
| "aggiungi Serilog al progetto" | MUST NOT |

