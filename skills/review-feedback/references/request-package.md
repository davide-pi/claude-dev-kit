# The review request package

A reviewer subagent knows the code it reads and nothing else. Everything it cannot derive from the
diff has to be handed to it, or it will guess — and a guessed requirement produces confident,
useless findings.

## The template

Fill every field. "None" is a valid value and is still information.

```text
INTENT
  What this change is supposed to accomplish, in one or two sentences, in the language of the
  domain — not a restatement of the diff.

SOURCE OF TRUTH
  The work item or issue text, verbatim, including the acceptance criteria. If there is none, say
  "no written requirement; intent above is the author's" so the gap shows in the report.

SCOPE
  The diff, produced against the remote target branch. List the files that matter.

OUT OF SCOPE
  Files touched only mechanically (a rename, a formatting pass, a generated file), and areas
  deliberately left alone.

CONSTRAINTS ALREADY DECIDED
  Patterns to keep, dependencies not to add, a legacy shape that cannot change yet, a shortcut
  taken knowingly and why.

UNKNOWNS
  What the author is unsure about. This is where the best findings come from.

FOCUS
  The axis, when there is one: correctness, security, performance, completeness against the
  criteria. Omit for a general pass.

OUTPUT CONTRACT
  Findings only. Never post, never edit, never commit. Per finding: severity, category,
  file:line anchor, the concrete failure scenario, the minimal fix, a CONFIRMED/PLAUSIBLE verdict,
  and whether it is for the author or for the chat.
```

## Building the scope without lying to yourself

```powershell
git fetch origin <target>
git rev-list --left-right --count HEAD...origin/<target>   # confirm the base is current
git diff origin/<target>...HEAD > review-scope.diff
git diff HEAD                                             # uncommitted work, if reviewing early
git log origin/<target>..HEAD --oneline
```

Rules:

1. Diff against `origin/<target>`, never the local branch of the same name.
2. Include uncommitted changes when the review runs before a commit, and say that it does.
3. A diff bigger than a few hundred changed lines gets split by concern, not reviewed in one pass —
   findings degrade sharply with size.
4. Hand over the enclosing method of each hunk, not just the changed lines: a defect in an
   unchanged line of a touched method is in scope.

## Where the intent comes from

| Platform | Command | Note |
|----------|---------|------|
| Azure DevOps | `az boards work-item show --id <id> --query "fields" -o json` | Description plus acceptance criteria; the MCP work-item capability is the fallback |
| GitHub | `gh pr view <n> --json title,body,closingIssuesReferences` then `gh issue view <n> --json title,body` | Also catches `Fixes #n` references in the body |
| Neither | The branch commit messages, plus the author's own statement | Say so explicitly when packaging |

## Fan-out rules

- Run the generalist always. Add a specialist only when the diff actually has that surface.
- Send the specialists in a **single message** so they run in parallel; sequential spawns cost
  wall-clock for no benefit.
- Give every agent the identical package. Differing packages produce findings that cannot be merged.
- Merge before triage: drop a specialist finding the generalist already reported at the same anchor
  for the same defect, keep both when they describe different failures at the same line, and re-sort
  by severity across agents.
- Track which agent produced each surviving finding — the attribution matters when the same defect
  comes back later.

## Reviewing your own work while waiting

The cheapest findings do not need an agent at all:

| Check | Command |
|-------|---------|
| The build is clean, warnings included | `dotnet build --nologo -warnaserror` |
| The tests pass on the change, not on a stale build | `dotnet test --nologo` |
| Formatting is not part of the diff | `dotnet format --verify-no-changes` |
| Nothing debug-only survives | search the diff for temporary logging, commented-out code, a hardcoded id, a skipped test |
| Nothing secret was added | search for a connection string, a token-shaped literal, a real host name |
| The diff matches the intent | re-read the acceptance criteria against the diff, list what is not covered |

Anything found here is a finding you never have to argue with.

## Handing a change to a reviewer that will post

`/pr-review` is the only asset that writes to a PR, and it posts **questions only**. When the goal
is a comment thread rather than a chat report, route there instead of assembling this package by
hand: it already packages the intent, fans out, triages and tags.
