# CSV bulk import — the secondary path

## The normal path is not this file

In this kit items are created **directly on the board**, through the Azure DevOps CLI, and that flow
belongs to `workitem-create`. So the normal answer is: write the item text in the shapes this skill
defines, then let `workitem-create` put it on the board. No file is produced, nothing is imported.

A CSV exists for one case only: someone genuinely wants a **bulk-import file** — a batch large
enough that clicking or calling per item is not worth it, or a hand-off to someone who will import
it themselves. Never produce a CSV by default, and never as a substitute for direct creation.
**Ask** whether an import file is wanted; produce it only on a yes.

Applies to **User Story** and **Bug** only. For an Impediment or a TECH, no CSV: there is a single
Description field, so the item is created or pasted directly.

## Headers — exactly these

For a Product Backlog Item:

```
Work Item Type,Title,Description,Acceptance criteria
```

For a Bug:

```
Work Item Type,Title,Repro step,Actual result,Expected result
```

The value of `Work Item Type` is `Product Backlog Item` or `Bug`, according to the case. The headers
are machine text: they must match what the Azure DevOps import expects, so they stay English and
stay exactly as written above, even though every value under them is Italian.

## Which part of the body goes into which column

For a Product Backlog Item the two content columns line up with the body one to one: `Description`
takes the `Come … / voglio … / così da …` block, `Acceptance criteria` takes the whole
`Criteri di accettazione` block, clean, exactly as `acceptance-criteria.md` produces it.

For a **Bug** they do not line up, because the mandated body has two parts
(`Comportamento attuale` / `Comportamento atteso`) and the CSV has three content columns. The
mapping is fixed:

| CSV column | What goes in it |
| --- | --- |
| `Work Item Type` | the literal `Bug` |
| `Title` | the Bug title — Italian, problem-oriented, as `item-formats.md` requires |
| `Repro step` | **nothing: the column is emitted and left empty.** See below |
| `Actual result` | the text of `Comportamento attuale`, without its `Comportamento attuale:` label — the column header already says it |
| `Expected result` | the text of `Comportamento atteso`, without its `Comportamento atteso:` label |

`Repro step` is the column with no counterpart in the body. This standard's Bug shape is *only* the
two `Comportamento` parts, and the standard never asks how the bug is reproduced — so the column is
written out empty and **no extra question is invented to fill it**. Two things not to do with it:
do not drop the column (the header row would stop matching), and do not copy
`Comportamento attuale` into it as well — the same sentence in two columns is duplication, and
`Actual result` is the column that owns it. If the user volunteered reproduction steps of their own
accord while describing the bug, they may go here; they are never solicited.

This mapping is written down here because **the source standard defines the Bug body and the CSV
headers in separate places and never connects the two** — it is a deliberate completion of the
standard, not a drift away from it, and the headers themselves are untouched.

## Quoting rules

Quote with double quotes any field containing a comma, a line break or a double quote, doubling the
inner double quotes. Without this the Azure DevOps import breaks — a description holding a
`Comportamento attuale:` sentence with a comma in it is enough to shift every column.

```csv
Work Item Type,Title,Description,Acceptance criteria
Product Backlog Item,Esportazione report mensile in PDF,"Come responsabile amministrativo
voglio esportare il report mensile in formato PDF
così da poterlo archiviare e condividere senza accesso al gestionale","Criteri di accettazione

AC01
Dato che l'utente si trova nella pagina del report mensile
Quando seleziona il pulsante ""Esporta PDF""
Allora il sistema genera un file PDF con i dati del mese visualizzato"
```

And the same file for a Bug, with `Repro step` present and empty:

```csv
Work Item Type,Title,Repro step,Actual result,Expected result
Bug,Il totale mensile non si aggiorna dopo la modifica di una riga,,"modificando le ore di una
giornata già inserita, il totale mensile in fondo alla tabella resta invariato finché non si
ricarica la pagina","il totale mensile deve aggiornarsi automaticamente a ogni modifica di una riga,
senza ricaricare la pagina"
```

## Before handing the file over

| Check | Why |
| --- | --- |
| The type names match the ones the project really has | the import fails on an unknown type; `workitem-create` discovers the real type list, this skill does not |
| A Bug row has five fields, with the third one empty | `Repro step` has no counterpart in the body; the column stays, its value does not |
| Every multi-line or comma-bearing field is quoted | one unquoted field shifts every column after it |
| Inner double quotes are doubled | a single quote closes the field early |
| The criteria block is still clean | no preamble, no trailing note — the chat note stays in the chat |
| The item bodies still follow the shapes | the CSV is a container, not a licence to reshape the content |
