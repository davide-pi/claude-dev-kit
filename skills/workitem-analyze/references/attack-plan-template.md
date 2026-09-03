# The attack plan — shape, length, and a worked example

## What it is for

One artefact that lets someone — you tomorrow, or a reviewer today — see what the item really
involves without re-reading it. It is short on purpose: a page, not a design document. If the plan
grows past a page the verdict was probably **needs a plan**, and `plan-work` owns the rest.

Write it to a file so it survives the session. A plan that lives only in chat gets re-derived from
scratch after the next comment.

**The plan is written in Italian** — it is read by the owner, not by the model. Only the markers keep
their form: the `[S]` / `[D]` / `[A]` tags, the verdict keywords, `[BLOCKING]` / `[non-blocking]`,
`file:line` paths, and Azure DevOps field, type and state names. This page is guidance, so it is
English; the two blocks below are the artefact, so they are Italian.

## The shape

```markdown
# <id> <titolo> — piano di attacco

**Verdetto:** implementable | needs a plan | needs splitting | blocked | not ready
**Tipo / stato / iterazione:** <tipo> · <stato> · <iterazione>
**Padre:** <id> <titolo>

## Cosa chiede l'item
- [S] "<criterio o requisito citato testualmente>"
- [S] "<criterio citato>"  — superato dalla discussione del <data>: <cosa è stato deciso al posto suo>

## Com'è il codice oggi
- [D] <comportamento> è deciso in `<path>:<line>`
- [D] <chiamante> ci arriva da `<path>:<line>`
- [D] <cosa l'item dà per esistente> non esiste — cercato in <dove>

## Modifiche, per punto
| # | Dove | Modifica | Perché |
| - | --- | --- | --- |
| 1 | `<path>` | <cosa cambia> | [S] <criterio> |
| 2 | `<path>` | <cosa cambia> | [D] <punto di chiamata che la impone> |
| 3 | <test> | <cosa viene coperto> | i criteri qui sopra |

## Fuori perimetro
- <cosa un lettore darebbe per incluso, e non lo è> — in carico a <item / a nessuno per ora>
- <cosa copre il padre e questo item no>

## Assunzioni
- [A] <decisione presa, e perché> — solo implementativa, reversibile

## Domande da chiudere prima
1. [BLOCKING] <domanda chiusa>  Proposta: <opzione>. Conseguenza: <cosa cambia>.
2. [non-blocking] <domanda chiusa>  Proposta: <opzione>.

## Prossimo passo
<l'asset successivo: la skill di dominio, `plan-work`, `workitem-create`, o niente finché Q1 è aperta>
```

## The rules that make it useful

| Section | Rule |
| --- | --- |
| `Verdetto` | first line, always. It is the thing a reader needs in five seconds. |
| `Cosa chiede l'item` | quoted, tagged **S**, and it names where a discussion overrode the description |
| `Com'è il codice oggi` | every line has a `file:line`, or it is not a **D** and does not belong here |
| `Modifiche, per punto` | one row per place, and each row's "why" points at an S or a D — never at a feeling |
| `Fuori perimetro` | never empty. An empty exclusion list means the boundary was never drawn. |
| `Assunzioni` | only implementation-level ones survive here; anything observable is a question |
| `Domande da chiudere prima` | at most three, closed, each with a recommendation, blocking ones first |
| `Prossimo passo` | exactly one next step, named |

The section headings are part of the artefact, so they are Italian and fixed: do not re-title them
per item, and do not translate them back to English.

Two things the plan never contains: an estimate in hours, and code. An estimate belongs to whoever
commits to the sprint, and code belongs after the verdict.

## Worked example

```markdown
# 4711 Esportazione elenco fatture in CSV — piano di attacco

**Verdetto:** implementable
**Tipo / stato / iterazione:** Product Backlog Item · New · Sprint 42
**Padre:** 4690 Gestione fatture

## Cosa chiede l'item
- [S] "Chi consulta l'elenco fatture può scaricare le stesse righe in un file CSV."
- [S] "L'esportazione rispetta i filtri applicati a video in quel momento."
- [S] "Il nome del file contiene la data di esportazione."
- Discussione, al terzo commento: il separatore deve essere il punto e virgola, perché
  l'amministrazione apre il file con la virgola come separatore decimale. Non è nella descrizione.

## Com'è il codice oggi
- [D] L'elenco è servito da `InvoiceQueryHandler.Handle` in
  `src/Api/Invoices/InvoiceQueryHandler.cs:34`, che già riceve l'oggetto filtro della schermata.
- [D] La paginazione è applicata nello stesso metodo a `:58` — l'export deve scavalcarla, non riusarla.
- [D] `src/Web/src/pages/Invoices/InvoiceList.tsx:120` tiene lo stato dei filtri che serve all'export.
- [D] Nessuno scrittore CSV esiste nella solution; cercato in `src/Api` e `src/Shared`.

## Modifiche, per punto
| # | Dove | Modifica | Perché |
| - | --- | --- | --- |
| 1 | `src/Api/Invoices/` | endpoint di export che riceve lo stesso oggetto filtro, senza paginazione, in streaming | [S] stesse righe, stessi filtri |
| 2 | `src/Api/Invoices/` | scrittore CSV: separatore punto e virgola, formati numerici e data invarianti | decisione in discussione |
| 3 | `src/Web/src/pages/Invoices/InvoiceList.tsx` | azione di download che passa lo stato dei filtri corrente | [D] lo stato dei filtri sta qui |
| 4 | test | equivalenza dei filtri con l'endpoint di elenco, separatore, risultato vuoto | i criteri qui sopra |

## Fuori perimetro
- Output Excel (`.xlsx`) — l'item parla di CSV; l'xlsx non è in carico a nessuno.
- Export pianificati o inviati per e-mail — li menziona il padre, non questo item.
- Modifiche alla paginazione dell'endpoint di elenco — il punto 1 aggiunge un percorso, non altera
  quello esistente.

## Assunzioni
- [A] L'export lavora in streaming invece di bufferizzare, perché il filtro può selezionare l'intera
  tabella. Solo implementativa e reversibile.

## Domande da chiudere prima
1. [non-blocking] L'export include anche le colonne nascoste a video, o solo quelle visibili?
   Proposta: solo quelle visibili, coerente con "le stesse righe che si vedono a video".
   Conseguenza: cambia la proiezione, non la forma del lavoro.

## Prossimo passo
`dotnet-backend` per i punti 1 e 2, `react` per il 3, `dotnet-testing` per il 4, poi `done-check`.
```

Note what the example does: it quotes, it cites lines, it says out loud that the discussion beat the
description, it excludes three things a reader would have assumed, and it asks one question rather
than five. That is the standard — and it fits on a page. Note also what it does *not* translate: the
verdict keyword, the tags, the paths and the state name.
