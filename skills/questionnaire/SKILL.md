---
name: questionnaire
description: >-
  Use when work waits on facts only someone else holds, a client or a colleague: "prepara le
  domande per il cliente", "questionario", "cosa devo chiedere a".
argument-hint: "[who it goes to and what is needed back, or nothing to use the open questions]"
---

# questionnaire — written questions for the person who holds the answer

**Contract.** One markdown file the owner sends or fills in a meeting · never sends it, never
answers for the recipient, never asks what the code, the board or the logs already say · the
questionnaire in the recipient's language (not stated: the chat language), the report in the chat language.

## When

Not for: a decision the owner can take (`grill-me`), a fact the environment holds (`investigator`),
writing the item itself (`user-story-standard`).

## Decide

Interview the owner about the **send**, never about the subject: the subject is what they lack.

| Needed | Source |
| --- | --- |
| who receives it: role, expertise, what they know | the request, the work item, the thread; missing: ask once |
| what must come back: each decision or fact the work waits on | the plan's open questions, the readiness verdict of `plan-work`; missing: ask once |
| what each answer unblocks | the task or the item the question blocks |

| Rule for a question | Why |
| --- | --- |
| one idea, never compound | a compound question gets half an answer |
| ordered by what it blocks, most first | async gives one pass |
| closed where the options are known, each option named | a click answers it |
| a `Why it matters` line only where the question invites a throwaway answer | context costs the reader time |
| the recipient's terms, no internal name, path or id | they did not read the code |
| answerable from the environment | drop it and find the answer |

Past ~12 questions it is two questionnaires, or a meeting.

## Do

1. Collect the send (table above). Ask the owner one round at most, both points together.
2. Write `questionnaire-<slug>.md` in the working directory with the skeleton below. Never stage it.
3. Report the path, the question count and what each of the first three unblocks.

```markdown
# <Title>

**Purpose:** <the decision that waits on these answers>
**From:** <owner> · **To:** <recipient> · **Answers by:** <date> · **Effort:** <minutes>

## Context
<One paragraph for a reader who was not in the work.>

## How to answer
A partial answer or "I don't know" helps: mark the doubt, don't skip the question.

## <Theme>
### <Question>
_Why it matters: <one line, optional>_
>

## Anything else?
<What we did not ask and should know.>
```

## Traps

1. Questions about the subject put to the owner → they hold the gap, not the answer → ask only the send.
2. A question the repository answers → nobody read first → find it, then drop it.

Idea: the send-not-the-subject interview and the skeleton follow `to-questionnaire` in mattpocock/skills (MIT).
