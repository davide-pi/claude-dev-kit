# The four item formats

One shape per role. The four headings below are the **roles** the company classifies by, not Azure
DevOps type names: which type each one is created as is resolved per project through `azdo-cli`. The
shape is the standard: it is copied straight into the board, so consistency matters more than
elegance. Item text is Italian; this guidance is English.

## User Story

Body — exactly these three lines, in Italian, and nothing else:

```
Come [utente/ruolo]
voglio [azione/funzionalità]
così da [valore/obiettivo]
```

| Aspect | Rule |
| --- | --- |
| Title | short, descriptive, action-oriented; not a sentence |
| Language | simple and functional; no technical vocabulary unless genuinely needed |
| Must not contain | acceptance criteria, explanations, notes, alternatives, comments — title plus the three lines, full stop |
| After delivery | ask whether to proceed with the criteria; never write them in the same pass |

Example.

Titolo: Esportazione report mensile in PDF

```
Come responsabile amministrativo
voglio esportare il report mensile in formato PDF
così da poterlo archiviare e condividere senza accesso al gestionale
```

## Bug

Problem-oriented description. **Never** "Come utente".

| Field | Content |
| --- | --- |
| `Comportamento attuale` | what happens now — the problem |
| `Comportamento atteso` | what should happen instead |

| Aspect | Rule |
| --- | --- |
| Title | short and problem-oriented |
| Platform | the project-level platform datum does **not** apply: a Bug is a malfunction already observed on a specific platform |
| Criteria | allowed, but only after asking |

Example.

Titolo: Il totale mensile non si aggiorna dopo la modifica di una riga

```
Comportamento attuale: modificando le ore di una giornata già inserita, il totale mensile in fondo
alla tabella resta invariato finché non si ricarica la pagina.

Comportamento atteso: il totale mensile deve aggiornarsi automaticamente a ogni modifica di una
riga, senza ricaricare la pagina.
```

## Impediment

For a doubtful situation to be analysed or explained **before** an expected behaviour or a fix can
be defined. No acceptance criteria: a single free Description.

Typical signal: whoever reports it is asking "is this a bug, or is someone going to explain it to
me?" and does not already know the answer.

| Part | Content |
| --- | --- |
| Cosa è stato osservato | the context, the steps followed, the supporting data or screenshots |
| Cosa non torna | why it is not obvious whether this is a bug, intended behaviour or something else — the detail that rules out the most obvious explanation |
| Platform, if relevant | if the product has a desktop and a mobile version, say whether the doubtful behaviour concerns one of them or both; never leave it implicit |
| `Da analizzare:` | the closing line, stating explicitly the question whoever receives the item has to answer |

| Aspect | Rule |
| --- | --- |
| Title | oriented to the question or the check to run ("Verifica comportamento di X", "Verifica ordinamento di Y"), not to a problem as if the bug were already confirmed |
| Must not contain | acceptance criteria, the "Come utente" structure, or the `Comportamento attuale` / `atteso` structure |
| After delivery | ask for confirmation that the item is ready; offer no criteria in addition |

Example.

Titolo: Verifica comportamento del filtro Data nel tab Consegne

```
Applicando un filtro sul range Data (es. 01/01/2026 - 31/07/2026) nel tab Consegne, compaiono in
elenco righe con data mostrata successiva al 31/07/2026 (es. 04/08/2026, 09/09/2026, 11/10/2026).

Le righe fuori range mostrano tutte un'etichetta di fallback ("Settimana da CDO fornitore" o
"Settimana da ordine") invece di Data confermata/Data effettiva — il che fa pensare che il filtro
sia applicato su un campo diverso da quello effettivamente mostrato per questi item.

Da analizzare: su quale campo è realmente applicato il filtro Data, e se il comportamento attuale
(mostrare comunque gli item privi di una data reale nel range filtrato) sia intenzionale o un bug —
per poi decidere l'eventuale correzione.
```

## TECH

For internal technical work that the end user never sees: technical debt, refactoring, library
upgrades, infrastructure and devops tasks, configuration. Like an Impediment, no acceptance
criteria: a single free Description.

| Aspect | Rule |
| --- | --- |
| Description | free text, **no fixed structure imposed**. Say clearly what has to be done and why it is needed — technical motivation, the risk of not doing it, the expected impact — in whatever way suits the case |
| Platform | if the activity concerns client-side behaviour and the product has distinct desktop and mobile versions, say which one it applies to (or both) rather than leaving it implicit |
| Title | short, oriented to the technical activity ("Aggiornamento libreria X alla major successiva", "Refactoring modulo di autenticazione") |
| Must not contain | acceptance criteria, the "Come utente" or `Comportamento attuale` / `atteso` structures, and not the Impediment's fixed structure either (cosa osservato / cosa non torna / `Da analizzare:`) — here the Description is free |
| After delivery | ask for confirmation that the item is ready; offer no criteria in addition, as for an Impediment |
