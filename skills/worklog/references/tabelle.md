# Le due tabelle e il recap

Due gate, ciascuno con lo stesso protocollo: stampa la tabella, chiedi modifiche, applica,
**ristampa**, richiedi conferma. Si passa alla fase successiva **solo** su conferma esplicita.
Chat e tabelle in italiano; le descrizioni brevi in inglese, perche' alimentano titolo e descrizione
degli item.

## Tabella 1 — riepilogo attivita'

Stampa in chat **solo** questa tabella. La cronologia passo-passo vive nel digest e si riporta solo
se richiesta.

```markdown
| # | Topic | Very small description | Time | From | To | Rounded Time |
|---|-------|------------------------|------|------|----|--------------|
| 1 | import new markets | Import & mapping of new betting markets | 1h20m | 09:08 | 10:16 | 1.5h |
| 2 | translations cache | Translations cache invalidation fix | 25m | 11:40 | 12:05 | 0.5h |
| 3 | worklog tooling | Worklog engine retention fix | 8m | 15:02 | 15:10 | 0h *(non loggato, interno)* |
| | **Totale** | | **<somma misurata>** | | | **<somma arrotondata>** |
```

- `#` numera le righe, cosi' l'utente puo' dire "cambia l'item 2".
- `Very small description`: breve e **in inglese**.
- `Time` = misurato dall'engine; `From`/`To` = fascia oraria (aggiungi la data se il range copre
  piu' giorni); `Rounded Time` = quello che ha stampato l'helper.
- Segna con una nota le righe a **0h (non loggato)** e quelle **interne**.
- I `donor` non compaiono: sono stati spalmati. Se ne esistevano, dillo in una riga sotto la tabella.

Poi **chiedi**: "Vuoi modificare qualcosa (topic, descrizioni, tempi, accorpare/dividere righe)?"
Se l'utente modifica → applica, **ri-arrotonda** se cambiano i minuti, ristampa, richiedi conferma.
Si ripete finche' non conferma.

## Tabella 2 — dove vanno le ore

```markdown
| # | Topic | Very small description | Rounded Time | Progetto | Item |
|---|-------|------------------------|--------------|----------|------|
| 1 | import new markets | Import & mapping of new markets | 1.5h | <Project> | [Task #105060 — Import & mapping of new betting markets](https://<org-host>/<project>/_workitems/edit/105060) (esistente, +1.5h) |
| 2 | translations cache | Translations cache invalidation fix | 0.5h | <Project> | parent [US #105025 — Localization pipeline](https://<org-host>/<project>/_workitems/edit/105025) → **Task DA CREARE** ("Translations cache invalidation fix") |
```

- `Progetto`: il progetto Azure DevOps realmente risolto, cosi' l'utente sa dove finiscono le ore.
  Sotto la tabella dichiara anche l'**interfaccia** usata: CLI, oppure fallback MCP e perche'.
- `Item`:
  - Task esistente → `[Task #<id> — <titolo>](<link>) (esistente, +<delta>h)`; se l'audit dice che
    per quel periodo era gia' stato scritto qualcosa, indica `gia' scritto <X>h → delta <±Y>h`;
  - Task da creare → `parent [US #<id> — <titolo>](<link>) → **Task DA CREARE** ("<titolo previsto>")`.
- **Sempre link cliccabile con il titolo, mai il solo numero** — vale per il parent, per il Task
  esistente e nel recap finale. Il testo del link e' `<Tipo> #<id> — <titolo>`; il titolo viene dal
  campo titolo del work item letto a runtime. L'URL si costruisce dal link HTML restituito dalla
  chiamata, oppure dal pattern `_workitems/edit/<id>` con host org e progetto **scoperti a runtime**.
- Sotto la tabella elenca, riga per riga, le **PR** e i **commit** che verranno linkati (o "nessuno").
- Ometti le righe a 0h, ma ricordale in una nota: servono a far tornare i conti col totale misurato.

Poi **chiedi** le modifiche: item diverso, progetto diverso, creare o non creare il Task, ore, PR e
commit. Se qualcosa cambia → rifai la parte di discovery interessata, ristampa la Tabella 2,
richiedi conferma. Solo alla conferma esplicita si scrive.

## Recap finale

Dopo la scrittura e **dopo** la verifica diretta sugli item, stampa il recap: per riga, item toccato,
ore prima e dopo, se e' stato creato, parent, stato finale, PR e commit linkati. Ogni item e ogni
parent citati sono **link cliccabili con il titolo**, mai il solo numero.

Chiudi con una riga sola: quante ore sono state registrate in totale, su quale progetto, e cosa
**non** e' stato fatto — una riga a 0h non loggata, un link fallito, un campo non scritto.

## Traps

1. Si stampa la cronologia oltre alla tabella → il messaggio diventa illeggibile → la cronologia
   vive nel digest.
2. Il totale arrotondato non torna con la somma delle righe → una riga e' stata corretta a mano →
   i numeri arrotondati vengono solo dall'helper.
3. Item indicato come `#105060` → l'utente non puo' controllarlo senza cercarlo → link con titolo.
4. "Ok procedi" sulla Tabella 1 preso come conferma anche della 2 → si e' passato un gate solo →
   ogni tabella ha la sua conferma.
5. Il recap ripete la Tabella 2 invece dell'esito reale → si e' creduto al piano, non alla board →
   il recap descrive cosa e' stato scritto e verificato.
