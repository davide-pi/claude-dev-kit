# Writing a description that triggers correctly

The description is the only thing that decides whether an auto skill loads; the body is irrelevant
until it has won. It fails two ways: a **false negative** (the situation fits, the skill never loads,
the work is done against the conventions it holds) and a **false positive** (it fires on a
look-alike request and drags its procedure in).

## The shape

≤ 35 words, third person, a **directive opener** — `Use when …` — then the trigger terms the user
actually types, front-loaded. Never a summary of the body.

```text
Use when <situation>, <situation> or <symptom as typed> — <file types or tool names it owns>.
```

Good: *"Use whenever an EF Core migration is created, applied, reverted or inspected, or an entity,
column or DbContext changes."*

A secondhand activation study (650 trials, unverified) measured directive `Use when …` openers near
100 % activation against ~37 % for passive summaries. Official guidance agrees on the shape: third
person, what + when, key terms first; `name` ≤ 64 characters, description ≤ 1,024 (the listing cuts
at 1,536 with `when_to_use`).

| Include | Leave out |
| --- | --- |
| situations in the user's own words, sloppy phrasing included | a summary of the sections inside |
| concrete nouns: file kinds, tool names, error text, symptoms | quality adjectives ("comprehensive") |
| the decision it owns | the procedure it follows |
| the boundary against a neighbour, when one exists | version numbers, organization names |

## User-invoked skills

`disable-model-invocation: true` keeps the skill out of the listing entirely (it costs nothing per
turn); the description is then read only by the `/` menu and by the validator, which requires the
literal `/<name>`:

```text
Use when the user types /<name> [args] to <what one invocation does>.
```

Any skill that posts, writes, logs or changes State is user-invoked.

## `paths` as the trigger fix

A file-type skill that never fires is the case `paths:` exists for. The kit's smoke test showed a skill
with `paths` is hidden from the listing until a matching file is read, then listed and loadable: it
saves its description's tokens until then — so a skill that must be
visible before any file is read (planning, debugging, the kit itself) carries none. Keep the file
types in the description either way, and the facts every such file needs in a `rules/*.md`.

## Patterns that cause a false negative

| Pattern | Miss | Fix |
| --- | --- | --- |
| only the technical term, never the symptom | "diagnostics for managed processes" misses "the API is slow" | add the symptom as said out loud |
| only the noun, never the verb | "migration management" misses "add a column" | add the actions |
| assumes the user names the tool | "counters and traces" misses "why is memory growing" | add the observable effect |
| too abstract | "engineering discipline for quality" | name artefacts and situations |
| one language only | an Italian prompt never matches an English trigger list | add the words actually typed |

## Patterns that cause a false positive

| Pattern | Misfire | Fix |
| --- | --- | --- |
| a verb that appears everywhere | "when reviewing code" fires on "review this design" | qualify what is reviewed and what comes out |
| no boundary with a neighbour | debugging fires on performance tuning | state the exclusion in the description |
| claiming a whole domain | "everything about testing" fires on "run the tests" | narrow to the decision it owns |

## Testing it

Every skill gets a section in `evals/skill-triggering.md`:

1. one MUST in the user's most natural phrasing, with no keyword from the description;
2. one MUST for `/<name>` on a user-invoked skill;
3. one MUST NOT that looks alike and belongs to a neighbour — it catches over-broad descriptions;
4. one MUST NOT in the same domain that asks a question instead of requesting the work.

Spot-check by pasting the prompt in a scratch session; for a real rework use the `skill-creator`
eval runner, or `claude plugin eval` with a `tool_used: Skill` grader. `claude plugin validate
~/.claude/skills` first: a skill with malformed YAML loads with empty metadata and never fires.

**A failing case is a description bug.** Fix the description, never the case.

## Rewriting an existing description

1. List the last five times it should have fired (transcripts, `/skill-doctor`).
2. Map each to a situation in the description; widen a situation, never add a synonym per miss.
3. Name the two neighbours most likely to be confused with it and add the boundary.
4. Cut every clause that describes the body.
5. Re-run the eval cases, MUST NOT first — a broadened description breaks those.
