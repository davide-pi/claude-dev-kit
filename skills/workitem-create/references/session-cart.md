# Session mode — a client meeting becomes items, one point at a time, through a cart

The mode for "what came out of the meeting goes on the board": many points, drafted one at a time,
collected in a **cart**, recapped, then created in bulk. The gates of the default mode still apply;
this page replaces gates 1-3 with a per-point loop under a fixed **focus**.

**Language.** Everything the user reads — the per-point questions, the cart recap and creation
report with their headers, every confirmation — is **Italian**; item content too
(`user-story-standard`). The **Done when** gates below address the model and stay English.

## Hierarchy — in roles

Top grouping (the engagement) → **feature** → backlog-level items (backlog item, defect, technical
activity, analysis — all at the same level) → unit of time. A backlog-level item is **never** a
direct child of the top grouping. Every role resolves to a real type through `azdo-cli`; a role the
project has no type for is a question.

## The session

| # | Step | Done when |
| --- | --- | --- |
| 0 | Which project today? Org and project from the working directory (user mapping); unmapped → ask | the user confirmed a project |
| 1 | Which top grouping item? List the non-Done items of that type (id, title); always offer "create a new one" (title only) | a grouping id, existing or just created |
| 2 | Which feature? List its non-Done feature children; always offer "create a new one". On a small project a generic container feature is fine | a feature id under the step-1 item — that pair is the session **focus** |
| 3 | One point at a time (below), in the order the user raises them | the point is in the cart, every field **confirmed**, not merely proposed |
| 4 | Recap the whole cart (below); ask "continue on the same grouping or close?" now, execute at step 6 | the cart confirmed; every entry has an unambiguous assignee and parent |
| 5 | Create in bulk (below) | every entry has a real id under the focus feature; every image attached or reported failed |
| 6 | Close, or go back to step 2 on the same grouping with an **empty** cart | session closed, or step 2 restarted with an empty cart |

Never ask for the whole meeting in one block. Open with **"Specifica l'item e spiegami cosa dobbiamo
implementare."**, and after each point ask **"Ci sono altri punti da approfondire?"**.

```powershell
# Steps 1-2. $topType / $featType are the types azdo-cli resolved for the roles — never literals.
# Name the project INSIDE the WIQL too: --project alone does not scope az boards query.
az boards query --org $org --project $prj -o table --wiql @"
SELECT [System.Id],[System.Title],[System.State] FROM WorkItems
WHERE [System.TeamProject]='$prj' AND [System.WorkItemType]='$topType' AND [System.State] <> 'Done'
"@
```

## Step 3 — one point

| Field | How |
| --- | --- |
| role | one of `user-story-standard`'s four; a defect gets three separate questions — how to reproduce, what happens, what should happen — none mandatory, each into the type's own field, never `Description` |
| title and content | per `user-story-standard`; technical activity and analysis carry a technical description, no criteria. Check the type's real field set first: an unsupported field fails the create |
| assignee | **inferred**: the most frequent assignee among the items under the focus feature; tie or none → the user. Say which: "proposto per frequenza sotto la feature" or "default: tu". Always resolved against the organization (`azdo-cli`) |
| images | pasting is context, not consent: ask **"Alleghiamo anche l'immagine al work item?"**. Yes → keep a real file path (save a pasted image to a temp file). Nothing is uploaded now |

Confirm with **"Confermi titolo, contenuto e assegnatario così come sono?"**, then add the entry:
role, resolved type, title, content, assignee, parent (the focus feature), image paths or "no".

## Step 4 — recap

```markdown
| # | Tipo | Titolo | Padre | Assegnatario | Immagini |
|---|------|--------|-------|--------------|----------|
| 1 | <tipo risolto> | <titolo> | #<featureId> — <titolo> | <upn> | 2 (nomi file) |
```

Assignee and parent are the two fields that may not stay ambiguous: a wrong assignee is invisible on
the board, a wrong parent breaks the hierarchy.

## Step 5 — create

Per entry, in order: create with type, title and content fields → link as child of the focus
feature → assignee in the same call → images (a defect's image goes **inline in the field it
illustrates**, mechanics in `azdo-cli`). Then read every item back.

- A failed attachment never blocks the cart: report it and carry on.
- A failed create: stop, report the ids already created, so a retry does not duplicate.

The Italian report adds `Id` after `Tipo` and per-entry image status (`2/2 ok`, `1/2 — <file> KO: <errore>`).

## Traps

1. Items land on the previous client's board → the CLI default project was used → `--org` and
   `--project` on every call, and the project inside the WIQL.
2. A backlog-level item hangs off the top grouping → the focus was lost → always the focus feature.
3. The next round re-creates the last round's items → the cart survived the loop → empty it.
4. Hours logged at closing time → hours are `/worklog`'s only; closing a session writes none.
5. An assignee appears from nowhere → the proposal was not labelled → say inference or default.
