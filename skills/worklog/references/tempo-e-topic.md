# Periodo, tempo, topic e arrotondamento

## Fase 1 — il periodo

L'argomento del trigger e' in linguaggio naturale e va risolto in due date concrete
(`yyyy-MM-dd`) prima di lanciare l'engine:

| Argomento | `From` / `To` |
| --- | --- |
| vuoto | oggi / oggi |
| `ieri`, `yesterday` | il giorno prima |
| `yyyy-MM-dd` | quel giorno |
| `yyyy-MM-dd..yyyy-MM-dd` | i due estremi |
| "questa settimana", "settimana scorsa", "ultimi N giorni", "10-15 lug" | calcola gli estremi dalla data corrente |

Se resta ambiguo (es. "la settimana" senza sapere quale) **chiedi** prima di procedere: un periodo
sbagliato porta ore sul work item sbagliato.

## Fase 2 — l'engine

```powershell
pwsh -NoProfile -File "$HOME\.claude\skills\worklog\worklog.ps1" -From "<yyyy-MM-dd>" -To "<yyyy-MM-dd>"
```

Cosa fa, esattamente:

- legge le sessioni **principali** dei transcript di Claude Code (esclude subagent e sidechain);
- filtra gli eventi nel range e li attribuisce a `(progetto, branch)` su una timeline globale;
- **tempo attivo** = somma degli intervalli fra eventi consecutivi entro la soglia di inattivita'
  (default 15 minuti). Gli intervalli piu' lunghi — incluse le notti fra i giorni di un range — sono
  pause e non contano;
- stampa a stdout le metriche autorevoli: per progetto e per branch, minuti attivi, fascia oraria e
  numero di prompt;
- scrive il **digest grezzo** in `_raw/<periodo>.md` sotto la cartella di lavoro della skill e ne
  stampa il path, insieme al path dell'**audit** (`pushed.json`);
- fa la **retention** al lancio: pota digest e voci di audit piu' vecchi della finestra di
  ritenzione (default 7 giorni). Non c'e' nessuno scheduler: la pulizia avviene solo qui.

Parametri opzionali oltre a `-From`/`-To`: radice dei progetti, cartella di output, soglia di
inattivita', giorni di ritenzione e i limiti di troncamento del digest. Non toccarli senza motivo.

L'engine **non** scrive tabelle e **non** tocca Azure DevOps: quello e' compito della skill.

Se stampa "Nessuna attivita'", riferiscilo e fermati. Altrimenti **leggi il digest**: per progetto →
branch → cronologia dei prompt e delle risposte. E' il materiale da cui nascono topic, descrizioni e
decisioni. I transcript originali si aprono solo se manca un dettaglio.

## Fase 3 — topic e ruoli

**Il topic viene dal branch git.** Un `feature/*`, `fix/*` o `bugfix/*` e' un topic: dagli un nome
umano. Il lavoro su `master`, `HEAD` o senza branch non ha un topic dal branch → **spezzalo in uno o
piu' topic semantici** leggendo il digest, e ripartisci i suoi minuti a stima ragionevole,
**dicendolo esplicitamente** in chat. Di norma i topic restano per progetto; ne attraversano due
solo se e' chiaramente lo stesso lavoro.

A ogni topic si assegna un **ruolo**, che decide come si comporta nell'arrotondamento:

| Ruolo | Quando | Effetto |
| --- | --- | --- |
| `main` | topic vero, tempo >= ~15 min | riceve la redistribuzione dei donor, arrotonda normale |
| `donor` | micro-topic (< ~15 min) di lavoro cliente **senza** item dedicato | i suoi minuti vanno in un pool spalmato **equamente** sui `main`; il topic sparisce dalla tabella |
| `keep` | micro-topic **con** un item dedicato, o comunque da preservare | resta come riga e va a **minimo 0.5h**, cosi' si logga |
| `internal` | tempo interno / non fatturabile (es. lavoro sul tooling) | resta riga a se', arrotonda normale (puo' fare 0h), **non** riceve il pool e **non** viene spalmato |

La certezza sull'item arriva in Fase 5: qui si classifica a giudizio e si ri-verifica in discovery.
Un `internal` diventa `donor` solo se l'utente lo chiede esplicitamente.

## Arrotondamento

```powershell
pwsh -NoProfile -File "$HOME\.claude\skills\worklog\round.ps1" `
  "80|import new markets|main" "4|seed fix|donor" "7|proc fix|keep" "8|worklog tooling|internal"
```

- Formato voce: `minuti|etichetta|ruolo`; il ruolo e' opzionale e vale `main` per default.
- **nearest-0.5h indipendente per topic**, **nessun cap**: il totale e' la somma reale dei
  risultati, non un numero forzato. 45 minuti fanno 1.0h (equidistante → away-from-zero, non floor);
  sotto ~15 minuti si arrotonda a **0h**.
- L'helper spalma i `donor`, porta i `keep` a 0.5h, lascia gli `internal` a se', e stampa due totali:
  tutte le righe e la quota **loggabile** (esclusi 0h e interni).
- Passa **tutti** i topic in **una sola** invocazione: la redistribuzione dipende da quanti `main`
  ci sono, quindi invocazioni separate danno numeri diversi e sbagliati.
- Se ci sono `donor` ma nessun `main`, l'helper avvisa e li tratta come `keep`.
- Se i minuti cambiano nel loop della Tabella 1, **ri-arrotonda**: non correggere le ore a mano.
