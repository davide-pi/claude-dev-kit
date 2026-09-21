# Acceptance criteria — coverage, structure, format

Criteria apply to a **User Story** and to a **Bug** only. Never generate them for an Impediment or a
TECH. Generate them **only after asking** and receiving confirmation — never in the same pass as the
story, because a story that turns out to contain three stories takes its criteria down with it.

Section title: exactly `Criteri di accettazione`. Language: Italian. Style: discursive and clear,
ready to paste into Azure DevOps with no rework.

## The four coverage families — a mental grid, never printed

The criteria are the item's test specification: a case nobody wrote is a case nobody will test. Run
the request against these four families, as far as each is pertinent to this item, and **do not list
the families in the output**.

| # | Family | What it covers |
| --- | --- | --- |
| 1 | Caso previsto (happy path) | the nominal, agreed behaviour |
| 2 | Casi negativi / errore | what happens when a precondition fails: missing or invalid input, unauthorised user, absent data |
| 3 | Boundary / limite | extreme values and situations: empty list, long text that wraps, minimum and maximum values, zero or very many elements |
| 4 | Cross-cutting (trasversali) | the device matrix (per the project platform datum); interface states (disabled, empty, error, hover/focus); conformance to the reference mock; no regression in the neighbouring areas |

On family 4, conformance to the mock: cite the frame, and use **explicit, testable attributes** —
colour, shape, casing, spacing, alignment, element order. Never a vague quantifier such as "il più X
possibile".

Families **2 to 4 are the ones that most often stay uncovered and come back as bugs during test**.
Keep them in mind even when the initial request only describes the happy path.

## Signalling an uncovered family — first proposal only

On the **first** criteria proposal for an item:

- Every pertinent family covered → add nothing, just proceed.
- A pertinent family left with no criterion at all (or genuine doubt whether it is pertinent) → add
  **one single note line in the chat message**, outside the `Criteri di accettazione` block that
  gets pasted. For example: *"Non ho previsto AC per i casi limite / per il comportamento mobile — è
  voluto o li integriamo?"*

**Respect the reviewer's choices.** If the PM or reviewer then removes, or does not confirm, the
criteria of a family — the boundary cases, a platform reference — that is an explicit and final
decision: take it and nothing more. Do not re-flag it and do not re-insert that family in later
passes. The signalling is one-shot, on the initial proposal.

## Structure

| Situation | Structure |
| --- | --- |
| The criteria describe **distinct cases** | group them by scenario: `Scenario 1 – [titolo]`, `Scenario 2 – [titolo]` |
| No distinct scenarios needed | number the criteria `AC01`, `AC02`, `AC03`, … |
| Never | plain bullet points, or a classic `1.` `2.` numbered list |

### Per-platform criteria, inside the same item

For a **User Story** — the role a Product Backlog Item fills, whatever a given project's process
calls it — when the product has both a desktop and a mobile version **and the
required behaviour differs between them**, do not write generic criteria that hold "in theory" for
both: differentiate them explicitly **inside the same work item**. Never create separate items per
platform.

Not applicable to a Bug, which describes a malfunction already observed on a specific platform. And
never assume desktop and mobile behave identically: that assumption is the most common source of
criteria that look fine and turn out ambiguous in test.

Put the platform in brackets right after the label:

```
AC01 (Desktop)
AC02 (Mobile)
```

or, with scenarios:

```
Scenario 1 – [titolo] (Desktop)
Scenario 2 – [titolo] (Mobile)
```

A criterion with no platform label is understood to hold for both. When desktop and mobile share
some criteria and have others of their own, mix labelled and unlabelled criteria freely in the same
list.

## The format of each criterion

Discursive Italian, in this structure:

```
Dato che ...
Quando ...
E ...
Allora ...
E ...
```

The `E ...` lines are optional: they add a condition or an outcome where one is needed.

## Format rules (these matter)

- **Do not** use "Given / When / Then" — the Italian form `Dato che / Quando / Allora` is the
  standard.
- **Do not** use standard bullet points for the individual criteria.
- **Do not** use a classic numbered list (`1.`, `2.`) — use the `AC01`, `AC02` labels or
  `Scenario N`.
- **Do not** add any explanation before or after the section: the `Criteri di accettazione` block to
  paste stays clean. The single exception is the one note line from *Signalling an uncovered
  family*, which goes **in the chat message, outside the block**.
- **Do not** do automatic refinement.

## Level of detail

Precise enough to develop against, with no redundancy and no duplication. For simple cases the ideal
number is **3 to 5 criteria**.

### Example, without scenarios

```
Criteri di accettazione

AC01
Dato che l'utente si trova nella pagina del report mensile
Quando seleziona il pulsante "Esporta PDF"
Allora il sistema genera un file PDF con i dati del mese visualizzato

AC02
Dato che il report contiene almeno una riga
Quando viene generato il PDF
Allora il PDF riporta intestazione, righe e totale mensile identici a quelli a video

AC03
Dato che non è presente alcun dato per il mese selezionato
Quando l'utente seleziona "Esporta PDF"
Allora il sistema mostra un messaggio che segnala l'assenza di dati e non genera il file
```

### Example, with desktop and mobile differentiated

```
Criteri di accettazione

AC01
Dato che l'utente si trova nella pagina del report mensile
Quando seleziona il pulsante "Esporta PDF"
Allora il sistema genera un file PDF con i dati del mese visualizzato

AC02 (Desktop)
Dato che il report è aperto da browser desktop
Quando l'utente seleziona "Esporta PDF"
Allora il file PDF viene scaricato nella cartella download del browser e mostrato in una nuova
scheda

AC03 (Mobile)
Dato che il report è aperto dall'app mobile
Quando l'utente seleziona "Esporta PDF"
Allora il file PDF viene salvato nello storage del dispositivo e viene proposta la condivisione
tramite le app disponibili
```
