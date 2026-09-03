# Steps 4 to 6 — recap the cart, create in bulk, then loop or close

This page is guidance, so it is English. Both tables below are shown to the user, so they are
**Italian, headers included**; only the work item type names — as the project spells them — the ids
and the identities keep their own form. The **Done when** gates stay English: they address the
model, not the user.

## Step 4 — recap and refine

Print the **whole** cart, one row per draft, before anything is written:

```markdown
| # | Tipo | Titolo | Padre | Assegnatario | Immagini |
|---|------|--------|-------|--------------|----------|
| 1 | <tipo risolto> | <titolo> | #<featureId> — <titolo> | <identity> | 2 (nomi file) |
| 2 | <tipo risolto> | <titolo> | #<featureId> — <titolo> | <identity> | no |
```

`Tipo` prints the work item type this project resolved for that entry's role (`azdo-cli`) — never a
name remembered from another client; `Padre` is always the focus feature. Then ask targeted refinement questions on whatever is still
soft. **Assignee and parent feature are the two fields that may not stay ambiguous**: resolve every
doubt on those two before going further, because a wrong assignee is invisible on the board and a
wrong parent breaks the hierarchy.

Ask the user, **before creating anything**, whether after this round they want to keep working on the
same grouping item or close the session — in Italian, naming the resolved type, for instance
**"Dopo questo giro continuiamo sullo stesso <tipo> o chiudiamo la sessione?"**. The answer is executed at step 6, not now. Either way step 5
runs with the cart as it stands.

**Done when:** the user has confirmed the cart, chosen continue or close, and every entry has an
unambiguous assignee and parent feature.

## Step 5 — create in bulk

Per cart entry, in order, all of it in one pass — the verbs and flags are in `azdo-cli`:

1. **Create the work item** with its type, title and content fields.
2. **Link it as a child** of the focus feature.
3. **Set the assignee.**
4. **Attachments**, only if the entry has images: upload each file, then attach it to the item just
   created. For a defect, the image belongs **inline in the field it illustrates** rather than
   sitting in the attachments tab where nobody looks — the field mapping and both mechanics are in
   `azdo-cli`.

**A failed attachment never blocks the cart.** Report which image failed on which item and carry on
with the remaining entries. The same holds for a failed create: report the ids already created
before stopping, so a retry does not duplicate them.

Report the **real id** of every item created, and per image whether the attachment succeeded. The
report is Italian, and so is any failure line inside it:

```markdown
| # | Tipo | Id | Titolo | Padre | Assegnatario | Immagini |
|---|------|----|--------|-------|--------------|----------|
| 1 | <tipo risolto> | #<id> | <titolo> | #<featureId> | <identity> | 2/2 ok |
| 2 | <tipo risolto> | #<id> | <titolo> | #<featureId> | <identity> | 1/2 — <file> KO: <errore> |
```

**Done when:** every cart entry has a real id on the board with the focus feature as its parent, and
every planned image is either attached or reported as failed.

## Step 6 — continue or close

Execute the choice made at step 4:

- **Close** → the session ends here. Hours are not part of it: management time for this engagement
  goes through `/worklog`, which owns that structure and is the only asset that writes hours. Say so
  in one line and stop.
- **Continue** → confirm the session stays on the **same grouping item** (step 1). Then go back to
  **step 2**: the user keeps the same feature or picks or creates another under that grouping item.
  With the new focus defined, restart **step 3** with an **empty cart**.

**Done when:** the session is closed, or step 2 has restarted with an empty cart.

## Traps

1. The recap is skipped because the cart looks obvious → the ambiguity was in the assignee, not the
   title → print the table anyway; it costs one message.
2. A retry duplicates items → a mid-run failure reported no ids → report the created ids before
   stopping, always.
3. An item ends up unassigned → the assignee was set in a second pass that failed → treat create,
   link and assignee as one unit per entry, and verify by reading the item back.
4. Images end up in a defect's attachments tab → the generic attach path was used → inline them in
   the field they illustrate instead.
5. The next round re-creates the previous round's items → the cart survived the loop → step 6 empties
   it before step 3 runs again.
6. Hours get logged here at closing time → the source flow used to do it → hours are `/worklog`'s
   only, or the session is counted twice.
