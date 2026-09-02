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

### `dev-loop` — the router

| Prompt | Expected |
|--------|----------|
| "vorrei aggiungere l'export CSV degli ordini, come procediamo?" | MUST load |
| "questo va rifatto o si aggiusta?" | MUST load (classification is the whole question) |
| "qual è la differenza tra `IEnumerable` e `IQueryable`?" | MUST NOT (a knowledge question routes nothing) |
| "/commit" | MUST NOT (the decision is already made; the command owns it) |

### `plan-work`

| Prompt | Expected |
|--------|----------|
| "prima di scrivere codice buttiamo giù i passi per il nuovo modulo di import" | MUST load |
| "spezza questo lavoro in task che posso seguire" | MUST load |
| "rinomina questa variabile in `orderTotal`" | MUST NOT (single-file change: a plan is pure overhead) |
| "leggi il piano e comincia dal task 2" | MUST NOT (executing a plan, not writing one) |

### `done-check`

| Prompt | Expected |
|--------|----------|
| "ho finito, confermi che è tutto a posto prima del commit?" | MUST load |
| "questa feature è pronta per la PR?" | MUST load |
| "fai una review del diff e dimmi se ci sono bug" | MUST NOT (defect hunting is the review axis, not the completion gate) |
| "i test passano?" | MUST NOT (run them and answer; no gate to apply) |

### `delegate-agents`

| Prompt | Expected |
|--------|----------|
| "scrivi i test per queste otto classi, in parallelo" | MUST load |
| "conviene spezzare questo lavoro su più agent?" | MUST load |
| "applica le tre migration in ordine" | MUST NOT (sequential by construction) |
| "chiedi al code-reviewer di guardare il diff" | MUST NOT (a single known subagent, no fan-out to design) |

### `debug-systematic`

| Prompt | Expected |
|--------|----------|
| "l'API va in timeout solo in produzione, non capisco perché" | MUST load |
| "questo test passa in locale e fallisce in pipeline" | MUST load |
| "aggiungi un endpoint per esportare gli ordini in CSV" | MUST NOT (a new feature, not a defect) |
| "spiegami come funziona il garbage collector" | MUST NOT (knowledge question, nothing to diagnose) |

### `review-feedback`

| Prompt | Expected |
|--------|----------|
| "il code-reviewer dice che questo id può essere null, ha ragione?" | MUST load |
| "prima di far girare la review, cosa gli passo?" | MUST load |
| "/pr-review 4312" | MUST NOT (running and posting the review belongs to pr-review) |
| "commenta questa funzione" | MUST NOT (writing comments in code, not receiving feedback) |

### `test-strategy`

| Prompt | Expected |
|--------|----------|
| "questo servizio non ha nessun test, da dove inizio?" | MUST load |
| "vale la pena testare questo mapper?" | MUST load |
| "il test X fallisce, sistemalo" | MUST NOT (a failure routes to debug-systematic) |
| "come si scrive una fixture xUnit?" | MUST NOT (mechanics belong to dotnet-testing) |

### `skill-forge`

| Prompt | Expected |
|--------|----------|
| "voglio aggiungere una skill al kit per i deploy" | MUST load |
| "questa skill è troppo lunga, come la spezzo?" | MUST load |
| "crea una skill per Cosmos DB" | MUST NOT (generic or Microsoft-specific authoring belongs to the skill-creator plugins) |
| "cosa fa la skill pr-review?" | MUST NOT (reading an asset, not authoring one) |

### `typescript`

| Prompt | Expected |
|--------|----------|
| "questa risposta API ha campi nullable, come la tipizzo senza usare `any`?" | MUST load |
| "conviene una union discriminata o tre classi?" | MUST load |
| "aggiungi un indice sulla tabella Orders" | MUST NOT (no types involved) |
| "questo `.cs` non compila" | MUST NOT (wrong language) |

### `angular`

| Prompt | Expected |
|--------|----------|
| "questo componente non si aggiorna dopo l'update dello store, e qui ci sono ancora gli NgModule" | MUST load |
| "conviene passare a signal in questa feature?" | MUST load |
| "come centro verticalmente questa card?" | MUST NOT (CSS and visual design belong to the plugins) |
| "il bundle è troppo grande, misuralo" | MUST NOT (runtime measurement belongs to chrome-devtools-mcp) |

### `react`

| Prompt | Expected |
|--------|----------|
| "il componente rifà la fetch in loop e lo stato del filtro è duplicato in tre punti" | MUST load |
| "mi serve una libreria di state management qui?" | MUST load |
| "misura l'LCP di questa pagina" | MUST NOT (belongs to chrome-devtools-mcp) |
| "scegli la palette per questa dashboard" | MUST NOT (belongs to frontend-design) |

### `dotnet-backend`

| Prompt | Expected |
|--------|----------|
| "questo service è registrato singleton ma inietta il DbContext, cosa cambio?" | MUST load |
| "meglio un controller o un endpoint minimal per questa risorsa?" | MUST load |
| "aggiungi un indice sulla colonna Status" | MUST NOT (belongs to sql-server) |
| "il componente React rifà la fetch" | MUST NOT (wrong stack) |

### `dotnet-testing`

| Prompt | Expected |
|--------|----------|
| "aggiungi i test a OrderService, il repo non ne ha nessuno" | MUST load |
| "questo test tocca il database vero o lo fingo?" | MUST load |
| "il test in CI fallisce con timeout, guarda il log della build" | MUST NOT (a red pipeline routes to the CI command) |
| "quali test vale la pena scrivere per questo mapper?" | MUST NOT (strategy belongs to test-strategy) |

### `dotnet-diagnostics`

| Prompt | Expected |
|--------|----------|
| "il pod va al 100% di CPU in produzione, come capisco cosa fa?" | MUST load |
| "questo endpoint è lento ma non so dove perde tempo" | MUST load |
| "la pagina Angular ci mette 4 secondi a renderizzare" | MUST NOT (browser runtime belongs to the DevTools plugin) |
| "aggiungi un log qui" | MUST NOT (a one-line edit, no investigation) |

### `ef-core`

| Prompt | Expected |
|--------|----------|
| "ho aggiunto la property Email all'entità Customer, allinea il database" | MUST load |
| "questa query carica 500 righe per ogni ordine" | MUST load |
| "scrivi la stored procedure per il report mensile" | MUST NOT (raw T-SQL belongs to sql-server) |
| "il connection pool di Npgsql si esaurisce" | MUST NOT (client behaviour belongs to postgres) |

### `sql-server`

| Prompt | Expected |
|--------|----------|
| "questa stored procedure va in timeout solo per alcuni clienti, perché?" | MUST load |
| "che indice serve a questa query?" | MUST load |
| "aggiungi una migration EF per la colonna Email" | MUST NOT (belongs to ef-core) |
| "questa query sul database di cache è lenta" | MUST NOT (the cache database is Postgres) |

### `postgres`

| Prompt | Expected |
|--------|----------|
| "questa query sul database di cache è lenta, guarda l'EXPLAIN" | MUST load |
| "porto questa tabella da SQL Server, cosa cambia?" | MUST load |
| "come leggo un execution plan di SQL Server?" | MUST NOT (the other engine) |
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

## Command cases

Commands are invoked by name, so the risk is different from a skill's: the failure mode is the
model *acting* on a phrasing the command does not own, or reaching for a skill when a command would
have done it in one shot.

### `/ship`

| Prompt | Expected |
|--------|----------|
| "committa, pusha e apri la PR collegata al 4821" | MUST invoke |
| "fai il merge della PR 210" | MUST NOT (ship stops before the merge, by design) |

### `/status`

| Prompt | Expected |
|--------|----------|
| "cosa ho in ballo adesso?" | MUST invoke |
| "che stato ha il work item 4821?" | MUST NOT (one item belongs to /item) |

### `/item`

| Prompt | Expected |
|--------|----------|
| "fammi vedere i criteri di accettazione del 4821" | MUST invoke |
| "crea un bug per il crash del login" | MUST NOT (creation belongs to workitem-create) |

### `/migrate`

| Prompt | Expected |
|--------|----------|
| "aggiungi una migration per la colonna ShippedAt" | MUST invoke |
| "perché questa query EF fa N+1?" | MUST NOT (belongs to ef-core) |

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

### `/queue`

| Prompt | Expected |
|--------|----------|
| "quanti messaggi ci sono nella dead-letter?" | MUST invoke |
| "come progetto il dead-letter exchange?" | MUST NOT (belongs to rabbitmq) |

### `/spike`

| Prompt | Expected |
|--------|----------|
| "si può leggere quel campo senza toccare l'ORM? provalo e buttalo" | MUST invoke |
| "implementa il nuovo endpoint di export" | MUST NOT (real work: dev-loop routes it) |
