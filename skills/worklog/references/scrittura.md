# Discovery, writes and idempotence

CLI first (`azdo-cli`; an MCP fallback only per its `mcp-fallback.md`, the recap states which interface wrote what); **hours have no fallback**: only `worklog-push.ps1`.

## Phase 5 — discovery per topic

Only for **loggable** rows (rounded > 0). For each:

1. **Project.** The `workspaces.json` root matching the path the topic came from (the map behind
   the `ALM:` session line — a topic's path, not the session's cwd). Unmapped path, or a topic that
   could sit on different orgs and cannot be derived → **ask**; never guess.
2. **Where the hours go.** WIQL over the user's own items, by branch, area or topic keyword. Two
   outcomes:
   - an **existing Task** to add the hours to, or
   - the **backlog item / parent** under which a new Task is **created**.

   Hours go on **Tasks**, never on backlog items: a topic clearly part of an item with no suitable
   Task gets one. A **management** topic — attributable to no product item — is not searched for:
   its destination is the fixed structure in `ore-gestione.md`.
3. **Hours currently on the Task.** Read completed work (a read, outside the push): it is shown in
   Table 2 and **reconciled** with the audit (step 5).
4. **PRs and commits to link** (best effort, confirmed in Table 2):
   - **PR**: the one whose source branch is the topic's branch;
   - **commits on the default branch**: `git -C "<project-path>" log --since=<From> --until=<To+1d> --author=(git config user.email) --oneline`,
     keeping the hashes relevant to the topic.
5. **Reconcile with what is already there.** Compare the hours read at step 3 with the sum of every
   audit entry for that `itemId`. The difference is **hours this skill did not write**: logged by
   hand, from the portal, or by another tool.

   | Situation | Action |
   | --- | --- |
   | item ↔ audit agree | normal idempotence: the push computes delta = row hours − hours already audited **for this period** |
   | the item has hours the audit does not know | **do not just add.** Table 2 shows `su item Xh (Yh non da worklog)` and **asks**: same work (the estimate **replaces** them, or covers only the difference) or different work (then it really adds)? |
   | same work, and their hours cover the estimate | push row with `"delta": 0`: the user's hours beat the transcript estimate; the audit entry is still written, so the day is closed |
   | same work, the estimate is larger | push row with `"delta": <estimate − their hours>` |

No cache between runs: discovery is redone every time.

## Phase 7 — writes

In this order, the orchestrator alone (no parallel writers: the audit is one file):

1. **Create the missing Tasks** (CLI, `azdo-cli`): children of the backlog item (they inherit area and
   iteration), Italian title and description, assignee resolved **against the organization** at
   runtime — never hardcoded, never `git config user.email`. **No hours at creation.**
2. **PR links**: the real PR ↔ work item link, never a URL in the text. Commits: no verb for the
   artifact link → hash and URL in the description or a comment, and say so.
3. **The rows file** — one JSON array, written to the session scratchpad:

   ```json
   [
     { "date": "2026-10-12", "org": "<org>", "project": "<Project>", "itemId": 105060, "hours": 1.5,
       "topic": "import nuovi mercati", "state": "Active", "parentId": 105050, "created": true,
       "prs": [4211], "commits": ["a1b2c3d"] },
     { "date": "2026-10-12", "org": "<org>", "project": "<Project>", "itemId": 105071, "hours": 3,
       "delta": 0, "topic": "verifiche (ore gia' sull'item)" },
     { "date": "2026-10-13", "itemId": null, "hours": 0, "topic": "nulla-da-registrare" },
     { "date": "2026-10-20", "targetHours": 6, "note": "corso 4h + straordinario 2h" }
   ]
   ```

   | Field | Rule |
   | --- | --- |
   | `hours` | the **period's total** on that item — what the audit records, never the delta |
   | `delta` | omit it: the script adds `hours − already audited for (period, item)`; set it only for a reconciled row |
   | `state` | `Active` work ongoing (open PR, unpushed commit, awaiting validation), `Closed`/`Done` finished; never leave `New` |
   | `org` | name or URL; the az identity is the row's `"identity"`, else the `workspaces.json` root of that org whose `project` (or a `projects` value) is the row's project, else the org's first root |
   | `overtime`, `note`, `sheet` | copied into the audit entry as given |

4. **Preview**: `worklog-push.ps1 -Rows <file> -DryRun` — no az call, no write; it prints each row's
   delta against the audit. Show it when it differs from Table 2.
5. **Write**: `worklog-push.ps1 -Rows <file>`. Per hours row: read CompletedWork, write
   `current + delta` (never an overwrite) and the state, read it back, then upsert the audit entry —
   saved after every row. Exit 1 → the failed rows say why; fix and re-run the file: the rows already
   written now have delta 0.
6. **Read back** every created or updated item (hours, parent, state, links) and only then print the
   recap (`tabelle.md`). First write on an org this session → push a file with that one row first.

The audit: key `(periodFrom, periodTo, itemId)`, `hoursLogged` is the period total. Audit fields, and the
closed-day rows (nothing loggable, a reduced day, a sheet): `chiusura.md`.
