---
name: worklog
description: >-
  Ricostruisce dai transcript di Claude Code cosa e' stato fatto in un periodo (default oggi), stima
  il tempo per topic, e — dopo conferma — registra le ore sui work item Azure DevOps giusti via CLI
  (MCP solo come fallback). Due tabelle riassuntive con loop di conferma/modifica, arrotondamento
  nearest-0.5h senza cap, accorpamento dei micro-topic per ruolo e audit idempotente per non
  riscrivere ore gia' registrate. Due casi distinti: ore di sviluppo sui Task degli item lavorati e
  ore di gestione progetto nella struttura fissa Feature/PBI "Gestione progetto" della commessa, con
  un solo Task per sessione. E' l'unico asset del kit che scrive ore. Trigger esplicito: solo quando
  l'utente scrive /worklog.
---

# worklog — cosa ho fatto, e le ore su Azure DevOps

## When

- L'utente scrive `/worklog`, con o senza periodo (default: oggi).
- Serve sapere cosa e' stato fatto in un giorno o in un range, con il tempo per topic.
- Le ore di un periodo vanno registrate sui work item giusti.
- Un periodo gia' registrato va ri-elaborato: si applica solo il **delta**.
- Va rendicontato tempo di **gestione progetto** (incontri e call cliente, analisi e grooming del
  backlog, stime, coordinamento) che non sta su nessun item di prodotto.

Not for: creare work item nuovi da zero (`workitem-create`) o da un incontro cliente
(`backlog-integration`), leggere o analizzare un item, recensire una PR (`pr-review`), o la
configurazione/auth/verbi della CLI Azure DevOps (`azdo-cli`). Non parte mai senza il trigger
esplicito.

## Decide

### 1. Regole fisse

| Regola | Dettaglio |
| --- | --- |
| Chat e tabelle in **italiano** | ma titoli e descrizioni degli item su Azure **sempre in inglese** |
| I numeri del tempo vengono **solo dall'engine** | mai stimati a mano; se si ripartisce un bucket, si dice |
| Niente hardcoded | org, progetti e item si scoprono a runtime, ogni run |
| Due gate | Tabella 1 e Tabella 2: si procede solo su conferma esplicita |
| `CompletedWork` e' **cumulativo** | si legge, si somma il delta, si riscrive — mai sovrascrivere |
| Mai lasciare un item in stato **New** | `Active` se il lavoro e' in corso, `Closed` se concluso |

### 2. Le fasi

| Fase | Cosa fa | Dettaglio |
| --- | --- | --- |
| 1. Periodo | argomento in linguaggio naturale → `From`/`To` concreti (`yyyy-MM-dd`); se ambiguo **chiedi** | `tempo-e-topic.md` |
| 2. Estrazione | `worklog.ps1` da' i minuti attivi per progetto/branch e scrive il digest grezzo | `tempo-e-topic.md` |
| 3. Topic e ore | topic dal branch, ruolo per topic, poi `round.ps1` per arrotondare e accorpare | `tempo-e-topic.md` |
| 4. Tabella 1 | riepilogo attivita' + loop conferma/modifica | `tabelle.md` |
| 5. Discovery | per ogni topic loggabile: progetto, Task esistente o parent su cui crearlo, PR e commit, delta | `scrittura.md` |
| 6. Tabella 2 | destinazione delle ore + loop conferma/modifica | `tabelle.md` |
| 7. Scrittura | agent paralleli sugli item, poi audit in sequenza e recap verificato | `scrittura.md` |

### 3. Discovery e scrittura: CLI prima, MCP dove la CLI non arriva

La CLI Azure DevOps e' la **prima mossa** per tutta la Fase 5 e per le scritture della Fase 7.
Configurazione, auth, risoluzione org/progetto, WIQL e i verbi boards/repos stanno in `azdo-cli`:
chiamala, non riscriverla qui.

| Serve | Da dove |
| --- | --- |
| progetto pertinente | mapping workspace→progetto nelle istruzioni utente, altrimenti chiedi |
| Task o User Story del topic | CLI: WIQL per assegnatario, branch, area o keyword del topic |
| ore attualmente sul Task | CLI: lettura del work item (serve per il delta) |
| scrittura ore, stato, assegnatario, Task nuovi figli di una US | CLI: verbi boards |
| link della PR al work item | CLI: verbi repos (link reale, non URL nel testo) |
| ricerca full-text, commenti sull'item, artifact link a un commit | **fallback MCP** — la CLI non ha verbo |

Se un topic potrebbe stare su org diverse e non e' deducibile → **chiedi** su quale. Nel recap dichiara
sempre progetto e interfaccia usata (CLI o fallback MCP).

### 4. Due casi: ore di sviluppo e ore di gestione

Le ore si scrivono **solo qui**: nessun altro asset del kit le registra —
`backlog-integration` chiude la sua sessione rimandando a `/worklog`, non scrivendole.
La regola che separa i due casi e' l'**attribuibilita' del topic a un item di prodotto**:

| Caso | Quando | Dove finiscono le ore |
| --- | --- | --- |
| **Sviluppo** | il topic e' lavoro sul prodotto: ha un branch, commit, una PR o un work item che lo copre | sul **Task** dell'item lavorato — Fasi 5-7, `scrittura.md` |
| **Gestione progetto** | il topic non e' attribuibile a nessun item di prodotto: incontri e call cliente, analisi e grooming del backlog, stime, coordinamento, sessioni `/backlog-integration` | struttura fissa per commessa: Feature `Gestione progetto` → PBI `Gestione progetto - <titolo Epic>` → **un solo Task per sessione**, in `Done` — `ore-gestione.md` |

Un topic `internal` (tooling, non fatturabile) **non** e' gestione: resta riga a se' e non si logga.
In dubbio → **chiedi**; mai spalmare ore di gestione su un item di prodotto per far tornare i conti.
I Task che qui si creano o si aggiornano servono **solo al tempo**: una pull request non linka mai un
Task, ma l'item padre (`pr-create`).

## Do

```powershell
# Fase 2 — engine (unica fonte dei numeri). Vuoto = oggi; accetta anche 'ieri'/'yesterday'.
pwsh -NoProfile -File "$HOME\.claude\skills\worklog\worklog.ps1" -From "<yyyy-MM-dd>" -To "<yyyy-MM-dd>"
```

Lo stdout da' progetto → branch, minuti attivi, fascia oraria e numero di prompt, piu' il path del
**digest grezzo** e quello dell'**audit**. L'engine fa anche la retention (pota digest e voci di
audit oltre i 7 giorni). Se stampa "Nessuna attivita'", riferiscilo e fermati. Poi **leggi il
digest** (`_raw/<periodo>.md`) per ricavare topic, descrizioni e decisioni; i transcript originali
solo se manca un dettaglio.

```powershell
# Fase 3 — arrotondamento + accorpamento: TUTTI i topic in una sola invocazione
pwsh -NoProfile -File "$HOME\.claude\skills\worklog\round.ps1" `
  "80|import new markets|main" "4|seed fix|donor" "7|proc fix|keep" "8|worklog tooling|internal"
```

Formato voce `minuti|descrizione-breve-in-inglese|ruolo`. L'helper spalma i `donor` sui `main`, porta
i `keep` a minimo 0.5h, lascia gli `internal` a se', e stampa il totale e la quota **loggabile**.

```powershell
git -C "<path-progetto>" log --since=<From> --until=<To+1g> --author=(git config user.email) --oneline
```

I commit su master pertinenti al topic, per il link della Fase 5.

## Traps

1. Le ore raddoppiano → `CompletedWork` sovrascritto invece di sommato → leggi, somma il delta,
   riscrivi; l'audit dice quanto era gia' stato scritto per quel periodo.
2. Un ri-run dello stesso periodo riscrive tutto → l'audit non e' stato consultato → cerca la voce
   `(periodFrom, periodTo, itemId)` e applica solo il delta; delta 0 → non toccare le ore.
3. Ore loggate su una User Story → le ore si registrano sui **Task** → se manca il Task, crealo come
   figlio della US.
4. Un item nuovo resta in stato `New` → il tipo parte da `New` per default → correggi subito lo stato
   dopo la creazione.
5. Il tempo non torna col vissuto → i gap oltre 15 min sono pause per definizione → e' una stima
   indicativa; si corregge nel loop della Tabella 1, non inventando minuti.
6. Il lavoro su `master` sparisce → non ha un branch-topic → spezzalo in topic semantici leggendo il
   digest e **dichiara** che la ripartizione e' a stima.
7. Due agent scrivono sullo stesso item → lotti sovrapposti in Fase 7 → item disgiunti per agent, e
   l'audit lo scrive solo l'orchestratore, in sequenza.
8. Il recap dice cose che sulla board non ci sono → si e' creduto al report degli agent → rileggi gli
   item scritti prima di stampare il recap.
9. Nasce un secondo Task ore di gestione per lo stesso giorno → ri-run del periodo con creazione
   invece di delta → cerca la voce d'audit e il Task con lo stesso prefisso data, poi somma il delta.

## References

- `tempo-e-topic.md` — periodo, engine e digest, definizione di tempo attivo e di topic, i quattro
  ruoli, regole di arrotondamento e uso di `round.ps1`.
- `tabelle.md` — forma esatta di Tabella 1 e Tabella 2, formato dei link, loop di
  conferma/modifica e recap finale.
- `scrittura.md` — discovery per topic, regole di scrittura su Azure, parallelismo, idempotenza e
  contenuto dell'audit.
- `ore-gestione.md` — il caso gestione progetto: struttura fissa Feature/PBI della commessa, ricerca
  per prefisso, Task ore per sessione, assegnatario a runtime, stato Done e idempotenza.
