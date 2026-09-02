# Discovery, scrittura e idempotenza

CLI prima, sempre. Configurazione, auth, risoluzione org/progetto, WIQL e i verbi boards e repos
stanno in `azdo-cli`: si chiama quella. Il server MCP Azure DevOps resta il **fallback documentato**
per cio' che la CLI non copre — ricerca full-text, commenti sull'item, artifact link a un commit — e
nel recap si dichiara quale delle due ha scritto.

## Fase 5 — discovery per topic

Solo per i topic **loggabili** (arrotondato > 0). Per ognuno:

1. **Progetto.** Dal mapping workspace→progetto nelle istruzioni utente, in base al path del
   progetto da cui viene il topic. Se il path non e' mappato, o il topic potrebbe stare su org
   diverse e non e' deducibile, **chiedi**: mai indovinare.
2. **Dove segnare le ore.** Cerca via WIQL fra i propri work item, per branch, per area o per
   keyword del topic. Due esiti possibili:
   - un **Task esistente** a cui aggiungere le ore, oppure
   - la **User Story / parent** sotto cui **creare** un nuovo Task.

   Le ore si registrano sui **Task**, non sulle User Story. Se il topic e' chiaramente parte di una
   US che non ha un Task adatto, il Task va creato.
3. **Ore attualmente sul Task.** Leggi il campo del lavoro completato: serve per calcolare il delta,
   perche' la scrittura e' cumulativa.
4. **PR e commit da linkare** (best-effort, poi confermati in Tabella 2):
   - **PR**: cerca quella con source branch uguale al branch del topic;
   - **commit su master**: `git -C "<path-progetto>" log --since=<From> --until=<To+1g> --author=(git config user.email) --oneline`,
     e tieni gli hash pertinenti al topic.
5. **Idempotenza.** Cerca nell'audit una voce con lo stesso `(periodFrom, periodTo, itemId)`. Se
   c'e', prendi nota delle ore **gia' scritte** e calcola il **delta** = ore di adesso − ore gia'
   scritte.

Nessuna cache fra run: la discovery si rifa' ogni volta, perche' item, stati e PR cambiano.

## Fase 7 — scrittura

Distribuisci i topic su **massimo 4 sub-agent in parallelo**, con item **non sovrapposti**: nessun
item toccato da due agent. Se i topic sono 4 o meno, un agent per topic; altrimenti raggruppa in 4
lotti. Ogni agent applica le regole qui sotto ai suoi item e **riporta l'esito** (id item, ore prima
e dopo, link creati, stato). Nessun agent scrive l'audit.

Finiti gli agent, **l'orchestratore** aggiorna l'audit **in sequenza** — una scrittura alla volta,
niente race — e poi **verifica direttamente** rileggendo gli item creati o aggiornati: ore, parent,
stato e link effettivamente presenti. Solo dopo stampa il recap.

### Regole di scrittura

| Regola | Dettaglio |
| --- | --- |
| Ore **cumulative** | leggi il valore attuale del Task, scrivi `attuale + delta`. **Mai** sovrascrivere. Per un Task nuovo il delta e' l'intero delle ore del topic |
| Task nuovi | creali come **figli** della User Story indicata, cosi' ereditano area e iteration. Titolo e descrizione **in inglese** |
| Assegnazione | assegna all'utente, risolvendone l'identita' a runtime; non hardcodare mai un account |
| Stato | **mai** lasciare un item in `New`: `Active` se il lavoro e' in corso (PR aperta, commit non pushato, in attesa di validazione), `Closed` se concluso (PR completata, o commit gia' su master). Se il tipo parte da `New`, correggi subito dopo la creazione |
| Link PR | come **link reale** fra PR e work item, non come URL nel testo: solo il link vero muove le policy |
| Link commit | se non c'e' un verbo per l'artifact link al commit, metti hash e URL nella descrizione o in un commento dell'item, e dillo |
| Prima scrittura in assoluto | su un'org mai toccata nella sessione: scrivi **un solo** item, mostra il risultato, poi procedi col resto |

### Idempotenza in scrittura

- Se l'audit ha gia' una voce per `(periodFrom, periodTo, itemId)`: applica **solo il delta**. Delta
  0 → non toccare le ore; eventualmente aggiungi solo i link mancanti.
- A successo, scrivi o aggiorna la voce con: `periodFrom`, `periodTo`, `topic`, `project`, `itemId`,
  `parentId` (se creato), `created` (bool), `hoursLogged` (le ore **totali** di quel periodo su
  quell'item, non il delta), `prs`, `commits`, `ts`.
- `hoursLogged` e' il totale del periodo, non il cumulativo del work item: e' quello che rende
  calcolabile il delta al ri-run.
- L'audit viene potato dall'engine oltre la finestra di ritenzione: un ri-run molto piu' tardi non
  trovera' la voce e ripartira' da zero. Se il periodo e' vecchio, verifica le ore sull'item prima
  di scrivere.

## Traps

1. Ore raddoppiate → scrittura sovrascritta o delta ignorato → leggi, somma, riscrivi.
2. Ore su una User Story → si loggano sui Task → crea il Task figlio.
3. Item nuovo lasciato in `New` → il tipo parte da `New` → correggi lo stato subito dopo.
4. Due agent sullo stesso item → lotti sovrapposti → item disgiunti per agent.
5. Audit corrotto da scritture concorrenti → gli agent lo hanno scritto → lo scrive solo
   l'orchestratore, in sequenza.
6. PR linkata come URL nella descrizione → non muove nulla → usa il link reale.
7. Recap che descrive il piano invece dell'esito → non si e' riletto nulla → verifica sugli item
   prima di stampare.
