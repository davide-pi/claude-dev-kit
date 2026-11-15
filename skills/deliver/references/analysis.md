# Analysis — doubts pass, criteria, planner and challenger, before the loop (M and L)

## Facts first

Before a question reaches the owner, read what the repo already answers: branch, unpushed commits, dirty files
(`git status -sb`, `git log @{u}..`), the code the perimeter names. A question whose answer a command prints is
never asked.

## The plan's tasks

At M and L the analysis ends in tasks, passed to the loop as `plan`; the loop cuts the blocks (up to 4 tasks each) and
computes the size from them. A task is `{ id, title, files, dependsOn, tdd, criteria, mechanical }`: `files` its own files,
`dependsOn` the ids it needs first, `criteria` Given/When/Then lines, `mechanical: true` for a task with no judgment in it (a block whose tasks are all mechanical runs on Haiku at low). An M or L run with no plan is refused (STALL, a question) before any implementer. A task is `tdd` when a unit-test project covers
the code it touches and its behaviour can be written as criteria; layout, config, a migration or a mechanical batch is
not. Pass `unit` (the unit-test command) and `testSkill` too, or no block is test-first. The cut is by count only:
order the tasks so those on the same files are adjacent, and make each atomic (it needs no other task except ones done before it).
A design choice the plan leaves open goes into the loop args as `design` (one line).

**Scout.** One `Explore` agent (Sonnet, medium) only when the analysis would pass about 30 file reads; its summary
replaces them.

## The doubts pass

Between the analysis and the loop, list what the request leaves implicit: requirements, edge cases (empty, first run,
concurrent, failing dependency), ambiguities. Only a doubt whose answer changes behaviour is a question to the user,
batched in one message, each with a recommendation; the brief states the rest as a decision. Every choice the owner
approves, and every choice a reviewer would otherwise ask, becomes a `decisions` line before launch, in the owner's
words, so the run does not stop on a `question`. S has no pass.

**Criteria** (M, L) cover the error path wherever the change has one: a rejection, an empty result, back to the form,
a concurrent run, a dependency down. `preview` is the default at M whenever the change has an owner-visible output.

## The planner (L, or M with a sensitive axis; plain M: this session plans)

At size L, or M with a data, money, contract or security axis, one `Plan` subagent (Opus: `model: opus`, `effort: high`)
writes the tasks: `{ id, title, files, dependsOn, tdd, criteria, mechanical, risky }` with each criterion's proof, from the brief, the
owner's `decisions` verbatim and the code it reads (read-only, it never asks the user, ~12 tool calls). It ends with a
`read:` line of every `file:line` range it read. A task is `risky: true` when it touches a guard, a persisted shape, money, concurrency, a public contract or auth logic, or the planner's unsure; an omitted flag means no block reader A. This session then filters it against the owner's decisions: a task or
criterion that contradicts one is dropped or amended, and the result is the final plan, which this session owns and
passes to the loop. For a guard, parser or hook the planner lists the bypass cases (every way round it: variants, quoting, encodings, order, a second path to the same effect) as numbered criteria, and the `tdd` red tests start from those numbers. The challenger below still attacks that plan: the planner never stands in for it. At plain M this session plans.

## The challenger

When it runs, at every M and L (`SKILL.md` step 2): interpret+doubts, plan (Opus Plan at L or sensitive M, this session at plain M), challenger blind+attack on that plan (Sonnet high, Opus with security or data), owner ok, loop.
A plan-only request stops after the owner ok.
One `Plan` agent, `model: sonnet` (`model: opus` with a security or data axis), always spawned with `effort: high` (it replaces
`grill-me`, which runs only on the rule below or when the owner asks). Read-only, it
never asks the user; budget ~12 tool calls over both messages. One agent, two messages, so it cannot anchor on ours:

1. **Blind** (the spawn): the request verbatim, the perimeter and the owner's `decisions`, nothing of our approach. It
   reads the code they touch and answers, in 3 lines, how it would do it, then stops.
2. **Attack** (`SendMessage` to the same agent; if it cannot be resumed, a second spawn given its 3 blind lines): our
   approach and criteria. It attacks from every angle, each one a row or "none": the premise (the request read wrong,
   the cause elsewhere); a simpler way, or code that already does it; a pre-mortem ("two weeks on it failed: why?");
   the blast radius and the way back; a criterion no test can prove, or one without its error path; a design choice the
   approach settles, checked against the ladder in `~/.claude/skills/principles/SKILL.md` (read it when the approach adds a type, an abstraction or a layer);
   for a guard, parser or hook, the bypass cases: every way round it (variants, quoting, encodings, order, a second path to the same effect), one row each. Each case that holds becomes a numbered criterion, and the `tdd` red tests start from those numbers.
3. **Output**, at most 15 lines: `blind way: equivalent | simpler (why, file:line) | worse`; then one row per objection,
   the heaviest first, `# | Weight | Objection | Evidence | Fix`, weight `blocking` | `minor`, evidence a `file:line`
   it read or the request's words (it drops an objection with neither); then a verdict, a proposal the owner decides:
   `scartare` (redo the analysis) only on a `blocking` premise row, or a blind way that is `simpler` and meets all our
   criteria; `cambiare` (amend the plan) on any other `blocking` row; else `tenere`. A fix that changes an approved
   criterion or the perimeter is `blocking`, never `minor`. Last line: `read: <file:line, …>`, every range it read.

**After the verdict.**

| Verdict | Then |
| --- | --- |
| `cambiare`, `scartare` | a `grill-me` round with the owner on the `blocking` rows only, one question at a time, each with a recommendation; every answer becomes a `decisions` line |
| `tenere` | goes on; each `minor` fix taken becomes a `decisions` line marked `challenger:` (ours, not the owner's) and a line of the message that launches the loop (`challenger: <fix>`): never silent |

The `read:` list goes into the implementer's brief as settled `file:line` facts, so the implementer does not re-explore them.

**The challenger log.** One line per challenger, appended by this session to
`$(git rev-parse --git-dir)/deliver/challenger.jsonl` (never committed; not `findings.jsonl`, whose lines have
another shape): `{ "at", "size", "verdict", "blind", "rows": [{ "weight", "objection", "taken" }] }`, `taken` true
when the fix entered the plan. Counting its `taken` rows tells whether the challenger earns its cost.
