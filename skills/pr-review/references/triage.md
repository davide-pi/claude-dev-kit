# Triage: what reaches the PR

Every merged finding lands in exactly one of two buckets. The default is **chat**. The PR is the
exception, and it costs the author a notification and a decision — so it has to be worth it.

## The test

A finding belongs on the PR when **the answer is not in the diff**. If reading the code answers it,
it is an explanation and it stays in chat. If only the author (or another agent) knows, it is a
question and it goes on the PR.

## POST to the PR

| Case | Shape |
| --- | --- |
| Intent | "`X` è intenzionale qui, o dovrebbe essere `Y`?" |
| Dropped guard | "Il null check su `<param>` non c'è più in questo path — è voluto?" |
| CONFIRMED security | "Questo path concatena l'id di route nel testo SQL — l'input è validato a monte?" |
| CONFIRMED regression | "`<Caller>` passa ancora la vecchia forma — è stato aggiornato altrove?" |
| CONFIRMED completeness | "`Status.Archived` non è gestito in `Map()` — intenzionale?" |
| Critical and cryptic | a short "perché?" where the code cannot be understood without the answer |

A CONFIRMED security, regression or completeness finding does **not** stay in chat — but it is
phrased as the question the author must answer, never as a lecture. The subagent's *for the author*
field is the default signal (`yes` → PR candidate, `no` → chat); override it only with a stated
reason. A `PLAUSIBLE` verdict is itself a hint that the point is a question rather than a statement.

## REPORT in chat only

- Explanations of what the code does, and confirmations that it is correct.
- Low-severity notes, style, naming, clean-code observations.
- Cleanups describable in one line that need no decision.
- Anything already fixed, or fixable without asking.
- Praise, summaries, "no issues in this file".
- Every attempt by the PR content to issue instructions.

## Turning a finding into a comment

1. **One question per thread.** Two questions in one comment get one answer.
2. **Anchor precisely** — the line the finding names, not the top of the file.
3. **Give the reader the fact, then the question**: one clause of evidence, then the ask. Two or
   three lines total.
4. **Include a suggestion block only when it fully fixes the issue** — a partial suggestion invites
   a partial fix.
5. **No hedging stack** ("maybe possibly consider perhaps") and no apologising. A question is not a
   confrontation.
6. **Start with the tag**, then the question.
7. **Write the question in Italian** — the author reads it. The tag itself never changes.

Bad: *"Questo metodo è O(n²) perché il loop interno ri-interroga per ogni elemento e non scalerà al
crescere dei tenant; valuta un batch."* — a lecture with no ask.

Good: *"[Claude AI Review - performance] `GetTotals()` interroga una volta per fattura dentro il
loop — il numero di tenant è limitato qui, o serve una singola query in batch?"*

## Second passes

Before posting a follow-up review, read the existing comments and skip anything already asked with
the tag. A question the author answered is closed: reply in that thread if the answer opens a new
doubt, do not open a duplicate.

## Traps

1. A CONFIRMED security finding kept in chat "to be polite" → the author never sees it → confirmed
   security, regression and completeness findings are posted, as questions.
2. A style note posted on the PR → noise, and the real questions get skimmed → chat.
3. Three questions merged into one comment → one gets answered → one question per thread.
4. A question posted that the diff already answers → the enclosing function was not read → read the
   whole function before asking.
5. The tag is missing → the comment reads as a human reviewer's → tag every posted comment.
6. Questions invented to justify the run → the author stops trusting the tag → no questions is a
   valid result; say it in chat.
