# Ore di gestione progetto

Il caso "gestione": tempo **non attribuibile a nessun item di prodotto** — incontri e call cliente,
analisi e grooming del backlog, stime, coordinamento, sessioni `/backlog-integration`. Non va sui
Task del lavoro svolto (quello e' `scrittura.md`), ma in una **struttura fissa per commessa**.

Le ore si scrivono **solo da qui**: nessun altro asset del kit le registra.

## La struttura fissa

Per ogni commessa, dove la **commessa e' il titolo dell'Epic**:

```text
Epic  <titolo Epic>                          ← la commessa
└── Feature  "Gestione progetto"             ← titolo esatto, uno per Epic
    └── PBI  "Gestione progetto - <titolo Epic>"   ← uno solo, contenitore di tutte le ore
        ├── Task  "AAAA/MM/GG - <titolo attivita'>"   ← una per sessione loggata
        └── Task  "AAAA/MM/GG - <titolo attivita'>"
```

| Livello | Regola |
| --- | --- |
| Feature | titolo **esatto** `Gestione progetto`, figlia dell'Epic |
| PBI | **uno solo** per Epic, titolo `Gestione progetto - <titolo Epic>` |
| Task ore | **uno per sessione loggata**, non uno per item lavorato |

## Come si trova il PBI (e come si crea se manca)

1. **Org e progetto** dal mapping workspace→progetto nelle istruzioni utente, in base al path del
   progetto. Passali espliciti a ogni comando: mai il default di `az devops configure`. Path non
   mappato → **chiedi**.
2. **Epic della commessa.** Se il progetto ha piu' Epic e quella pertinente non e' deducibile dal
   lavoro del periodo, **chiedi**: le ore di gestione finiscono su una commessa, sbagliarla e'
   sbagliare il cliente.
3. **Tutte le Feature dell'Epic**, comprese quelle **Done** — qui non si filtra per stato, la
   Feature di gestione di una commessa vecchia e' spesso chiusa.
4. **Il PBI fra i figli di quelle Feature, per match di prefisso**, non per titolo esatto: il titolo
   contiene il nome della commessa e puo' non coincidere carattere per carattere con quello che ti
   aspetti.

   ```text
   [System.WorkItemType]='Product Backlog Item'
     AND [System.Title] CONTAINS 'Gestione progetto -'
     AND [System.Parent] IN (<featureId>, ...)
   ```

5. **Se non c'e', crealo** con titolo `Gestione progetto - <titolo Epic>` sotto la Feature
   `Gestione progetto`. Se manca anche quella Feature, creala **prima** (titolo esatto
   `Gestione progetto`, figlia dell'Epic), poi il PBI sotto di essa, poi il Task.

Verbi, flag e WIQL completa stanno in `azdo-cli`: si chiama quella, non si improvvisa la sintassi.
Vale anche qui la regola generale — nella WIQL il progetto va nominato **dentro** la query, non solo
sul comando.

## Il Task ore

| Campo | Valore |
| --- | --- |
| tipo | `Task`, figlio del PBI di gestione |
| titolo | `AAAA/MM/GG - <titolo attivita'>` — la data e' quella della sessione loggata |
| assegnatario | l'identita' CLI **correntemente loggata**, risolta a runtime; mai un valore fisso |
| lavoro completato | le ore della sessione (arrotondate dall'helper, come ogni altra riga) |
| stato | forzato a **Done** subito dopo la creazione — un Task ore non resta mai in `New` |

Il titolo attivita' e' la sintesi di cosa si e' fatto in quella sessione di gestione: una riga, in
italiano come il resto della struttura, coerente con la descrizione mostrata in Tabella 1.

## Idempotenza

- La regola cumulativa vale anche qui: si legge il lavoro completato attuale, si somma il **delta**,
  si riscrive. Per un Task appena creato il delta e' l'intero delle ore.
- Un ri-run dello stesso periodo **non** crea un Task gemello: cerca prima nell'audit la voce
  `(periodFrom, periodTo, itemId)` e, in mancanza, il Task del PBI di gestione con lo stesso prefisso
  data nel titolo. Trovato → aggiorna le ore col delta. Delta 0 → non toccare nulla.
- Nell'audit la riga di gestione si scrive come le altre, con `itemId` del Task e `parentId` del PBI.

## In Tabella 2

La gestione compare come una riga normale, cosi' l'utente vede dove finiscono le ore prima che si
scriva: progetto, PBI di gestione come parent con link e titolo, Task esistente o **DA CREARE**.

```markdown
| # | Topic | Very small description | Rounded Time | Progetto | Item |
|---|-------|------------------------|--------------|----------|------|
| 3 | riunione cliente | Meeting + backlog grooming | 1.5h | <Project> | parent [PBI #<id> — Gestione progetto - <titolo Epic>](<link>) → **Task DA CREARE** ("AAAA/MM/GG - <titolo attivita'>") |
```

Se in un periodo ci sono piu' sessioni di gestione, sono **piu' righe** e piu' Task, uno per
sessione: non si accorpano in un unico Task del periodo.

## Traps

1. Il PBI di gestione non si trova e ne nasce un doppione → si e' cercato per titolo esatto o solo
   fra le Feature non Done → match per prefisso, su tutte le Feature dell'Epic, Done incluse.
2. Le ore di gestione finiscono su un item di prodotto → il topic sembrava vicino a una US → se non
   e' attribuibile a un item, e' gestione; in dubbio chiedi.
3. Un Task ore per ogni item lavorato → si e' applicata la logica delle ore di sviluppo → un solo
   Task per sessione.
4. Il Task ore resta assegnato a un account fisso → l'identita' era hardcoded → risolvila a runtime,
   ogni volta.
5. Il Task ore resta in `New` → lo stato non e' stato forzato dopo la creazione → subito a `Done`.
6. Ri-run dello stesso giorno e ore raddoppiate → nuovo Task invece del delta → cerca per audit e
   per prefisso data prima di creare.
7. Un topic `internal` (tooling, non fatturabile) finisce in gestione → sono cose diverse →
   `internal` resta riga a se' e non si logga.
