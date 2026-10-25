# Frontmatter and the listing budget

## Frontmatter that changes cost or behaviour

| Field | Effect | Rule |
| --- | --- | --- |
| `disable-model-invocation: true` | not listed (0 bytes per turn); only `/<name>` loads it | every skill that posts, writes or logs; behaviour has varied across builds → keep a `/<name>` eval |
| `context: fork` + `agent:` | runs in a subagent with **no history**: the body and the arguments only | the body restates every input it needs; `background: false` (a backgrounded fork arrives as a notification and loses `Agent`) |
| `model:` | non-fork skill: full prompt-cache miss that turn · fork skill: the subagent's model | fork skills only |
| `effort:` | cache-safe | when the job needs it |
| `paths:` | hides the skill until a matching file is read, then lists it (smoke test passed) | file-type skills only; one needed before any file is read (`plan-work`, `skill-forge`) has none |
| `argument-hint`, `allowed-tools` | autocomplete hint; pre-approved tools | user-invoked skills |

Agent frontmatter (`tools`, `model`, `memory`, `maxTurns`, `omitClaudeMd`): `references/asset-templates.md`.

## The listing budget

Listed descriptions (agents, and skills with neither `disable-model-invocation` nor `paths:`) are paid every turn of every session; the validator reports listed vs hidden. Budget: ~1 % of the context
window in characters (~8 k on a 200 k model), 1,536 characters per description; on overflow the
least-invoked descriptions drop **silently**. Measure with `/doctor` (listing cost), `/skill-doctor`
(never-invoked skills) and `/usage` (per-asset attribution). A skill nobody triggers has a
description bug, not a body bug: `references/description-craft.md`.

Byte caps (validator): `CLAUDE.md` 2,750 B · an output style 2,500 B · a `SKILL.md` 7,000 B.
