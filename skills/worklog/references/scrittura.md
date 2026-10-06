# Discovery, writes and idempotence

CLI first, always: config, auth, org/project resolution, WIQL and the boards and repos verbs belong
to `azdo-cli`. What counts as a real CLI gap — and so may go to the MCP server — is decided only by
`azdo-cli` `mcp-fallback.md`; the recap states which interface wrote what.

## Phase 5 — discovery per topic

Only for **loggable** topics (rounded > 0). For each:

1. **Project.** From the workspace→project mapping in the user instructions, by the path of the
   project the topic came from. Unmapped path, or a topic that could sit on different orgs and
   cannot be derived → **ask**; never guess.
2. **Where the hours go.** WIQL over the user's own items, by branch, area or topic keyword. Two
   outcomes:
   - an **existing Task** to add the hours to, or
   - the **backlog item / parent** under which a new Task is **created**.

   Hours go on **Tasks**, never on backlog items: a topic clearly part of an item with no suitable
   Task gets one. A **management** topic — attributable to no product item — is not searched for:
   its destination is the fixed structure in `ore-gestione.md`.
3. **Hours currently on the Task.** Read completed work. It serves twice: the write is cumulative,
   and the value is **reconciled** with the audit (step 5).
4. **PRs and commits to link** (best effort, confirmed in Table 2):
   - **PR**: the one whose source branch is the topic's branch;
   - **commits on the default branch**: `git -C "<project-path>" log --since=<From> --until=<To+1d> --author=(git config user.email) --oneline`,
     keeping the hashes relevant to the topic.
5. **Reconcile with what is already there.** Compare the hours read at step 3 with the sum of every
   audit entry for that `itemId`. The difference is **hours this skill did not write**: logged by
   hand, from the portal, or by another tool.

   | Situation | Action |
   | --- | --- |
   | item ↔ audit agree | normal idempotence: delta = hours now − hours already written **for this period** |
   | the item has hours the audit does not know | **do not just add.** Table 2 shows `su item Xh (Yh non da worklog)` and **asks**: same work (the estimate **replaces** them, or covers only the difference) or different work (then it really adds)? |
   | the item has more hours than the estimate and the user confirms same work | **delta 0**: the user's hours always beat the transcript estimate. Still write the audit entry, so the day is closed |

   The safe default is **asking**: the estimate comes from a prompt timeline, their hours from them.
   Never inflate a Task because the audit did not know about a manual entry.

No cache between runs: discovery is redone every time, because items, states and PRs change.

## Phase 7 — writes

Spread the topics over **at most 4 parallel sub-agents**, with **disjoint** items: no item touched
by two agents. Four topics or fewer → one agent per topic; otherwise four batches. Each agent applies
the rules below and **reports** item id, hours before and after, links created, state. No agent
writes the audit.

When the agents finish, **the orchestrator** updates the audit **in sequence** — one write at a
time, no race — then **verifies directly** by reading back the created or updated items: hours,
parent, state and links actually present. Only then does it print the recap.

### Write rules

| Rule | Detail |
| --- | --- |
| **Cumulative** hours | read the Task's current value, write `current + delta`. **Never** overwrite. New Task → the delta is the topic's whole hours |
| New Tasks | created as **children** of the backlog item, so they inherit area and iteration. Title and description **in Italian** |
| Assignee | the user, identity resolved **against the organization** at runtime (`azdo-cli`, "Resolving the identity to assign to"); never a hardcoded account, never `git config user.email` |
| State | **never** leave an item `New`: `Active` if work is ongoing (open PR, unpushed commit, awaiting validation), `Closed` if done (PR completed, or commit already on the default branch). A type starting at `New` is corrected right after creation |
| PR link | a **real link** between PR and work item, never a URL in the text: only the real link drives the policies |
| Commit link | no verb for the commit artifact link → hash and URL in the item's description or a comment, and say so |
| First write ever | on an org not touched yet this session: write **one** item, show the result, then continue |

### Idempotent writes

- The audit already has `(periodFrom, periodTo, itemId)` → apply **only the delta**. Delta 0 →
  leave the hours alone; at most add the missing links.
- On success, write or update the entry with: `periodFrom`, `periodTo`, `topic`, `project`,
  `itemId`, `parentId` (if created), `created` (bool), `hoursLogged` (the **total** for that period
  on that item, not the delta), `prs`, `commits`, `ts`.
- `hoursLogged` is the period's total, not the work item's cumulative value: that is what makes the
  delta computable on a re-run.
- The audit is **never pruned**: the entry exists months later, so an old re-run always finds its
  delta. The digest expires, not the audit.

### The closed day

A day is "closed" when **an audit entry covers it** — the only criterion, and the one
`hooks/worklog-pending.js` reads for the session-start reminder and the statusline badge. So:

| Case | Audit entry |
| --- | --- |
| Hours logged | the normal entry, one per item |
| Hours kept on a **sheet**, not a board (roots the `CLAUDE.md` mapping sends to a sheet, exceptions included) | a closing entry with the real hours: `itemId: null`, `hoursLogged: <hours>`, `project: "<root>/<project>"`, `sheet: "<sheet path>"` — without it a sheet-only day can only be closed by lying with a zero |
| The day happened but **nothing is loggable** (tooling only, leave, a fully `internal` day) | a closing entry: `topic: "nulla-da-registrare"`, `itemId: null`, `hoursLogged: 0`, `project: null`, plus `periodFrom`/`periodTo`/`ts` |
| The user postpones ("lo faccio domani") | **nothing**: the day stays pending, which is exactly right |

Without the closing entry a leave-only day stays flagged forever and the reminder becomes noise to
ignore. Ask explicitly before writing it, in Italian: "il <data> non c'è niente da registrare, lo
chiudo a zero?"

## Traps

1. Hours doubled → overwritten, or the delta ignored → read, add, write back.
2. Hours on a backlog item → they go on Tasks → create the child Task.
3. New item left `New` → the type starts there → correct the state right after.
4. Two agents on one item → overlapping batches → disjoint items per agent.
5. Audit corrupted by concurrent writes → the agents wrote it → only the orchestrator, in sequence.
6. PR linked as a URL in the description → it drives nothing → the real link.
7. The recap describes the plan instead of the outcome → nothing was read back → verify first.
