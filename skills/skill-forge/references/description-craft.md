# Writing a description that triggers correctly

The description is the only thing that decides whether a skill loads. The body is irrelevant until
the description has already won. It fails in two directions, and both cost real work:

- **False negative** — the situation is exactly what the skill is for, it never loads, and the work
  is done ad hoc against the conventions the skill exists to hold.
- **False positive** — it fires on a superficially similar request and drags its whole procedure
  into a task that did not want it.

## The shape

Third person, under 1024 characters, and built out of **situations**, not contents:

```text
<What it decides or produces, in one clause.> Use when <situation>, <situation>, <situation> —
including <the phrasing a user actually types>. Covers <the two or three concrete things>.
<For a trigger-only asset:> Trigger: /<name> [args].
```

| Include | Leave out |
|---------|-----------|
| The situations in the user's own words, including the sloppy phrasing | A summary of the sections inside the skill |
| The concrete nouns the user will type: file kinds, tool names, symptoms | Adjectives about quality ("comprehensive", "best-practice") |
| The decisions it makes | The procedure it follows |
| The explicit trigger, when it is trigger-only | Version numbers, organization names |
| What it explicitly is *not* for, when a neighbour skill exists | Anything that only makes sense after reading the body |

## Patterns that cause a false negative

| Pattern | Example of the miss | Fix |
|---------|--------------------|-----|
| Only the technical term, never the symptom | "diagnostics for managed processes" misses "the API is slow" | Add the symptoms as they are said out loud |
| Only the formal noun, never the verb | "migration management" misses "add a column" | Add the actions |
| Assumes the user names the tool | "counters and traces" misses "why is memory growing" | Add the observable effect |
| Too abstract to match anything | "engineering discipline for quality" | Name the artefacts and situations |
| Missing the other language the user types in | An Italian prompt never matches an English-only trigger list | Include the words actually used, when the asset is used in both |

## Patterns that cause a false positive

| Pattern | Example of the misfire | Fix |
|---------|-----------------------|-----|
| A verb so common it appears everywhere | "use when reviewing code" fires on "review this design" | Qualify: what is being reviewed, and what comes out |
| No boundary against a neighbour skill | A debugging skill firing on a performance-tuning request | State the exclusion in the description itself |
| Claiming a whole domain | "everything about testing" fires on "run the tests" | Narrow to the decision it owns |
| An explicit-trigger asset without its trigger | It fires on any similar request and writes somewhere | Name the trigger, and say it is the only entry |

## Trigger-only assets

An asset that posts, writes, creates or logs anything outside the working tree should fire **only**
on its own command. The description must name the trigger literally, and the validator rejects it
otherwise. Phrase it as the last sentence, so it is unambiguous: `Trigger: /<name> [args]` or
`Explicit trigger: only when the user types /<name>`.

## Testing it

Every asset gets a section in the kit's triggering evals with at least one MUST and one MUST NOT
case. Write the cases as prompts, not as descriptions of prompts.

```markdown
### `<name>` — <one-line contract>

| Prompt | Expected |
|--------|----------|
| "<a real sentence that must load it>" | MUST load |
| "<a near-miss that must not>" | MUST NOT (<why the case exists>) |
```

Choosing the cases:

1. One MUST in the user's most natural phrasing, with no keyword from the description.
2. One MUST for the trigger itself, when there is one.
3. One MUST NOT that is superficially similar and belongs to a neighbour asset — this is the case
   that catches over-broad descriptions.
4. One MUST NOT that names the same domain but asks a question rather than requesting the work
   ("how much time did I spend" against "log my hours").

Run them the cheap way first: paste the prompt in a scratch session and see whether the skill's
instructions appear. Use the `skill-creator` plugin's eval runner when reworking a description
rather than spot-checking it.

**A failing case is a description bug.** Fix the description; never adjust the case to match the
behaviour.

## Rewriting an existing description

1. List, from memory or transcripts, the last five times this asset should have fired.
2. Check whether each of those sentences contains any word from the description. Add what is missing.
3. List the two neighbours most likely to be confused with it, and add the exclusion.
4. Cut every clause that describes the body rather than the situation.
5. Re-run the eval cases, including the MUST NOT ones — a broadened description usually breaks
   those first.
