---
description: Retrospective on a coding session — propose changes to the agent's environment (docs, checks, hooks, skills, access) so the next run goes better. Proposes only.
argument-hint: "[session-id | current] [focus]"
---

Look back at a session and propose improvements to the **environment** the agent works in — not to
the code it wrote. The fix for "the agent got it wrong" is almost never "try harder next time"; it is
a pointer, a check, a rule or an access that makes the right move the easy one. Everything the user
reads is **Italian**.

## Argument grammar

Parse "$ARGUMENTS"; both parts optional.

- **session** — *(empty)* or `current` → this conversation. A session id → its transcript, the
  `<id>.jsonl` under the project's folder in `~/.claude/projects/`. Never read a transcript into the
  main context: spawn one `general-purpose` subagent to read it and return the friction events
  below, each with the turn it happened at and the tool call or message that shows it.
- **focus** — one of the categories below; restricts the retro to it.

## Steps

1. **Collect the friction events** from the session: every place it took long to find something,
   a mistake was made and then corrected, the user had to repeat or correct an instruction, a tool
   call was expensive or failed and was retried, a permission prompt interrupted, or a fact was
   missing and had to be asked.
2. **Classify each event** — the class decides where the fix lives:

   | Category | The event | The fix lives in |
   |----------|-----------|------------------|
   | Navigation | many reads to find the right file or fact | a pointer in the project `CLAUDE.md` or its docs tree (`/docs-sync`) |
   | Automated check | a mistake a deterministic check would catch | a hook, a lint rule, a CI step, `tools/validate.mjs` — **before** any written rule |
   | Review rule | the reviewer let a judgement-call mistake through | `code-reviewer` / a repo convention the reviewer reads |
   | Steering bloat | a `CLAUDE.md` section that did not change behaviour, or that a check could enforce | delete it, or move it into the check |
   | No-op | an instruction the model already follows by default | delete the whole sentence |
   | Skill gap | the same decision re-made by hand, or a skill that did not fire | a skill or its description (`skill-forge`) |
   | Tool economy | an expensive or repeated tool call, or a permission prompt | a narrower command, an allow rule (`fewer-permission-prompts`), a script |
   | Information access | a fact the agent could not reach (logs, DB, board, browser) | an MCP server, a read-only CLI, a log tee |

   A **mechanical** violation (a fixed pattern, a banned API, a file-location rule) always gets a
   check, never a sentence. Written rules are for judgement calls only.
3. **Check what exists first.** Before proposing a new check, rule or skill, grep the kit
   (`~/.claude/skills`, `agents`, `hooks`, `CLAUDE.md`) and the repo's own checks: an existing asset
   that did not fire, or a check that sits unwired, *is* the finding.
4. **Report in Italian**, most severe first, in the global `CLAUDE.md` proposal shape — one row each:

   | Proposta | Categoria | Evento (turno) | Dove | Rischio |
   |----------|-----------|----------------|------|---------|

   then one line: how many events were found and how many have no proposal (and why).
5. **Offer, do not act.** One short question: which rows to apply. Applying a kit change then goes
   through `skill-forge` and `branch-flow` like any other edit.

## Guardrails

**Never**: edit a skill, hook, setting or `CLAUDE.md` from this command, and never paste transcript
content containing secrets — redact as `<REDACTED>`.

- A proposal without a friction event behind it is opinion — drop it.
- Prefer deleting to adding: a retro that only grows `CLAUDE.md` makes the next session worse.
