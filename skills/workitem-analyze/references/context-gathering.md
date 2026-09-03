# The read pass — every source, in order, and what to take from each

The whole read costs a handful of commands. Skipping one of them is what makes an analysis wrong,
not the depth of the ones you did run. Flags and gaps are in `azdo-cli`; this file is about what to
extract.

## Order, and why it is this order

| # | Source | Command | Take from it |
| - | --- | --- | --- |
| 1 | The item itself | `az boards work-item show --id <id> --expand all` | type — and therefore role — plus state, title, description, acceptance criteria, area, iteration, tags, assignee |
| 2 | The relation graph | the same call, `--expand relations` | parent, children, related items, attachments, linked commits and PRs |
| 3 | The discussion | the `invoke` route in `azdo-cli`, or the MCP read | decisions taken after the item was written |
| 4 | The parent | `show` on the parent id | the scope boundary above, and the business reason |
| 5 | The siblings | `az boards query` on `[System.Parent] = <parent-id>` | what is already carved out and owned elsewhere |
| 6 | Attachments | the URLs from step 2 | the expected UI, the actual error, the payload shape |
| 7 | Linked PRs and commits | `az repos pr show --id <pr>` | a previous attempt, and the shape it chose |
| 8 | The code | `investigator`, or `flow-tracer` for a cross-service path | the touchpoints, as `file:line` |

Steps 1 to 7 are cheap and the item's own words drive step 8. Doing 8 first means searching for the
wrong noun.

## Reading the item's own fields

| Field | Question it answers | Failure mode |
| --- | --- | --- |
| `System.WorkItemType` | which **role** does this play — grouping, backlog item, defect, analysis, technical activity, unit of time? Map the name through `azdo-cli`, custom types included, and **ask** when it maps to none | a grouping item analysed as a backlog item gets a plan it cannot carry; an analysis item read as a defect gets a fix for a behaviour nobody agreed |
| `System.State` | is this live work at all? | analysing something closed or removed |
| `System.Title` | the team's vocabulary for the thing | the title as a specification — it never is |
| `System.Description` | intent, background, sometimes the design | treating a sketch in it as agreed |
| `Microsoft.VSTS.Common.AcceptanceCriteria` | done or not done | the field does not exist on every type, and some roles never carry criteria at all; they may be inside the description |
| `System.AreaPath` | which component, therefore which repository | assuming the area maps one-to-one to a repo |
| `System.IterationPath` | the time budget implied | — |
| `System.Tags` | a convention the team encodes here (a platform, a release, a gate) | ignoring a tag that changes the flow |
| `System.AssignedTo` | whether someone else already owns it | quietly taking over |

Acceptance criteria are the one field worth quoting verbatim in the plan. Everything else can be
paraphrased; a criterion paraphrased is a criterion changed.

## Reading the relation graph

`--expand relations` returns a `rel` per link. What matters:

| `rel` | Means | Use |
| --- | --- | --- |
| `System.LinkTypes.Hierarchy-Reverse` | the parent | read it — always |
| `System.LinkTypes.Hierarchy-Forward` | a child | children exist → this is a container, not a task |
| `System.LinkTypes.Related` | a related item | check whether it moves the boundary |
| `System.LinkTypes.Dependency-*` | a dependency both ways | a blocking predecessor changes the verdict |
| `System.LinkTypes.Duplicate-*` | a duplicate | stop and confirm which one is live |
| `AttachedFile` | an attachment | fetch it; `attributes.name` is the file name |
| `ArtifactLink` | a commit, a branch, a PR, a build | prior work — read it before proposing a shape |

An item with children is never implemented directly: either work a child, or the item needs
splitting. An item with an unresolved `Dependency-Reverse` is blocked whatever its own text says.

## Attachments are evidence, not decoration

| Attachment | What it settles | What to check |
| --- | --- | --- |
| A UI mock or screenshot | the expected layout, labels, states | whether it matches the current UI — mocks go stale |
| An error screenshot or stack trace | the real failure, with the real message | that it is the same build as today |
| A payload or response sample | the field names and shapes a contract must produce | whether the sample is real or hand-written |
| A spreadsheet of rules | the rule set the criteria only gesture at | rows that contradict the description |

An attachment nobody opened is the commonest source of a rewritten feature. If an attachment cannot
be read, that is an unknown and belongs in the questions — not a thing to work around.

## The discussion is where the item actually got decided

Read it in order and keep only what changes the build:

- A decision — "we agreed to do X instead" — **overrides the description**, and the plan says so and
  names the comment. A description nobody edited is not a retraction.
- A constraint mentioned once — a deadline, a dependency, a customer who must not see a change — is
  as binding as a criterion.
- A previous round of testing or review saying it did not work, and why.
- Everything else — status pings, reassignments, "any update?" — is noise. Do not summarize it.

When two comments conflict, the later one wins. When a comment conflicts with the acceptance
criteria, that is not a resolution — it is a question, because criteria are what QA will test.

## Locating the code — what to hand the agent

Spawn `investigator` (or `flow-tracer` when the path crosses services or a message bus) and give it
the item's concrete nouns, never the item id:

- The endpoint, screen, job or message name the item mentions.
- The entity or table the behaviour is about.
- The exact error text, if there is one.
- The repository or component the area path points at, when you know it.

Ask for what the plan needs and nothing more: the `file:line` where the behaviour is decided today,
and the call sites that would have to change with it. Two independent touchpoints are two agents
launched in parallel, not one agent given two jobs.

What comes back is the **D** evidence. Anything the agent could not find is an unknown — an
absence found by an agent is a real finding, and often the most important one: the item assumes code
that does not exist yet.

## Why locating the code is delegated

Locating the code costs a lot of reading and yields three lines. Spawning `investigator` or
`flow-tracer` keeps the reading out of the main context and brings back only those three lines,
which is exactly what the **D** tag needs.
