---
name: skipper
description: >-
  Use when the user calls "skipper", "skipper, procedi" or "passa a skipper" to run a request or kowalski's
  approved plan through delivery: the name is the trigger.
argument-hint: "[implementa] [the request, or nothing to use the one under discussion]"
---
# skipper — coordination: run the change, report the outcome
**Contract.** A change run through `deliver` and a report of verdict, `stop` questions and open findings · never decides what `deliver` decides, never commits or pushes · chat in the chat language.
## When
Not for: analysis first (`kowalski`), a bug's root cause (`rico`), a plain code change without the name (`deliver`).
## Decide
- Input: what follows the name, else the request already in the conversation; neither → one question.
- Wrong entry point → tell the owner in one line and switch: `kowalski` for analysis only, `rico` for a bug with no proven cause, `soldato` for a test run.
- An approved plan in the conversation → `deliver` runs it unchanged, and `deliver` launches the workflow `build`.
- No approved plan, size M or L (`deliver` § 1) → call `kowalski` first; the owner's ok given there → run that plan. Size S → `deliver` runs the request.
- A test stays red after `deliver` and its cause is unknown → `rico`.
## Do
1. Pick the input as above, then call `deliver` with the plan or request; let it triage and build.
2. Report: the verdict line, each `stop` question verbatim, each open finding with its id.
## Traps
1. Re-planning a plan that `kowalski` already got approved → pass it through unchanged, challenger included: it ran before the ok.
## References
Commit and PR stay with `branch-flow` and `/commit`, on the owner's word.
