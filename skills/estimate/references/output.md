# The report — phase 6

Italian throughout; `AB#<id>`, type and field names and script output verbatim. The bold summary
sentence comes first, the tables after, depth last.

## 1. Shape

```markdown
**Stima: 50h – 60h (+20%) · 6,5 – 7,5 giorni (8h/giorno) · requisiti sufficienti · base personale (<persona>)**

| Componente | Stima | Giorni | Riferimenti | Relazione |
|---|---|---|---|---|
| API estrazione ordini | 18h – 21,5h | 2,5 – 2,5 | `AB#101234` (16h), `AB#101310` (20h) | stessa forma |
| Tabella storico + migrazione | 8h – 9,5h | 1 – 1 | `AB#101500` (4h) | ≈ 2 × endpoint semplice |
| Export verso SAP | 24h – 29h | 3 – 3,5 | — | **stima a giudizio**: integrazione mai fatta dal team |
| **Totale** | **50h – 60h** | **6,5 – 7,5** | | |

**Approssimazione +20%:** requisiti sufficienti +10% · una componente a giudizio +10%.
**Compreso:** sviluppo, test, code review — presenti nei Task dei riferimenti.
**NON compreso:** deploy in produzione (`non rilevato`), analisi funzionale, riunioni col cliente.

> **Dettaglio**
> - Storico: 14 item in 3 mesi · esclusi (`estimation-excluded`): 1 · outlier: 2 · mediana team 9h (P25-P75 5-16h)
> - Listino del team: endpoint di lettura 5-8h · schermata CRUD 14-20h · …
> - Codice esistente: <cosa ha trovato il controllo | nessun repository>
> - Assunzioni tecniche: <una per riga>
> - Top-down sulle Feature: 55h — in linea
```

Per component, a column per day count only when there is more than one component; the total in
days is always there.

## 2. The summary sentence

| Level | Sentence |
| --- | --- |
| Sufficiente | `**Stima: <c>h – <p>h (+<n>%) · <cg> – <pg> giorni (<h>h/giorno) · requisiti sufficienti · base <personale \| team +5%>**` |
| Scarso | the same with `requisiti scarsi`, then: `Mancano: <punti>.` |
| Insufficiente | `**Stima non possibile: requisiti insufficienti — ordine di grandezza: <settimane>.**` then the questions, no table |

## 3. Compreso / NON compreso — mandatory on every estimate

| Rule | Detail |
| --- | --- |
| Source | the Task titles of the references: an activity they show is **compreso** |
| NON compreso | activities none of the references show — `non rilevato` — and anything the user excluded |
| Added rows | an activity added on purpose (section 2 step 4 of `deduction.md`) is compreso and named |
| Market pass | features found missing and not accepted into scope go under NON compreso |

## 4. Lines that must appear when their condition holds

| Condition | Line |
| --- | --- |
| margin above the cap | `Approssimazione reale stimata +<x>%, oltre il tetto del livello.` |
| person named, team basis used | `<persona>: <n> item nella finestra — base team +5%.` |
| window extended | `Storico esteso a 6 mesi: meno di 10 item negli ultimi 3.` |
| top-down off by more than 30% | `Top-down <x>h contro somma <y>h: <ipotesi sulla differenza>.` |
| MCP fallback used | `<capacità> via MCP: il CLI non la offre.` |
| `calibrate.ps1` has 5 or more closed records | `Calibrazione: <n> stime chiuse, consuntivo/stima mediano <x>, coperte dal prudente <y>%.` |

## 5. The history record — after every estimate with a number

Write `$HOME\.claude\estimate\history\<yyyyMMdd-HHmmss>-<item id or 'text'>.json`; `calibrate.ps1`
reads it once the item is closed.

```json
{ "savedAt": "<ISO UTC>", "sourceItemId": 104512, "org": "<org>", "project": "<project>",
  "level": "sufficient", "person": null, "hoursPerDay": 8,
  "total": { "p50": 50, "prudent": 60, "pct": 0.2 },
  "components": [ { "name": "API estrazione ordini", "p50": 18, "prudent": 21.5 } ] }
```

## 6. The optional comment

Only when the invocation asked for it (`commenta`) and the input was a work item:

1. Show the exact comment text — the summary sentence, the components table, the approximation,
   compreso / NON compreso — and wait for an explicit "ok".
2. Post it with the CLI (`az boards work-item update --org $org --id <id> --discussion "<html>"`),
   prefixed `[Claude AI Review - stima]` (the `pr-review` tag shape with a scope).
3. Read the discussion back (`azdo-cli` `boards-catalogue.md`) and confirm it landed.

Never write a field: no `OriginalEstimate`, no `Effort`, no tag, no state change.
