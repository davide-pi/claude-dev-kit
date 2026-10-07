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
| "abbiamo fatto una riunione, ti racconto i punti" | MUST NOT without the trigger (meeting-driven creation, writes to a real board) |

### `pr-review` — explicit trigger only

| Prompt | Expected |
|--------|----------|
| `/pr-review` | MUST load |
| `/pr-review 4312 high security` | MUST load, and the focus must narrow the fan-out to `review-security` |
| "guarda la PR 4312 e dimmi se ci sono problemi" | MUST NOT post anything; a chat review is the correct answer |
| "commenta tu la PR con i dubbi" | MUST load (that is exactly its contract) |
| "il code-reviewer dice che questo id può essere null, ha ragione?" | MUST load (receiving findings) |

### `code-review` (command) — the local diff

| Prompt | Expected |
|--------|----------|
| `/code-review` | MUST run on the working diff, chat-only |
| `/code-review high` | MUST fan out to the two specialists as well |
| "rivedi le modifiche che hai appena fatto" | MUST route through the review subagents (per the CLAUDE.md convention), not an inline read-through |
| "sistema questo bug" | MUST NOT (fixing is not reviewing) |

### `pr-create` — convention skill, ambient

| Prompt | Expected |
|--------|----------|
| "apri la PR" | `pr-create` MUST load (title/description conventions) |
| "fai il commit" | MUST NOT dominate — `/commit` owns this |

### `pipeline` — CI/CD authoring

| Prompt | Expected |
|--------|----------|
| "aggiungi uno stage di test a questa pipeline" (file under `.pipelines/`) | MUST load |
| "modifica il docker-compose per aggiungere redis" | MUST NOT (compose is not a CI/CD pipeline) |
| "questo YAML di Kubernetes è corretto?" | MUST NOT (manifest, not pipeline) |


### `commit` (command)

| Prompt | Expected |
|--------|----------|
| `/commit` | MUST commit on the current branch, message generated from the diff |
| `/commit -b fix/date-filter` | MUST create the branch and commit there |
| "committa e pusha" | MUST commit; the push is a separate, explicit act (the command never pushes) — and on the default branch the guard hook asks first |
| "cosa ho modificato?" | MUST NOT (a question about the diff, not a request to commit) |

### `grill-me` — scrutiny, not execution

| Prompt | Expected |
|--------|----------|
| "buca il mio piano di refactoring" | MUST load |
| "che ne pensi di questo approccio?" | MUST NOT necessarily load — answering is fine; grilling is for when scrutiny is asked for |
| "grill me su questo design" | MUST load, and the first round MUST ask every unblocked question at once, each with a recommended answer |

## When a case fails

1. Decide which direction it failed in (missing load vs unwanted load).
2. Change the **description**, not the body: that is what the model matches on. For a false positive,
   name the boundary explicitly ("only when the user types `/x`", "not for … "). For a false
   negative, add the words a user actually says.
3. Re-run the affected cases, then `node tools/validate.mjs` (the description limits are enforced
   there), and note in the PR which case changed behaviour.

### `dev-loop` — the router

| Prompt | Expected |
|--------|----------|
| "vorrei aggiungere l'export CSV degli ordini, come procediamo?" | MUST load |
| "questo va rifatto o si aggiusta?" | MUST load (classification is the whole question) |
| "qual è la differenza tra `IEnumerable` e `IQueryable`?" | MUST NOT (a knowledge question routes nothing) |
| "/commit" | MUST NOT (the decision is already made; the command owns it) |
| "si può leggere quel campo senza toccare l'ORM? provalo e buttalo" | MUST load (throwaway spike) |
| "conviene spezzare questo lavoro su più agent?" | MUST load (parallel fan-out) |
| "applica le tre migration in ordine" | MUST NOT fan out (sequential by construction) |

### `plan-work`

| Prompt | Expected |
|--------|----------|
| "prima di scrivere codice buttiamo giù i passi per il nuovo modulo di import" | MUST load |
| "spezza questo lavoro in task che posso seguire" | MUST load |
| "rinomina questa variabile in `orderTotal`" | MUST NOT (single-file change: a plan is pure overhead) |
| "leggi il piano e comincia dal task 2" | MUST NOT (executing a plan, not writing one) |
| "prendi in carico la story 4711, da dove parto?" | MUST load (item analysis) |
| "crea gli item per questa feature" | MUST NOT (creation belongs to workitem-create) |

### `done-check`

| Prompt | Expected |
|--------|----------|
| "ho finito, confermi che è tutto a posto prima del commit?" | MUST load |
| "questa feature è pronta per la PR?" | MUST load |
| "fai una review del diff e dimmi se ci sono bug" | MUST NOT (defect hunting is the review axis, not the completion gate) |
| "i test passano?" | MUST NOT (run them and answer; no gate to apply) |

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

### `angular`

| Prompt | Expected |
|--------|----------|
| "questo componente non si aggiorna dopo l'update dello store, e qui ci sono ancora gli NgModule" | MUST load |
| "conviene passare a signal in questa feature?" | MUST load |
| "come centro verticalmente questa card?" | MUST NOT (CSS and visual design belong to the plugins) |
| "il bundle è troppo grande, misuralo" | MUST NOT (runtime measurement belongs to the browser tools) |

### `react`

| Prompt | Expected |
|--------|----------|
| "il componente rifà la fetch in loop e lo stato del filtro è duplicato in tre punti" | MUST load |
| "mi serve una libreria di state management qui?" | MUST load |
| "misura l'LCP di questa pagina" | MUST NOT (Core Web Vitals belong to modern-web-guidance) |
| "scegli la palette per questa dashboard" | MUST NOT (belongs to frontend-design) |

### `dotnet-backend`

| Prompt | Expected |
|--------|----------|
| "questo service è registrato singleton ma inietta il DbContext, cosa cambio?" | MUST load |
| "questo handler RPC EasyNetQ ritenta con Polly, la policy è giusta?" | MUST load |
| "aggiungi un indice sulla colonna Status" | MUST NOT (belongs to sql-server) |
| "il componente React rifà la fetch" | MUST NOT (wrong stack) |

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
| "la pagina Angular ci mette 4 secondi a renderizzare" | MUST NOT (browser runtime belongs to the browser tools) |
| "aggiungi un log qui" | MUST NOT (a one-line edit, no investigation) |

### `ef-core`

| Prompt | Expected |
|--------|----------|
| "ho aggiunto la property Email all'entità Customer, allinea il database" | MUST load |
| "questa query carica 500 righe per ogni ordine" | MUST load |
| "scrivi la stored procedure per il report mensile" | MUST NOT (raw T-SQL belongs to sql-server) |
| "il connection pool di Npgsql si esaurisce" | MUST NOT (client behaviour belongs to sql-server, Postgres section) |
| "aggiungi una migration per la colonna ShippedAt" | MUST load (migration workflow) |

### `sql-server`

| Prompt | Expected |
|--------|----------|
| "questa stored procedure va in timeout solo per alcuni clienti, perché?" | MUST load |
| "che indice serve a questa query?" | MUST load |
| "aggiungi una migration EF per la colonna Email" | MUST NOT (belongs to ef-core) |
| "questa query sul database di cache è lenta, guarda l'EXPLAIN" | MUST load (the Postgres half) |
| "porto questa tabella da SQL Server a Postgres, cosa cambia?" | MUST load (the Postgres half) |
| "aggiungi il servizio postgres al compose" | MUST NOT (belongs to docker-dev-env) |

### `redis-dotnet`

| Prompt | Expected |
|--------|----------|
| "il servizio va in RedisTimeoutException sotto carico" | MUST load |
| "dove creo il ConnectionMultiplexer?" | MUST load |
| "che struttura dati Redis uso per una leaderboard?" | MUST NOT (data modelling belongs to the Redis plugin) |
| "configura le ACL sull'istanza" | MUST NOT (belongs to the Redis plugin) |

### `rabbitmq`

| Prompt | Expected |
|--------|----------|
| "questa coda cresce e i messaggi finiscono nell'error queue" | MUST load |
| "questo consumer riprocessa lo stesso messaggio due volte" | MUST load |
| "aggiungi il servizio rabbitmq al docker compose" | MUST NOT (belongs to docker-dev-env) |
| "il DbContext è registrato singleton" | MUST NOT (wrong domain) |
| "quanti messaggi ci sono nella dead-letter?" | MUST load (broker inspection) |

## Command cases

Commands are invoked by name, so the risk is different from a skill's: the failure mode is the
model *acting* on a phrasing the command does not own, or reaching for a skill when a command would
have done it in one shot.

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
| "facciamo una retrospettiva di questa sessione: cosa miglioriamo nel kit?" | MUST invoke |
| "com'è andato lo sprint?" | MUST NOT (a team retrospective, not a session's environment) |

### `/item`

| Prompt | Expected |
|--------|----------|
| "fammi vedere i criteri di accettazione del 4821" | MUST invoke |
| "crea un bug per il crash del login" | MUST NOT (creation belongs to workitem-create) |

### `/fix-ci`

| Prompt | Expected |
|--------|----------|
| "la build su feature/orders è rossa, perché?" | MUST invoke |
| "questo test fallisce in locale" | MUST NOT (belongs to debug-systematic) |

### `/db`

| Prompt | Expected |
|--------|----------|
| "quante righe ha Orders con Status = 3?" | MUST invoke |
| "come indicizzo questa tabella?" | MUST NOT (belongs to sql-server) |

### `/logs`

| Prompt | Expected |
|--------|----------|
| "mostrami gli errori dell'api negli ultimi 30 minuti" | MUST invoke |
| "aggiungi Serilog al progetto" | MUST NOT (belongs to dotnet-diagnostics) |

### `azdo-cli`

| Prompt | Expected |
|--------|----------|
| "leggi il work item 4711 con i suoi criteri di accettazione" | MUST load |
| "quali stati ha il tipo Bug in questo progetto?" | MUST load |
| "apri una issue su GitHub per questo bug" | MUST NOT (other platform: gh) |
| "questa query WIQL è lenta" | MUST NOT (not a thing: WIQL is not tuned here) |

### `branch-flow`

| Prompt | Expected |
|--------|----------|
| "creami un branch per questa modifica" | `branch-flow` MUST load (naming + protected-main rules) |
| "come chiamo il branch per questa fix?" | MUST load |
| "il lavoro è finito, come lo porto su main?" | MUST load |
| "voglio lavorare su questa cosa senza toccare il working tree corrente" | MUST load (the worktree half) |
| "scrivi il messaggio di commit" | MUST NOT (belongs to /commit) |

### `docker-dev-env`

| Prompt | Expected |
|--------|----------|
| "il container di sql server non parte, si riavvia in loop" | MUST load |
| "mi serve un postgres locale per provare questa cosa" | MUST load |
| "questa query postgres è lenta, leggi l'EXPLAIN" | MUST NOT (belongs to sql-server) |
| "deploya in staging" | MUST NOT (local environments only) |

### `items-qa` — explicit trigger only

| Prompt | Expected |
|--------|----------|
| `/items-qa 101 102 https://test.example mobile` | MUST load |
| `/items-qa` | MUST load |
| "controlla se questo componente rispetta gli AC" | MUST NOT (no explicit trigger: it drives a real browser and posts a comment) |
| "apri il sito e fai uno screenshot" | MUST NOT (browser use is not a work-item verdict) |

## Cases for the standards ported from the PM's own skills

### `user-story-standard`

| Prompt | Expected |
|--------|----------|
| "mi serve una story per l'esportazione del report mensile in PDF" | MUST load |
| "scrivimi i criteri di accettazione di questo item" | MUST load |
| "il filtro data mostra righe fuori range, ma non so se è un bug" | MUST load (the Impediment branch is exactly this) |
| "crea questi tre item su Azure DevOps sotto la Feature 1234" | MUST NOT (putting items on the board is workitem-create) |
| "traduci questa user story in inglese" | MUST NOT (a translation, not the standard) |

### `project-wiki-standard` — explicit trigger only

| Prompt | Expected |
|--------|----------|
| `/project-wiki-standard` | MUST load |
| "aggiorna la documentazione di architettura del repo" | MUST NOT (a repository docs tree is doc-keeper) |
| "scrivi la pagina Vincoli sulla wiki" | MUST NOT without the trigger (it writes to a real wiki) |
