---
name: workitem-analyze
description: >-
  Turns an Azure DevOps work item or epic into an attack plan before any code is written: read the
  item with its description, acceptance criteria, attachments, discussion, linked items and parent;
  separate what the item actually specifies from what is being assumed; locate the code it touches;
  list the unknowns as explicit questions; and judge whether the item is implementable as written.
  Produces a short plan saying what changes where, what is out of scope, and which questions must be
  answered first. Use when a work item or epic has been picked up and implementation has not started,
  when an item looks ambiguous, oversized or missing acceptance criteria, or when an estimate or a
  sprint commitment depends on the item being understood.
---

# workitem-analyze — an item becomes an attack plan, before any code

## When

- A work item or an epic has been picked up and no code has been written yet.
- An id arrived with nothing but "do this" — from the board, from `/item`, from a hand-off.
- The item reads ambiguous, oversized, or has acceptance criteria that cannot be tested.
- An estimate or a sprint commitment depends on knowing what the item really involves.
- The item was analysed before, and either it changed or the code turned out different.

Not for: writing or splitting item content (`workitem-create`), the CLI mechanics of reading it
(`azdo-cli`), a bug that already has a reproduction (`debug-systematic`), the full implementation
plan once the item is understood (`plan-work`), reviewing the finished change (`code-review`,
`pr-review`), testing a built feature against its criteria (`items-qa`), logging hours (`worklog`).

## Decide

### 1. Read every source before judging any of it

| Source | What it settles | What it never settles |
| --- | --- | --- |
| Title and description | the intent, and the vocabulary the team uses for it | anything verifiable |
| Acceptance criteria | done or not done | how, and where |
| Attachments and images | the expected UI, the real error, the payload shape | whether they are current |
| Discussion | decisions taken after the item was written — often contradicting the description | which comment won |
| Parent (feature, epic) | why this exists, and the scope boundary above it | this item's own scope |
| Children and related items | what is already carved out, and what someone else owns | ordering, unless stated |
| Linked PRs and commits | prior attempts, and the shape a previous author chose | why it stalled |
| State, area, iteration, tags | whether this is even live work | anything technical |

The discussion is the source most often skipped and most often decisive: a later comment routinely
overrides the description without anyone editing it. When the two disagree, the newer statement
wins and the plan says so explicitly.

### 2. Tag every statement you are about to write down

| Tag | Means | Requires |
| --- | --- | --- |
| **S** — specified | the item or its discussion says it | a quote, and where it came from |
| **D** — derived | the code says it | a `file:line` |
| **A** — assumed | you are filling a gap | an open question, no exceptions |

The failure mode of this whole skill is an **A** carried into the plan without a question attached.
Anything that cannot be tagged is an A, not an S — including the plausible reading of a vague
sentence.

### 3. Implementability verdict — the gate

| Signal | Verdict | Route |
| --- | --- | --- |
| Criteria are testable, touchpoints located, no A on a behaviour | **implementable** | attack plan → the domain skill → `done-check` |
| Implementable, but three or more files need a new interface between them, or a new module, integration or schema change | **needs a plan** | the attack plan, then `plan-work` |
| Several independent deliverables in one item, or an epic with no children to work on | **needs splitting** | the split proposal, then `workitem-create` |
| An A blocks a behaviour: an external contract, an undecided rule, an undefined edge case | **blocked** | questions first; do not open an editor |
| No acceptance criteria, or criteria nobody can verify | **not ready** | propose criteria, get them confirmed, then re-verdict |
| The item is a symptom report with no reproduction | **not this skill** | `debug-systematic` first, re-analyse after |

State the verdict in one line before the plan. A plan without a verdict invites someone to start
coding past a blocking question.

### 4. Locating the code — delegate it

Do not search from the main thread. Spawn `investigator` with the item's own words turned into a
symptom or a feature phrase — an endpoint name, a message, a screen, an entity — because the agent
searches code and the item id means nothing to it. For anything crossing services or a message bus,
`flow-tracer` returns the ordered hop map instead. Both are read-only and return `file:line`, which
is what the **D** tag needs. Run them in parallel when the item has two independent touchpoints.

The point of delegating is that locating the code costs a lot of reading and yields three lines; the
main context keeps the three lines.

### 5. A question is worth asking only if the answer changes what gets built

Order the questions by that, not by how uncertain they feel. A question whose either answer produces
the same code is noise; make the decision yourself, tag it **A**, and note it in the plan. Then, for
each real question, offer the option you would pick — a question with a proposed answer gets
answered, an open one gets postponed. `references/unknowns-and-questions.md` has the shapes.

## Do

```powershell
# 1. The item, with everything attached to it. Field names and flags: azdo-cli.
az boards work-item show --id <id> --expand all -o jsonc
az boards work-item show --id <id> --expand relations `
  --query "relations[].{rel:rel, url:url, name:attributes.name}" -o table

# 2. The parent and the siblings, for the scope boundary above and beside this item.
az boards query -p <project> -o table --wiql `
  "SELECT [System.Id],[System.WorkItemType],[System.Title],[System.State] FROM WorkItems WHERE [System.Parent] = <parent-id>"

# 3. Linked PRs, if any: the relation list above carries them as artifact links.
az repos pr show --id <pr> --query "{title:title, status:status, src:sourceRefName}" -o jsonc
```

The discussion has no read verb in the CLI — reading it is one of the documented gaps, so take the
fallback route in `azdo-cli` for that one step and keep the rest on the CLI. Never analyse an item
without its discussion because reading it was inconvenient.

Then spawn `investigator` for the touchpoints, and write the attack plan from
`references/attack-plan-template.md`. Nothing in this skill writes to Azure DevOps: it never creates
an item, never changes a state, never posts a comment. Proposing a split is a proposal —
`workitem-create` does the creating, after confirmation.

## Traps

1. Code starts before the plan → the item read as obvious → an obvious item with an untagged **A**
   is a guess; the verdict line costs a minute and catches it.
2. The plan contradicts a decision already taken → the discussion was never read → read it first,
   and when it contradicts the description, the newer statement wins and the plan says so.
3. An epic gets a file-level plan → an epic was treated as an item → an epic gets a split proposal,
   never an implementation plan; route to `workitem-create`.
4. The plan lists twelve files → the search was done in the main thread and everything found looked
   relevant → `investigator` returns the touchpoints; a touchpoint is where behaviour changes, not
   every file that mentions the noun.
5. Questions go unanswered → they were asked open, in a list of nine → three questions, each with
   the option you would pick, and the blocking one first.
6. Acceptance criteria are quietly reinterpreted → an untestable criterion was smoothed over into a
   testable one → that reinterpretation is an **A**; surface it as a question instead.
7. The analysis is re-run from scratch after every comment → nothing was written down → the plan is
   a file, not chat; update it and note what changed.
8. Out of scope is left empty → nothing was excluded, so nothing was decided → an empty "out of
   scope" means the boundary was never drawn; the neighbouring items say where it is.

## References

- `references/context-gathering.md` — the read pass in order: which field, which relation and which
  link answers what, and what to extract from an attachment or a linked PR.
- `references/unknowns-and-questions.md` — turning a gap into a question worth someone's time, the
  implementability rubric in detail, and the split test for an oversized item.
- `references/attack-plan-template.md` — the output: the shape, the length, and a worked example.
