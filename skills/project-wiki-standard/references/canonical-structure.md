# The canonical structure, page by page

Every client's wiki has the same shape. A client will accumulate products over time, so the tree is
built to hold several projects under one client without either of them borrowing the other's pages.
All page content is **Italian**; the page names below are the structure and are never translated.

## The tree

```
/                                        <- pagina Cliente: it IS the wiki root
|-- /Glossario                           <- domain vocabulary, shared by all this client's projects
`-- /<Nome progetto>                     <- one per product or initiative; a client may have many
    |-- /Requisiti                       <- "Scopo" and "Perimetro" written directly on this page
    |   `-- /<Nome funzionalità>         <- one subpage per feature, each ending in "Casi limite"
    |-- /Vincoli                         <- facts imposed from outside
    |-- /Architettura                    <- the decisions taken in response, decision-record style
    |-- /Domande aperte
    |   |-- /Domande cliente
    |   `-- /Domande terze parti         <- one entry per relevant external technical interlocutor
    `-- /Chiusura progetto               <- filled at the end, only on explicit request
```

## What each page owns

| Page | Owns | Never holds |
| --- | --- | --- |
| `/` (root) | who the client is, sector and context, contacts: people inside the client and the external technical third parties (the vendor of a management system, another supplier) | project detail, requirements, decisions |
| `/Glossario` | one entry per domain term specific to this client, with its definition | a term explained again inside another page |
| `/<Progetto>` | what this product is, in a few lines, and links to its own subpages | anything a subpage owns |
| `Requisiti` | `## Scopo` and `## Perimetro`, on the page itself | per-feature detail (that is a subpage) |
| `Requisiti/<Funzionalità>` | what that feature must do, and `## Casi limite` last | a rule belonging to another feature |
| `Vincoli` | given facts: the client's infrastructure, a mandatory integration, the kind of devices in the field, an imposed platform | any choice made in response |
| `Architettura` | one decision record per choice: the choice, the alternatives rejected, why | the constraint that forced the choice |
| `Domande aperte` | how the open questions are organised, nothing more | the questions themselves |
| `Domande cliente` | still-unanswered questions for the client | an answered question |
| `Domande terze parti` | still-unanswered questions per external interlocutor | an answered question |
| `Chiusura progetto` | delivered scope against planned, deviations and why, known technical debt, a link to the final `Architettura` | anything written before the project closes |

Do **not** create a separate "Cliente" page. The client content goes directly on the root `/`,
because that is where anyone opening the wiki lands first.

## Why `Vincoli` and `Architettura` are separate

`Vincoli` are given: nobody in the team decided them, and they cannot be argued with — the client
has only on-premise infrastructure, an integration with an existing system is mandatory, the devices
in the field are of a certain kind. `Architettura` is what was decided *because* of them.

Mixing the two makes it impossible, reading the page months later, to tell what was imposed from
what was chosen — and therefore impossible to know which decisions are still open to revision. So
`Architettura` is written as decision records:

```markdown
## <Nome della decisione>

**Scelta.** <cosa si è deciso, in una frase>
**Vincoli che la impongono.** <rimando ai vincoli in gioco, senza ricopiarli>
**Alternative scartate.** <opzione> — <perché è stata scartata>
**Conseguenze.** <cosa comporta, incluso quello che rende più difficile>
```

## Zero duplication, applied

| Situation | Correct move |
| --- | --- |
| an answer arrives to an open question | write it on the owning page (`Requisiti`, `Vincoli` or `Architettura`), then delete the question |
| the same fact is useful on two pages | it lives on the owning page; the other page refers to it, never copies it |
| an edge case emerges | it goes in `## Casi limite` on the page of the feature it concerns |
| a domain term keeps being re-explained | one entry in `/Glossario`; the other pages just use the term |
| a page would be "handy" for collecting answers | do not create it: an answers page is duplication by construction |

## Table of contents

More than about four sections on a page → `[[_TOC_]]` on a line of its own, immediately after the
introduction and before the first `##`. Azure DevOps turns it into a clickable section index at the
top of the page. Short pages — one or two sections, as most feature subpages are — go without.

## Page skeletons (Italian, placeholders welcome)

Root `/`:

```markdown
# <Nome cliente>

<Chi è il cliente, settore e contesto in poche righe.>

[[_TOC_]]

## Contesto e settore
## Referenti interni
| Nome | Ruolo | Contatto |
## Terze parti tecniche
| Azienda | Ruolo nel progetto | Referente |
## Progetti
| Progetto | Stato | Pagina |
```

`/Glossario`:

```markdown
# Glossario

Vocabolario di dominio condiviso tra tutti i progetti di questo cliente.

| Termine | Significato |
| --- | --- |
| — | nessun termine ancora raccolto |
```

`Requisiti`:

```markdown
# Requisiti

[[_TOC_]]

## Scopo
<Perché il progetto esiste, il problema che risolve.>

## Perimetro
**Incluso.** <...>
**Escluso.** <...>

## Funzionalità
| Funzionalità | Pagina |
```

`Requisiti/<Funzionalità>`:

```markdown
# <Nome funzionalità>

<Cosa deve fare, dal punto di vista di chi la usa.>

## Comportamento atteso
## Casi limite
<Uno per riga, man mano che emergono. Vuoto in partenza va bene.>
```

`Vincoli`:

```markdown
# Vincoli

Fatti imposti dall'esterno. Le decisioni prese in risposta stanno in Architettura.

| Vincolo | Origine | Impatto |
```

`Domande aperte` and its two subpages:

```markdown
# Domande cliente

Domande ancora senza risposta. Quando una risposta arriva, il contenuto si sposta nella pagina di
competenza e la domanda si cancella da qui.

| # | Domanda | Chi deve rispondere | Aperta dal |
```

`Chiusura progetto` (kept empty until explicitly asked for):

```markdown
# Chiusura progetto

## Perimetro consegnato rispetto al pianificato
## Scostamenti e perché
## Debito tecnico e limitazioni note
## Architettura finale
<link alla pagina Architettura>
```
