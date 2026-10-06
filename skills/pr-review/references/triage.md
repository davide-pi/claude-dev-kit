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
- A PR with **no linked work item**, or one linked only to a Task: the intent is missing, so say what
  that makes unjudgeable — completeness above all.

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

## Second passes — incremental

A PR that already carries `[Claude AI Review]` comments is reviewed **incrementally**:

1. **Find the last reviewed commit.**
   - GitHub: the `commit_id` of the latest review whose comments carry the tag
     (`gh api repos/{owner}/{repo}/pulls/<n>/reviews`).
   - Azure DevOps: threads posted through the REST invoke carry no iteration context, so take the
     latest tagged thread's `publishedDate`, list the PR iterations (`azdo-cli`), and use the
     `sourceRefCommit` of the newest iteration created before that date.
   - Not found → full review, and say so in chat.
2. **Diff only `<last-reviewed>..<head>`** — but agents still read enclosing functions from the
   tree, and a change that touches a previously reviewed function is in scope.
3. **Pass the previous findings** (package item 5). Fixed by a new commit, or thread resolved **with
   a fix** → `done`; still present → `todo` on the same anchor. A thread closed as by-design /
   won't-fix is **not** `done`: drop the finding and say so in one line under "Posted vs chat".
4. **Never post a duplicate**: a `todo` that matches an open tagged thread stays in chat; if the
   author's answer opens a new doubt, reply in that thread.

## Acting on a finding — the verification ladder

Applies to every finding acted on, from this review, `/code-review` or an author's reply on a
thread. There is no second human reviewer: nobody else will catch an unverified fix. Never
implement a finding before step 3; never reject one before step 3 either.

| Step | Do | Outcome |
| --- | --- | --- |
| 1 | Open the cited `file:line`, read the enclosing method | anchor wrong or stale → find the real location, or drop it |
| 2 | Restate the failure as a concrete scenario: this input, this state, this result | cannot be stated concretely → style opinion, not a defect |
| 3 | Test the premise: a failing test, a probe, the API contract in the docs plugin, the compiler | premise false → reject with the evidence; true → it is real |

| After step 3 | Response |
| --- | --- |
| real, in scope | fix it, plus the regression test that proves it (`dotnet-testing`) |
| real, out of scope | record it as a work item and say so; do not widen the change |
| real only under a state the code prevents upstream | reject, naming the guarantee and its `file:line` |
| premise false (API, framework, language do not behave as claimed) | reject with the doc or the passing probe |
| cannot be decided from the diff | ask the one question that settles it; leave the thread open |
| taste, no failure behind it | decline, or fold into a separate cleanup |

The checks that settle the recurring false positives in one minute each:

| Claim | Check |
| --- | --- |
| "can be null" | the declaration and every caller — is the state reachable? |
| "missing validation" | the filter, middleware or validator class the reviewer never opened |
| "SQL injection" | parameterized, or user input interpolated? |
| "not thread-safe" | the DI lifetime, and whether anything static holds it |
| "N+1" | the SQL in the command log, not the LINQ |
| "use the newer API" / "this method does not exist" | compile it, then the docs plugin; the project files decide the version |
| "breaks existing behaviour" | the acceptance criteria — the change may be the point |
| a claim about a file not in the diff | open it: an unopened file makes the claim a hypothesis |

A rejection is written in Italian and is checkable: **the false premise**, **the evidence**
(`file:line` or the doc), **what would change my mind**. "That cannot happen" with no location is
an opinion. Agreement is a conclusion, not a courtesy: no "hai ragione" before step 3.

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
