# Sufficiency and the market pass — phases 2 and 3

The verdict decides whether a number is honest. The checklist below **seeds** it; the final level
is a judgement on top, and the report says in one line why the judgement moved the checklist's
level up or down.

## 1. Who wrote the request

The request comes from a **PO, not a developer**: it speaks of users, screens and business rules,
not of tables, contracts or volumes. Judge it for what a PO can know. A technical detail the PO
did not give is **not a gap in the request** — it is the developer's job, filled from the code or
written down as an assumption.

## 2. The code at hand — check it first

Whether code already exists changes the verdict more than any line of the request. When a
repository for the request is reachable (the working directory, or one the user names), send an
`Explore` subagent (`model: sonnet`, concise report) to answer three questions:

| Question | Weighs as |
| --- | --- |
| Does the module, screen or service the request touches exist? | existing → the technical half is already known |
| Is there a feature of the same shape to copy (another export, another CRUD, another integration)? | yes → a strong reason to raise the level |
| Are the external systems the request names already integrated? | yes → their contract is known; no → the main technical unknown |

No repository (a new project) → the technical half rests on the request and on assumptions; say so.

## 3. The starting checklist — functional points only

Score each point **present**, **partial** or **absent**, reading the PO's words generously: a
sentence in business language counts as present.

| # | Point | Present looks like (PO language is enough) |
| --- | --- | --- |
| 1 | Goal | what it is for, who asked for it |
| 2 | Users | who uses it |
| 3 | What it does | the main path, even in a few sentences or an example |
| 4 | Data in business terms | what it shows, takes in or produces ("gli ordini del cliente con stato e totale") |
| 5 | Where it lives | which app, screen, menu or existing process it extends |
| 6 | When it is done | an example, a rule or a criterion — `Dato che / Quando / Allora` not required |
| 7 | Boundaries | what it does not do, when it matters for the size |

**Never asked of the PO** — resolved from the code, or listed as **assunzioni tecniche** in the
report: schemas and fields, API contracts, volumes and performance, auth mechanics, stack, deploy.
They lower the level only when an assumption could **change the size by more than the margin**
(an external system nobody has integrated, with unknown access).

## 4. From checklist and code to level

| Request | Code at hand | Seed level |
| --- | --- | --- |
| Points 3 and 5 present, the rest at most partial | existing, with a feature of the same shape | **Sufficiente** |
| Points 3 and 5 present, the rest at most partial | existing, nothing of the same shape | **Sufficiente**, or **Scarso** if the new part is large |
| Points 3 and 5 present | none (new project) | **Scarso**, **Sufficiente** only with most points present |
| Point 3 or 5 partial | existing | **Scarso** |
| Point 3 absent — what it should do is unclear | any | **Insufficiente** |

Then judge. Typical moves:

| Move | Example |
| --- | --- |
| Up | two lines from the PO, but the code has the same feature for another entity |
| Up | the missing points cannot change the size (the label of a button) |
| Down | an external system to integrate that the code has never touched, access unknown |
| Down | the request is long, but its flows contradict each other |

## 5. What each level produces

| Level | Output beyond the verdict |
| --- | --- |
| Every level with a number | the **assunzioni tecniche** made in place of the PO, one line each, and what the code check found |
| Sufficiente | the estimate; nothing else required |
| Scarso | the estimate at +30/+40%; the **missing points** list, each with how it could move the number; one line suggesting the market pass |
| Insufficiente | **no hours**. An order of magnitude only (`giorni`, `settimane`, `mesi`), stated as such. The questions for the PO; one line suggesting the market pass |

## 6. Questions for the PO

- **Functional only, in the PO's language**: what, who, where, when it is done. A technical doubt
  is never put to the PO — it becomes an assumption in the report, or a question for whoever owns
  the code, marked as such.
- Ranked by **how much uncertainty each answer removes**, largest first.
- Closed when possible: "L'export serve in CSV, Excel o entrambi?" beats "Che export serve?".
- Each question says what it unblocks: `→ sblocca: integrazione pagamenti (stima ±2 settimane)`.
- At most 10; past that, group by topic and say so.

## 7. The market pass — only on request

Starts only when the invocation asks for it. When the level is scarso or insufficiente, the report
**suggests** it in one line and stops there.

| Step | Rule |
| --- | --- |
| Search | web search for products or open-source projects doing the same job; 3-6 references, each named with its link |
| Extract | the features they share — that is the implicit scope users will expect |
| Compare | each shared feature: **in the request** / **missing** / **explicitly out** |
| Output | a checklist, Italian, in the report; missing features become questions for the PO |
| Never | hours, prices or effort taken from the market — the market widens the scope, the board sizes it |

A missing feature the user then accepts into scope is a **new component** for the decomposition,
estimated like any other.
