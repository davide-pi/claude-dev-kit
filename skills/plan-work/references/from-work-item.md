# From a work item — tag every statement, then judge readiness

Reading the item — description, criteria, attachments, discussion, parent, links — is `/item`'s
job; this page starts from what it printed. Two rules decide everything here: every statement in
the plan is **tagged**, and a **readiness verdict** comes before any task list.

**Language.** The verdict line, the questions and the split proposal go to the owner, in
**Italian**. The plan file stays English (`plan-work`). Markers never change: `[S]` `[D]` `[A]`,
the verdict keywords, `[BLOCKING]` / `[non-blocking]`, `file:line`, Azure DevOps type and state names.

## 1. Read before judging

| Source | Settles | Never settles |
| --- | --- | --- |
| Title and description | intent, the team's vocabulary | anything verifiable |
| Acceptance criteria | done or not done — quote them verbatim; a paraphrased criterion is a changed one | how, or where |
| Discussion | decisions taken after the item was written — **the newer statement wins**, and the plan says so | which comment won, when it contradicts the criteria (that is a question) |
| Type | the **role** (`azdo-cli` maps it); a type you cannot map is a question, never a guess | — |
| Parent, children, siblings | the scope boundary above and beside; children → it is a container | ordering |
| Linked PRs and commits | a prior attempt, and the shape it chose | why it stalled |

## 2. Tag every statement

| Tag | Means | Requires |
| --- | --- | --- |
| **S** — specified | the item or its discussion says it | a quote, and where it came from |
| **D** — derived | the code says it | a `file:line` |
| **A** — assumed | you are filling a gap | an open question if it changes observable behaviour; otherwise a noted, reversible implementation choice |

The failure mode is an **A** carried into the plan with no question attached. The plausible reading
of a vague sentence is an A, not an S. **D** evidence comes from `investigator`, handed the item's
concrete nouns (endpoint, screen, message, entity, error text) — never the id; trace mode for a path
that crosses services or the bus. Two touchpoints → two agents in parallel. An absence it reports
("no CSV writer exists") is a finding, often the most important one.

## 3. Readiness verdict — first row that fires wins

| # | Test | Verdict | Route |
| --- | --- | --- | --- |
| 1 | Closed, removed, a live duplicate, or someone else owns it | **not live** | say so and stop |
| 2 | A defect with no reproduction | **not this skill** | `debug-systematic` first |
| 3 | Has children, or is a grouping item | **container** | work a child, or propose a split |
| 4 | No criteria on a role that needs them, or criteria nobody can test without asking you | **not ready** | propose criteria, get them confirmed, re-verdict |
| 5 | An unresolved blocking dependency, or an **A** on observable behaviour | **blocked** | questions first; no editor |
| 6 | Several independent deliverables (split test below) | **needs splitting** | the split proposal → `/workitem-create` |
| 7 | 3+ files with a new interface, or a new module, integration or schema change | **needs a plan** | the plan file, sized by `plan-work` |
| 8 | Otherwise | **implementable** | 3-task plan in chat, the domain skill, `done-check` |

State the verdict in one line before anything else. Rows 4 and 5 are the ones worth defending under
pressure: untestable criteria get argued about at review time instead, which costs more.

## 4. Questions — only those whose answer changes the build

- **At most three**, blocking first. More than three → the item is not ready; say that instead.
- **Closed**, with **your proposal** and **the consequence** — a proposed answer gets a yes, an open
  question gets postponed.
- A question whose either answer produces the same code is noise: decide it, tag it **A**.

```text
1. [BLOCKING] Righe duplicate nell'import: le salto, o rifiuto tutto il file?
   Proposta: saltarle e segnalarle. Conseguenza: cambia il percorso di errore e i criteri del QA.
```

Non-functional silence — volume, latency, retention, visibility — is the gap most often skipped and
most expensive late: "export the report" with no volume is two different implementations.

## 5. Split test

Split when **any** holds: two deliverables could ship on different days and each be useful alone;
they land in different repositories or need different reviewers; the criteria fall into groups with
no overlap; one part is blocked and the other is not. Size alone is **not** a reason: one coherent
change across eight files is one item with a plan. The proposal — role, Italian title, one-line
scope per item, and the parent — goes to `/workitem-create`; nothing here writes to the board.

## 6. In the plan file

The plan's open-questions section carries the questions; each task's "why" cites an **S** or a
**D**; an **Out of scope** line is never empty — an empty one means the boundary was never drawn.
When an answer arrives, update the plan in place, note what changed, and re-run the verdict:
an answered blocking question routinely moves **blocked** to **implementable**.

## Traps

1. The plan contradicts a decision already taken → the discussion was never read → read it first.
2. A grouping item gets a file-level plan → its role was never established → split proposal instead.
3. Twelve "touchpoints" → the search ran in the main thread → `investigator`; a touchpoint is where
   behaviour changes, not every file that mentions the noun.
4. An untestable criterion quietly reworded into a testable one → that rewording is an **A** → ask.
5. Nine open questions → nothing was decided → three, closed, with a proposal each.
