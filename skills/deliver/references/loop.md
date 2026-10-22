# Loop — launching `impl-review-loop`, and what to do with its answer

## The start point (before the first edit of the change, yours or the implementer's)

```powershell
git rev-parse HEAD                    # start.head
git rev-parse --show-toplevel         # repoRoot
git ls-files -m -o --exclude-standard # start.dirty: modified and untracked files, plain paths
git diff --name-only --cached         # start.dirty too: the staged ones
```

`start.dirty` is the union of the two lists, plain paths (not `git status --porcelain`, whose `XY` prefix,
quotes and rename arrows are not paths; the workflow strips them if they come anyway).

A file dirty here is the user's work. The workflow reviews only the files the change touched since this
point and never reverts a dirty file: an edit of the change in one, outside the perimeter, comes back as
"found elsewhere". A perimeter file that is already dirty → ask the user (continue on top of their edit,
or change the perimeter); on a yes, relaunch with `dirtyConfirmed: true`.

## Args

`Workflow` with `name: impl-review-loop` and

`{ brief, perimeter: { files, behaviour, exclusions }, repoRoot, start: { head, dirty }, size, implementerEffort, verify, stackSkill, touches }`

| Arg | Rule |
| --- | --- |
| `perimeter.files` | repo-relative paths, `dir/` or globs: the same entries as the perimeter file |
| `size` | `S`, `M` or `L` from the triage: it picks the reviewers |
| `implementerEffort` | `high` only when the brief asks; default `medium` |
| `touches` | `security`, `performance`: L only, adds the specialist reviewers |

## Size S: the session edits, the loop reviews

Edit inline (a few lines in one file; larger → `implementer`), then launch with
`inline: true, changed: [the files you edited]`. No implementer runs first; a finding is fixed by
`implementer` inside the loop, and the verdict stays short.

## STALL

`status: STALL` carries `stall.round` and `stall.findings` (or `stall.reason` when an agent returned
nothing), plus `resume`. Show the finding, ask: **accept the risk and note it · one more round · change
the approach**. Relaunch with `resumeFromRunId`, the same args, and **every** resolution so far, one per
stalled round:

`resolutions: [{ round, accept?: [ids], guidance?: "...", retry?: true }]`

`accept` takes the risk (it goes in the verdict), `retry: true` is one more round with no direction,
`guidance` is one more round with the user's direction. A missing reviewer verdict is not a stall at first: the
workflow asks again, only that id, and lists the gap under `gaps`; two rounds in a row without a verdict on the
same id is a stall (`why: "no-verdict"`), handled like any other.

If a resume replays a cached null implementer result (`stall.reason` says the implementer returned nothing),
relaunch WITHOUT `resumeFromRunId`.

## A red test after OK

The loop returned `OK`, then a matrix test fails. A resume does not apply (no stall to resume), and a
re-`start` taken now would count the change's own edits as the user's dirty files and skip them in review.
Relaunch WITHOUT `resumeFromRunId`, not inline (the implementer must run to fix it; size S too: `inline`
stays false), with:

- the original `start` (head and dirty from before the first edit) and `dirtyConfirmed: true`;
- `brief` = the failing output, then one line per finding already accepted: its id, `path`, title. The
  run starts with empty state and ids restart at `F1`, so the brief is the only memory; reviewers and the
  fixer read it as `Intent`, which stops an accepted finding from being reopened. No old `resolutions`.
