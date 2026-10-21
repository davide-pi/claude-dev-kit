# Deduction — phase 5

The estimate is reasoned, not computed by a formula: the request on one side, the team's recent
work on the other. What keeps it honest is that **every number points at hours someone actually
logged**, and that the approximation is built from named sources.

## 1. Calibrate on the recent work

Before touching the request, read the whole index and write down — for yourself, it goes in the
report's detail block:

| Question | From |
| --- | --- |
| What does a typical item of this team cost? | header median and P25-P75 |
| Which kinds of work recur, and what does each cost? (an endpoint, a screen, a table, an import, a fix) | titles and Task titles grouped by shape |
| How does the person compare with the team? | person median vs team median, when a person is named |
| How much is actuals, how much estimates? | the `cons.` shares |

This gives a **rate card** in the team's own hours — e.g. "endpoint di lettura con filtri: 5-8h",
"nuova schermata CRUD: 14-20h" — each line backed by the items it came from.

## 2. Decompose and size

1. Split the request into components the size of one backlog item (one screen, one endpoint, one
   import, one integration).
2. For each component, find the recent work it resembles **in structure** — steps, layers, screens,
   tables touched — and size it against that work:

| Relation | Example | Hours |
| --- | --- | --- |
| Same shape | another read endpoint with filters | the reference's hours, or the rate-card line |
| Scaled | "una tabella con migrazione ≈ 2 endpoint semplici" | reference × ratio, the ratio stated with its reason |
| Composed | "import = parser + validazione + scrittura, come `AB#…` più `AB#…`" | the sum of the parts' references |
| Nothing comparable | a technology never used by the team | **stima a giudizio**: reasoned from the request and the code check, flagged |

3. Prefer recent references over old ones, actuals over estimates, the codebase's own work over
   anything else. Never an outlier.
4. Add what the references do not contain and the request needs (a deploy no reference shows, an
   integration nobody has done): as its own row, never folded silently into another.
5. Cross-check top-down when the request is a feature or a project: the completed Features of similar
   scope in the index. More than 30% apart from the sum → say which is larger and why.

## 3. Personal or team basis

| Situation | Basis |
| --- | --- |
| No person named | team references; the total **+5%** |
| Person named, 5 or more items of theirs in the window | their items as references first; team items only for shapes they never did — say which rows |
| Person named, fewer than 5 items | team references, **+5%**, and the report says why |

## 4. Building the approximation

The margin is the sum of named shares, rounded to the nearest 5%, then capped by the level:

| Source | Share |
| --- | --- |
| Requirements level | sufficiente **+10%** · scarso **+25%** |
| Reference quality | same-shape references +0% · scaled or composed +5% · any **stima a giudizio** row +10% |
| Spread of the evidence | the references of the main components agree +0% · they disagree by more than half +5-10% |
| Thin history | fewer than 10 items in the window, or the person basis fell back to the team +5% |

Cap: sufficiente **+20%**, scarso **+40%**. A sum above the cap → declare the cap and add the line
`Approssimazione reale stimata +<x>%, oltre il tetto del livello`. The report lists the shares that
made the margin, one line each.

`prudent = central × (1 + margin)`; hours to the half hour; days = hours / hours-per-day, to the
half day. Compute every sum and division with a PowerShell one-liner, e.g.
`[math]::Round((18+8+24) * 1.2 * 2) / 2`.

## 5. What not to do

| Temptation | Why not |
| --- | --- |
| A number with no reference | it is an opinion; the report would have nothing to show the PO |
| The average of the whole index as the estimate | the request is not an average item; decompose |
| Shrinking the margin to look precise | the margin is the honest part of the estimate |
| Reading an outlier as "the closest match" | it was cut because its hours do not represent the work |
