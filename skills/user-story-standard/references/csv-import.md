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

The value of `Work Item Type` is `Product Backlog Item` or `Bug`, according to the case.

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

## Before handing the file over

| Check | Why |
| --- | --- |
| The type names match the ones the project really has | the import fails on an unknown type; `workitem-create` discovers the real type list, this skill does not |
| Every multi-line or comma-bearing field is quoted | one unquoted field shifts every column after it |
| Inner double quotes are doubled | a single quote closes the field early |
| The criteria block is still clean | no preamble, no trailing note — the chat note stays in the chat |
| The item bodies still follow the shapes | the CSV is a container, not a licence to reshape the content |
