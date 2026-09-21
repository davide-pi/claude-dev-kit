---
name: workitem-analyze
description: >-
  Turns an Azure DevOps work item or epic into an attack plan before any code is written: read the
  item with its description, acceptance criteria, attachments, discussion, linked items and
  parent; recognise which role its work item type plays instead of expecting a name, custom types
  included; separate what the item actually specifies from what is being assumed; locate the code;
  list the unknowns as explicit questions; and judge whether the item is implementable as written.
  Produces a short plan saying what changes where, what is out of scope, and which questions must be
  answered first. Use when a work item or epic has been picked up and implementation has not started,
  when an item looks ambiguous, oversized or missing acceptance criteria, or when an estimate or a
  sprint commitment depends on the item being understood.
---

# workitem-analyze — an item becomes an attack plan, before any code

**Language.** This skill's instructions are English; everything it hands the owner — the attack plan
file, the verdict line, the questions and the chat report — is **Italian**. Markers stay as written,
in the Italian plan too: the **S** / **D** / **A** tags, the verdict keywords, `[BLOCKING]` /
`[non-blocking]`, `file:line`, and Azure DevOps field, type and role names.

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
| The work item type | which **role** the item plays, hence what its body should even contain | the role of a type you do not recognise |
| The parent above it | why this exists, and the scope boundary above it | this item's own scope |
| Children and related items | what is already carved out, and what someone else owns | ordering, unless stated |
| Linked PRs and commits | prior attempts, and the shape a previous author chose | why it stalled |
| State, area, iteration, tags | whether this is even live work | anything technical |

The discussion is the source most often skipped and most often decisive: a later comment routinely
overrides the description without anyone editing it. When the two disagree, the newer statement
wins and the plan says so explicitly.

**Recognise the role, never expect a type name.** The type on the item is whatever the project's
process calls it, custom types included, so map it to its role — backlog item, defect, analysis,
technical activity, grouping, unit of time — through `azdo-cli`. A type you cannot map is a
**question for the owner, not a guess**: an analysis item read as a defect gets a fix plan for a
behaviour nobody has agreed yet.

### 2. Tag every statement you are about to write down

| Tag | Means | Requires |
| --- | --- | --- |
| **S** — specified | the item or its discussion says it | a quote, and where it came from |
| **D** — derived | the code says it | a `file:line` |
| **A** — assumed | you are filling a gap | an open question, no exceptions |

The failure mode of this whole skill is an **A** carried into the plan without a question attached.
Anything untaggable is an A, not an S — the plausible reading of a vague sentence included.

### 3. Implementability verdict — the gate

| Signal | Verdict | Route |
| --- | --- | --- |
| Criteria are testable, touchpoints located, no A on a behaviour | **implementable** | attack plan → the domain skill → `done-check` |
| Implementable, but three or more files need a new interface between them, or a new module, integration or schema change | **needs a plan** | the attack plan, then `plan-work` |
| Several independent deliverables in one item, or a grouping item with no children to work on | **needs splitting** | the split proposal, then `workitem-create` |
| An A blocks a behaviour: an external contract, an undecided rule, an undefined edge case | **blocked** | questions first; do not open an editor |
| No acceptance criteria on a role that must have them, or criteria nobody can verify | **not ready** | propose criteria, get them confirmed, then re-verdict |
| A defect with no reproduction, or a type whose role you could not map | **not this skill** | `debug-systematic` first, or ask which role the type plays |

State the verdict in one line before the plan. A plan without a verdict invites someone to start
coding past a blocking question.

### 4. Locating the code — delegate it

Do not search from the main thread. Spawn `investigator` with the item's own words turned into a
symptom or a feature phrase — an endpoint name, a message, a screen, an entity — because the agent
searches code and the item id means nothing to it. Anything crossing services or a message bus goes
to `flow-tracer`, which returns the ordered hop map. Both are read-only and return `file:line`, what
the **D** tag needs; run them in parallel on two independent touchpoints (`context-gathering.md`).

### 5. A question is worth asking only if the answer changes what gets built

Order the questions by that, not by how uncertain they feel. A question whose either answer produces
the same code is noise: decide it yourself, tag it **A**, note it in the plan. For each real
question offer the option you would pick — a proposed answer gets answered, an open question gets
postponed. `references/unknowns-and-questions.md` has the shapes.

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

The discussion has no read verb in the CLI, so take the fallback route in `azdo-cli` for that one
step and keep the rest on the CLI. Never skip it because reading it was inconvenient.

Then spawn `investigator` for the touchpoints, and write the attack plan from
`references/attack-plan-template.md`. Nothing here writes to Azure DevOps: no item created, no state
changed, no comment posted. A split is a proposal — `workitem-create` creates, after confirmation.

## Traps

1. Code starts before the plan → the item read as obvious → an obvious item with an untagged **A**
   is a guess; the verdict line costs a minute and catches it.
2. The plan contradicts a decision already taken → the discussion was never read → read it first,
   and when it contradicts the description, the newer statement wins and the plan says so.
3. A grouping item gets a file-level plan → its role was never established → a grouping item gets a
   split proposal, never an implementation plan; route to `workitem-create`.
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
  link answers what, how to read the type as a role, and why locating code is delegated.
- `references/unknowns-and-questions.md` — turning a gap into a question worth someone's time, the
  implementability rubric in detail, and the split test for an oversized item.
- `references/attack-plan-template.md` — the output: the shape, the length, and a worked example.
