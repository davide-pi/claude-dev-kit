---
description: Run the doc-keeper agent on this repo's docs tree — tech docs or wiki — against the working diff, a range or a full audit.
argument-hint: "[scope] [tech|wiki] [--audit]"
disable-model-invocation: true
---

Keep the repository's own documentation true by delegating to the **`doc-keeper`** agent. This
command only resolves the scope and relays the report; the agent owns the method and writes only
inside the docs tree. The wiki's structure belongs to **`project-wiki-standard`**.

## Argument grammar

Parse "$ARGUMENTS"; order does not matter, all parts optional.

- **scope** — *(empty)* → the working diff (`git diff HEAD` plus `git diff --staged`), falling back
  to the last commit and saying so · **`<branch>`** → `git diff origin/<branch>...HEAD` after
  `git fetch origin <branch>` · **`HEAD~<n>`** / **`<sha>..<sha>`** → that range · **paths** → a
  docs area or source area to reconcile.
- **tree** — `tech` (a technical docs folder: `docs/`, `docs/tech*`, `architecture/`, `adr/`) or
  `wiki` (a `wiki/` folder, or the current repo is a cloned project wiki). Absent → whichever
  exists; both exist → ask which.
- **`--audit`** — walk the whole tree (or the given paths) against the source, independent of any
  diff, looking for gaps as well as drift.

## Steps

1. **Find the tree.** List the root and one level down for the usual names. None → say so and stop:
   no tree is created from here.
2. **Resolve the scope** per the grammar and write the diff once to the scratchpad
   (`git diff <range> --output=<scratchpad>/docs.diff`). Empty diff and no `--audit` → say there is
   nothing to sync and stop.
3. **Spawn `doc-keeper`** once, passing: the tree path, the mode (`change-scoped` or `audit`), the
   diff file path or the paths, and the language rule — a tech docs tree is **English**, wiki pages
   are **Italian** and follow `project-wiki-standard`.
4. **Relay the report in Italian**: tree found, files verified / updated / created / removed, what
   awaits approval (experience-derived entries), gaps and hand-offs. Paths and `file:line` verbatim.
5. **Offer, do not act.** Experience-derived entries stay pending until the user approves them;
   then re-spawn the agent with the approval.

## Guardrails

**Never**: touch source or configuration, create a docs tree, commit, push, or publish a wiki page.

- The agent writes only inside the docs tree it found; anything outside is a hand-off in the report.
- A claim the agent could not verify against the code is reported as such, never written as fact.
