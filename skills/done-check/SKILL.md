---
name: done-check
description: The completion gate. Requires evidence — a command that was run and output that was read — before any claim that work is done, fixed, passing or deployed, and defines what done means per change type: backend, frontend, database or migration, bugfix, config and infrastructure. Use before saying a task is complete, before committing, pushing or opening a pull request, before transitioning a work item, whenever a build, test or fix is about to be described as passing, and when verification turns out to be impossible.
---

# done-check — evidence before the claim

Working alone means there is no second human reviewer, ever. This gate is the review: whatever it
misses, nothing catches.

## When

- About to say done, fixed, working, passing or deployed.
- Before a commit, a push, a pull request, or transitioning a work item.
- After a change that "obviously" works — those are exactly the ones that do not.
- Reporting results to the user, or reporting up from a subagent.
- Ticking off a `verify` line in a plan.

Not for: a spike whose code is thrown away (its deliverable is the answer, not the code), a
work-in-progress update that makes no claim, or judging code quality — that is `/code-review`, a
different axis.

## Decide

### The rule

Every claim maps to output read **in this session**. Three states exist, and only three:

| State | Wording |
| --- | --- |
| ran it, output confirms | `done — dotnet test …: Failed: 0, Passed: 42` |
| ran it, output does not confirm | not done; go fix it, and say nothing yet |
| did not run it | `**not verified**: <what>, because <why>. Verify with: <command>.` |

There is no fourth state. "Should work", "looks correct", "the change is straightforward" and "the
logic is sound" are the third state wearing the first state's clothes. A test never passes because
it was written carefully; it passes when a runner says so.

### Definition of done per change type

Applies to the whole change, not to the last file touched. Pick the row, or rows, that fit.

| Change | Evidence required before "done" | The output must show |
| --- | --- | --- |
| **backend** | `dotnet build <proj> -warnaserror`, then `dotnet test <test proj>` on every touched test project | 0 errors and 0 warnings; `Failed: 0`; the new or changed test **named** in the run |
| **frontend** | `npm run build` (Angular: `npx ng build`), `npm test -- --watch=false`, and the changed screen opened in a real browser | build with 0 errors; the spec passing by name; console clean of new errors, plus a screenshot of the changed state |
| **database / migration** | `dotnet ef migrations script --idempotent -o <file>` **read** before applying, `dotnet ef database update` on a local database, then `sqlcmd -S <server> -d <db> -Q "<read-back query>"` | the script contains no unintended `DROP`, `ALTER COLUMN` or data rewrite; update succeeded; the query returns the new shape and the existing rows |
| **bugfix** | the symptom reproduced **before** the fix, a test that fails before and passes after, then the full suite of the touched projects | two separate runs seen: red with the exact symptom, then green; `Failed: 0` on the suite |
| **config / infra** | apply, then read the state back from the target: `docker compose config` and `docker compose ps`, `kubectl get`/`describe`, `az <group> show` | the **running** target reflects the change — the file saying so is not evidence |
| **every change** | `git diff --stat` and a skim of the diff | no stray file, no leftover debug code, no secret or connection string, no commented-out block |

Nothing on this table is satisfied by a subagent's word: a delegated report is a claim, and its
evidence lines get re-run for anything that matters.

### When verification is genuinely impossible

Impossible means: the environment does not exist locally, the path needs production data or a third
party, the check is a human eye on a design, or the failure only appears under load. Then:

1. Name the unverified claim in the third-state wording above — never let impossibility quietly
   upgrade to "done".
2. Run the **cheapest proxy** that does exist and report it as the proxy it is: a unit test over the
   pure part, `docker compose config` instead of a deploy, the generated SQL read instead of applied.
3. Write the gap where it survives the session: the pull request description, or the plan's
   verification section. An unverified claim that lives only in chat is lost by the next session.

## Do

```powershell
# backend, one pass
dotnet build .\src\Ordering\Ordering.csproj -warnaserror
dotnet test .\tests\Ordering.Tests\Ordering.Tests.csproj --logger "console;verbosity=normal"

# migration, without applying anything blind
dotnet ef migrations script --idempotent --project .\src\Data --startup-project .\src\Api -o .\migration.sql
Select-String -Path .\migration.sql -Pattern 'DROP |ALTER COLUMN |TRUNCATE '   # read every hit
dotnet ef database update --project .\src\Data --startup-project .\src\Api
sqlcmd -S localhost -d AppDb -Q "SELECT TOP 5 * FROM dbo.Orders" -W

# frontend
npm run build; npm test -- --watch=false

# every change
git diff --stat; git diff
```

Report the claim and its evidence on the same line — the command, and the line of output that
settles it. Quote the output; do not paraphrase it.

## Traps

1. "Tests pass" with no runner output → the tests were written, not run → paste the summary line, or
   the claim does not exist.
2. Green suite, wrong test → the new test was never selected by the filter → check the test count
   changed, and that the name appears in the output.
3. A bugfix with no red state → the fix went in before the reproduction → without a failing run
   first, there is no proof the fix fixed *this* bug.
4. Build clean but stale → the project built was not the one edited → build the solution, or the
   exact project holding the edited file.
5. Migration applied before reading its SQL → `database update` is quick → the destructive statement
   is only visible in the script; read it first, always.
6. Infra "done" from the yaml → the file was edited, the cluster was not → read the state back from
   the target.
7. A delegated agent reports success → its report reads confidently → re-run the evidence commands
   for anything that matters; a report is a claim, not an observation.
8. The unverified part goes unmentioned → the verified part felt like the whole → list what was not
   verified before listing what was.

## References

- `references/evidence-by-stack.md` — the exact command and the exact output line per stack (.NET,
  node and Angular, SQL Server and EF Core, docker and Kubernetes, HTTP endpoints, browser); read it
  when the row above needs the concrete invocation, or when a tool is missing locally.
