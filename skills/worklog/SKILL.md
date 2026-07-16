---
name: worklog
description: Ricostruisce dai transcript di Claude Code cosa e' stato fatto in un periodo (default oggi), stima il tempo per topic, e — dopo conferma — registra le ore sui work item Azure DevOps giusti. Due tabelle riassuntive con loop di conferma/modifica. Trigger esplicito: solo quando l'utente scrive /worklog.
---

# /worklog — Cosa ho fatto + registrazione ore su Azure DevOps

Skill in due atti, ciascuno con una tabella riassuntiva e un loop di conferma/modifica:

1. **Riepilogo attivita'** (Fasi 1-4): dai transcript ricostruisce topic e tempo del periodo → **Tabella 1**.
2. **Registrazione ore** (Fasi 5-7): mappa ogni topic sul work item Azure DevOps giusto → **Tabella 2** → alla conferma scrive (agent paralleli).

Chat e tabelle in **italiano**. **Titoli e descrizioni degli item su Azure sempre in inglese.**
Nessun nome di org/progetto/MCP e' hardcoded qui: org, progetti e nomi degli MCP si scoprono **a runtime**.

---

## Concetti

- **Tempo attivo**: somma degli intervalli fra eventi consecutivi <= 15 min; gli intervalli piu' lunghi (incluse le notti fra i giorni di un range) sono pause e non contano. E' una stima indicativa. **I numeri del tempo vengono SOLO dall'engine**, mai inventati.
- **Topic**: deriva dal branch git. Un `feature/*`/`bugfix/*`/`fix/*` = 1 topic (dagli un nome umano). Il lavoro su `master`/`HEAD`/`(nessun-branch)` non ha topic dal branch → **spezzalo in 1+ topic semantici** leggendo il digest, e ripartisci il suo tempo fra quei topic a stima ragionevole (dillo esplicitamente).
- **Arrotondamento**: nearest-0.5h **indipendente per topic**, **nessun cap**, totale = somma reale. Fatto dall'helper. I topic sotto ~15 min arrotondano a **0h**.
- **Micro-topic (accorpamento)**: i topic che arrotonderebbero a 0h si gestiscono per **ruolo** (vedi Fase 3), per non perdere il tempo ne' riempire il timesheet di righe minime senza casa:
  - `main` = topic vero: riceve la redistribuzione, arrotonda normale.
  - `donor` = micro-topic **senza** item dedicato: i suoi minuti vanno in un pool **spalmato equamente sui main**; il topic sparisce.
  - `keep` = micro-topic **con** un item dedicato: resta e va a **min 0.5h** (così si logga).
  - `internal` = tempo interno/non fatturabile (es. lavoro sul tooling `.claude`): resta come **riga a se'**, arrotonda normale (puo' fare 0h), **non** viene spalmato di default. Solo se l'utente lo chiede esplicitamente lo si converte in `donor`.
- **Idempotenza**: cio' che e' gia' stato scritto su Azure e' registrato in `~/.claude/worklog/pushed.json`. In un ri-run dello stesso periodo la skill mostra "gia' scritto Nh" e applica solo il **delta** (le ore su Azure sono cumulative: mai riscrivere da zero).

---

## FASE 1 — Determina il periodo

Argomento del comando (linguaggio naturale → risolvilo in `From`/`To` concreti, formato `yyyy-MM-dd`):

- vuoto → **oggi** (From=To=oggi)
- `ieri` / `yesterday` → giorno prima
- `yyyy-MM-dd` → quel giorno
- range: `yyyy-MM-dd..yyyy-MM-dd`, "questa settimana", "settimana scorsa", "ultimi N giorni", "10-15 lug", ecc. → calcola i due estremi. Oggi e' la data corrente dal contesto.

Se e' ambiguo (es. "settimana" senza sapere quale) **chiedi** prima di procedere.

---

## FASE 2 — Estrai l'attivita' (engine)

```
pwsh -NoProfile -File "C:\Users\DavidePiccinini\.claude\skills\worklog\worklog.ps1" -From "<yyyy-MM-dd|vuoto>" -To "<yyyy-MM-dd|vuoto>"
```

- Lo **stdout** da' le metriche autorevoli (progetto → branch, minuti attivi, fascia, prompt). Usale così come sono.
- L'engine fa anche la **retention** (pota digest e voci di audit > 7 giorni) e stampa il path del **digest grezzo**.
- Se stampa "Nessuna attivita'", riferiscilo e fermati.

Poi **leggi il digest grezzo** (path in stdout, tipo `~/.claude/worklog/_raw/<periodo>.md`): per progetto → branch → cronologia `TU:`/`CC:`. E' il materiale per topic, descrizioni e decisioni. Apri i transcript originali solo se manca un dettaglio.

---

## FASE 3 — Topic, tempo e arrotondamento

1. Per ogni progetto definisci i **topic** (regole in "Concetti"). Un topic puo' attraversare piu' progetti solo se e' chiaramente lo stesso lavoro; di norma tienili per progetto.
2. Assegna a ogni topic i **minuti misurati** (dai numeri dell'engine; per i bucket `master` ripartisci a stima e dillo).
3. **Assegna un ruolo** a ogni topic (`main`/`donor`/`keep`/`internal`, vedi "Concetti"). Criteri:
   - Topic con tempo >= ~15 min → `main`.
   - Micro-topic (< ~15 min) di lavoro **cliente senza** item dedicato → `donor`.
   - Micro-topic con un item dedicato (o comunque da preservare) → `keep`. La certezza sull'item arriva in Fase 5: qui classifica **a giudizio** dai contenuti e ri-verifica in discovery.
   - Tempo **interno/non fatturabile** → `internal`.
4. **Arrotonda + accorpa** passando *tutti* i topic in un'unica invocazione (formato `minuti|descrizione-breve-in-inglese|ruolo`):
   ```
   pwsh -NoProfile -File "C:\Users\DavidePiccinini\.claude\skills\worklog\round.ps1" "80|import new markets|main" "4|seed fix|donor" "7|proc fix|keep" "8|worklog tooling|internal"
   ```
   L'helper spalma i `donor` sui `main`, porta i `keep` a min 0.5h, lascia gli `internal` a se', e stampa il totale loggabile.

---

## FASE 4 — Tabella 1 + loop conferma/modifica

Stampa in chat **solo** questa tabella (niente cronologia passo-passo, vive nel digest; la riporti solo se richiesta):

```markdown
| # | Topic | Very small description | Time | From | To | Rounded Time |
|---|-------|------------------------|------|------|----|--------------|
| 1 | import new markets | Import & mapping of new betting markets | 1h20m | 09:08 | 10:16 | 1.5h |
| 2 | ... | ... | ... | ... | ... | 0h *(non loggato)* |
| | **Totale** | | **<somma misurata>** | | | **<somma arrotondata>** |
```

- `#` numera le righe così l'utente può dire "cambia l'item 2".
- `Very small description`: **breve, in inglese** (alimenta poi titolo/descrizione dell'item).
- `Time` = misurato; `From`/`To` = fascia (aggiungi la data se il range copre piu' giorni); `Rounded Time` = dall'helper. Segna con nota le righe a **0h (non loggato)**.

Poi **chiedi**: "Vuoi modificare qualcosa (topic, descrizioni, tempi, accorpare/dividere righe)?"
- Se l'utente modifica → **applica, ri-arrotonda se cambiano i minuti, ristampa la Tabella 1 e richiedi conferma**. Ripeti finché non conferma esplicitamente.
- Solo dopo la conferma si passa alla Fase 5.

---

## FASE 5 — Discovery Azure DevOps (rediscovery, senza cache)

Obiettivo: per ogni topic **loggabile** (Rounded > 0) trovare dove segnare le ore.

### MCP disponibili
Usa gli MCP Azure DevOps **connessi in questa sessione** — riconoscibili dai tool `mcp__<nome>__wit_*`, `..._search_*`, `..._repo_*`, `..._core_*`. Non assumere i nomi: guarda quali tool esistono davvero.
- Possono essercene **piu' di uno**. Se **due MCP puntano allo stesso Azure DevOps** (stesso org) sono equivalenti → **usa il primo** che trovi.
- Se un topic potrebbe stare su org diversi e non e' deducibile → **chiedi** all'utente su quale.

### Per ogni topic
1. **Trova il work item**: cerca fra i tuoi work item / per branch / per keyword del topic (`wit_my_work_items`, `wit_get_work_item`, `search_*`) sull'MCP/progetto pertinente. Determina:
   - un **Task esistente** dove aggiungere le ore, **oppure**
   - la **User Story / parent** sotto cui **creare** un nuovo Task (le ore si loggano sui Task, non sulle US).
2. **PR e commit da linkare** (best-effort, poi conferma):
   - **PR**: cerca la/le PR con source branch = il branch del topic (`repo_*`/`search_*`).
   - **Commit su master**: `git -C "<path-progetto>" log --since=<From> --until=<To+1g> --author=<email utente> --oneline` (email da `git config user.email`). Prendi gli hash/URL pertinenti al topic.
3. **Idempotenza**: cerca in `~/.claude/worklog/pushed.json` una voce con stesso `(periodFrom, periodTo, itemId)`. Se c'e', nota le ore **gia' scritte** e calcola il **delta** = (ore ora) − (ore gia' scritte).

---

## FASE 6 — Tabella 2 + loop conferma/modifica

```markdown
| # | Topic | Very small description | Rounded Time | MCP used - Project | Item |
|---|-------|------------------------|--------------|--------------------|------|
| 1 | import new markets | Import & mapping of new markets | 1.5h | <mcp-name> - <Project> | Task #105060 (esistente, +1.5h) |
| 2 | cache fix | Translations cache invalidation fix | 0.5h | <mcp-name> - <Project> | parent US #105025 → **Task DA CREARE** |
```

- `MCP used - Project`: nome MCP realmente connesso + progetto (così l'utente sa *quale* Azure DevOps e *quale* progetto).
- `Item`:
  - Task esistente → `Task #<id> (esistente, +<delta>h)`; se in `pushed.json` risulta gia' scritto, indica `gia' scritto <X>h → delta <±Y>h`.
  - Task da creare → `parent #<id> → **Task DA CREARE**`.
- Sotto la tabella elenca, per riga, **PR e commit** che verranno linkati (o "nessuno").
- Ometti le righe a 0h (non loggate), ma ricordale in una nota.

Poi **chiedi** modifiche (item diverso, cambio MCP/progetto, creare/non creare, ore, PR/commit).
- Se modifica → **rifai Fase 5 dove serve, ristampa la Tabella 2, richiedi conferma**. Ripeti finché non conferma.
- Solo alla conferma esplicita si scrive.

---

## FASE 7 — Scrittura su Azure (agent paralleli)

Alla conferma, esegui le scritture. Distribuisci i topic su **al massimo 4 sub-agent in parallelo**, con item **non sovrapposti** (nessun item toccato da due agent). Se i topic sono ≤4 → un agent per topic; altrimenti raggruppa in ≤4 lotti.

Ogni agent, per i suoi item, applica le **Regole di scrittura** qui sotto e **riporta l'esito** (id item, ore prima/dopo, link creati, stato). **Non** scrive l'audit.

Dopo che gli agent hanno finito, **l'orchestratore (tu)** aggiorna `~/.claude/worklog/pushed.json` **in sequenza** (una scrittura alla volta, niente race), poi stampa un **recap finale** di cosa e' stato scritto.

### Regole di scrittura (MCP per-org; valgono anche via REST se un MCP non e' connesso)
- **CompletedWork e' CUMULATIVO**: leggi il valore attuale del Task (`wit_get_work_item`), poi scrivi `attuale + delta` (`wit_update_work_item`). **Mai** sovrascrivere. Il delta e' quello calcolato in Fase 5 (per un item nuovo, delta = ore intere del topic).
- **Task nuovi**: creali come **figli** della User Story/parent indicata (ereditano Area/Iteration). Titolo e descrizione **in inglese**.
- **Assegna a te**: risolvi l'identita' dell'utente a runtime (tool "me"/identity dell'MCP, oppure `git config user.email`) — non hardcodare l'account qui.
- **Stato**: metti il work item **Closed** se il lavoro e' concluso.
- **Link PR**: come **ArtifactLink** (`wit_link_work_item_to_pull_request`), non come URL nel testo.
- **Link commit su master**: se l'MCP espone un tool per linkare un commit (ArtifactLink al commit), usalo; altrimenti aggiungi hash/URL dei commit nella **descrizione** o in un **commento** del work item.
- Usa i **nomi dei tool realmente esposti** dal server connesso: non inventarli.

### Idempotenza in scrittura
- Se `pushed.json` ha gia' una voce per `(periodFrom, periodTo, itemId)`: applica solo il **delta** (ore-ora − ore-gia'-scritte). Se il delta e' 0 → non toccare le ore (eventualmente aggiorna solo link mancanti).
- Dopo il successo, scrivi/aggiorna la voce con: `periodFrom`, `periodTo`, `topic`, `mcp`, `project`, `itemId`, `parentId` (se creato), `created` (bool), `hoursLogged` (ore totali di questo periodo su quell'item, non il delta), `prs`, `commits`, `ts`.

---

## Stile
- Chat/tabelle in italiano; titoli/descrizioni item in inglese.
- Numeri del tempo solo dall'engine. Se ripartisci `master` fra topic, dillo.
- Non stampare la cronologia passo-passo in chat (vive nel digest).
- Alla prima scrittura in assoluto su un Azure DevOps mai testato in sessione: scrivi **un solo** item, mostra il risultato, poi procedi col resto.
