# Step 3 — digging into one point

Open the step with one question: **"Specifica l'item e spiegami cosa dobbiamo implementare."** Then
repeat this whole step once per point the user raises, in the order they raise them. Never ask for a
summary of the entire meeting: one point at a time is how the user thinks, and a point half
understood produces an item nobody can implement.

Images pasted in chat are first of all context for understanding the point. Whether they also end up
on the work item is a separate, explicit question — section 3 below.

## 1. Propose title and content, by type

The item content is **Italian**, and its shape belongs to `user-story-standard`: title, description
and acceptance criteria all follow that standard, for a Product Backlog Item, a Bug, a Tech and an
Impediment alike. Do not restate the format here and do not invent a house variant. If that standard
also produces an import artefact, it is not used here — items are created straight on the board at
step 5.

| Type | What to gather before proposing | Where it lands |
| --- | --- | --- |
| `Product Backlog Item` | the user need behind the point, plus what "done" means for it | description and acceptance criteria per `user-story-standard` |
| `Bug` | three things, asked **explicitly and separately**, none of them mandatory — skip any the user cannot answer: how the bug is reproduced, what happens now, what should happen instead | the type's own fields, **never** `Description`, which a Bug does not have on its form — mapping in `azdo-cli` |
| `Tech` | the technical work and why it is needed | free technical description, no acceptance criteria |
| `Impediment` | what is blocked, and by what | free technical description, no acceptance criteria |

An unsupported field fails the whole create: check the type's real field set through `azdo-cli`
before promising anything, and fold what does not fit into the description.

## 2. Propose an assignee

Inferred, not guessed: read who is already assigned to the items under the **focus Feature** (the
query is in the skill's `Do`), count the identities, propose the most frequent one. Two identities
tied, or a Feature with no assigned items yet → **ask the user** directly. Never fall back to the
currently logged-in identity as a silent default.

## 3. Ask about the images, explicitly

If the point came with images, ask: **"Alleghiamo anche l'immagine al work item?"** — one question
per point, not a blanket rule for the session.

- **No** → record the refusal in the cart entry, so step 4 does not ask again.
- **Yes** → resolve each image to a real file on disk and keep its path. An image that only exists
  pasted in chat has no path: ask the user where the file is, or save it yourself to a temporary file
  and use that path.

Nothing is uploaded now. Step 3 records intent plus paths; the upload happens at step 5.

## 4. Confirm, then add to the cart

Have the user confirm title and content, assignee, and the image decision — asked in Italian, one
short request, for instance **"Confermi titolo, contenuto e assegnatario così come sono?"**. Only
then add the entry to the **cart** — the list of drafts, not yet written to the board. The cart
entry's own field names below are internal bookkeeping and stay as they are; what reaches the user
is the Italian recap table of step 4. A cart entry holds:

| Field | Value |
| --- | --- |
| type | one of the four backlog item types, exactly as the project's process names it |
| title | as confirmed |
| content | per type, in the fields that type actually has |
| assignee | a real identity, confirmed |
| parent | the focus Feature |
| images | the confirmed file paths, or an explicit "no" |

**Done when:** the entry is in the cart with type, title, content, assignee and the image decision
all confirmed by the user — proposed is not confirmed.

Then ask, in Italian, whether there are more points to dig into — **"Ci sono altri punti da
approfondire?"** — and repeat until the user says there are none.

## Traps

1. The item is created as soon as the point is clear → the cart was skipped → nothing reaches the
   board before step 5; the cart is what makes the step-4 recap possible.
2. A Bug lands with empty content → the answers went into `Description` → each answer goes into its
   own field, and only the ones actually given.
3. An assignee appears out of nowhere → the inference found nothing and a default was assumed → an
   empty inference is a question for the user.
4. Images are attached without asking → the user pasted them, which looked like consent → pasting is
   context; attaching is a separate yes.
5. Acceptance criteria are written for a Tech or an Impediment → the PBI shape was applied to every
   type → those two carry a technical description only.
