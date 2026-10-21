---
name: skill-forge
description: >-
  Use when a kit skill, agent, hook, rule or reference is added, changed, misfires or exceeds its
  cap, or before calling one finished.
---

# skill-forge — the kit's asset contract, as a procedure

**Contract.** Assets that fit the kit contract and pass the validator · never an asset that restates
a plugin, `CLAUDE.md` or another asset · asset prose English, chat with the user Italian.

## When

- A skill, agent, hook, rule or reference is added to the kit or reshaped.
- A skill never fires, fires unasked, or is over its cap.
- The shape is unclear: rule, skill, user-invoked or fork skill, agent, hook, settings.
- An asset is about to be called finished.

Not for: generic authoring machinery and eval runs (`skill-creator` plugin); settings, permissions
and hook registration (`update-config`); a project's own docs (`doc-keeper`).

## Decide

### 1. Shape — decided by *when* the content must be present

| The need | Shape | Confirming test |
| --- | --- | --- |
| A fact or gotcha true of every file of a type | **rule** `rules/<x>.md`, `paths: "a,b"` | ≤ 25 lines; a re-read recovers it after `/compact` |
| A decision re-made the same way | **skill** (auto) | it answers "which way do we do X here?" |
| An action the user starts that posts, writes or logs | **user-invoked skill** (`disable-model-invocation: true`) | firing unasked would write something |
| Noisy work whose value is the conclusion (SQL, logs, browser, CI) | **fork skill** (`context: fork`, `agent:`, `background: false`) | the raw output must never enter the main context |
| Many reads for a short answer, spawned by the model | **agent** with an output contract | the caller needs the summary, not the files |
| Must happen whether or not anyone remembers | **hook** (command type first) | forgetting it once already did damage |
| Depth on one topic, needed by some branches | **reference** in the owning skill | the skill is complete without it |
| A value, a path, a permission | **settings** | nothing to decide |
| A plugin already covers it | **one routing line** | the plugin's skill beats a restatement |

Two shapes for one need is duplication: one asset owns it, the others route to it in one line.

### 2. The contract — normative copy (`rules/kit-assets.md` is its summary)

| Rule | Value | Enforced by |
| --- | --- | --- |
| Folder | `skills/<name>/SKILL.md`, `references/*.md`, scripts beside `SKILL.md` | convention |
| `name` | identical to the folder | validator |
| Description | ≤ 25 words, third person, opens `Use when`, trigger terms first, never a content summary; a user-invoked skill names `/<name>` | validator, review |
| Contract line | first line after the title: `**Contract.** <produces> · <never does> · <output language>` | review |
| Skeleton | title, contract, `## When` (+ `Not for:`, ≤ 3 items), `## Decide`, `## Do`, `## Traps`, `## References` | validator |
| Caps | SKILL.md 120 lines · reference 200, one topic · rule 25 · agent body 110 | validator |
| Compaction | an invoked body re-injects capped at ~5 k tokens, cut from the bottom: `## Decide` near the top, nothing load-bearing after `## Do` | review |
| Phrasing | the outcome, where the model already knows how; procedure only where the house way differs; the body is the 20 % of paths that cover 80 % of cases, rare branches go to a reference — every section earns its tokens | review |
| Drop | restated `CLAUDE.md` rules (language, 80/20, change scope), version numbers, Traps restating a Decide row, why-prose a row already carries | review |
| Identity | placeholders (`<org>`, `<project>`) for org, project, address, machine path, token | validator |
| Cross-refs | bare asset names; never a link to a file not yet committed; a hook not yet shipped is named by its bare file name | validator |
| Shadowing | no project `.claude/skills/<name>` reuses a kit skill's name — it replaces the kit skill there | review |

Over a cap, split into a reference — never trim substance. A thin `## Decide` means the skill is not
needed.

### 3. Frontmatter that changes cost or behaviour

| Field | Effect | Rule |
| --- | --- | --- |
| `disable-model-invocation: true` | not listed (0 bytes per turn); only `/<name>` loads it | every skill that posts, writes or logs; behaviour has varied across builds → keep a `/<name>` eval |
| `context: fork` + `agent:` | runs in a subagent with **no history**: the body and the arguments only | the body restates every input it needs; `background: false` (a backgrounded fork arrives as a notification and loses `Agent`) |
| `model:` | non-fork skill: full prompt-cache miss that turn · fork skill: the subagent's model | fork skills only |
| `effort:` | cache-safe | when the job needs it |
| `paths:` | hides the skill until a matching file is read, then lists it (smoke test passed) | file-type skills only; one needed before any file is read (`plan-work`, `skill-forge`) has none |
| `argument-hint`, `allowed-tools` | autocomplete hint; pre-approved tools | user-invoked skills |

Agent frontmatter (`tools`, `model`, `memory`, `maxTurns`, `omitClaudeMd`): `references/asset-templates.md`.

### 4. The listing budget

Auto-skill and agent descriptions are paid every turn of every session. Budget: ~1 % of the context
window in characters (~8 k on a 200 k model), 1,536 characters per description; on overflow the
least-invoked descriptions drop **silently**. Measure with `/doctor` (listing cost), `/skill-doctor`
(never-invoked skills) and `/usage` (per-asset attribution). A skill nobody triggers has a
description bug, not a body bug: `references/description-craft.md`.

## Do

```powershell
New-Item -ItemType Directory -Path skills/<name>/references -Force      # folder = name
Get-ChildItem -Recurse skills/<name> -Filter *.md |
  ForEach-Object { "{0}`t{1}" -f (Get-Content $_.FullName).Count, $_.Name }   # caps
node tools/validate.mjs                    # in the kit repo, not the installed copy; fix every error
node --test tools/*.test.mjs               # a hook or a lib changed
claude plugin validate ~/.claude/skills    # bad YAML loads with empty metadata and never fires
```

**Finished** = caps held · skeleton and contract line · validator clean · a section in
`evals/skill-triggering.md` (one MUST, one MUST NOT, `/<name>` for a user-invoked skill) · a README
asset row · each new test or hook seen failing once: a check never seen failing proves nothing.

## Traps

1. Never fires → the description summarises contents → rewrite it around situations and the words
   the user types (`references/description-craft.md`).
2. A user-invoked skill fires unasked → the flag is missing or the description lacks `/<name>` →
   add both; the validator checks them.
3. A fork skill asks "which PR?" → it counted on the conversation → restate every input in the body
   and parse the arguments line (`references/asset-templates.md` § Fork skill).
4. A fact needed on every `.cs` edit lives in a skill body → bodies load only on invocation → make
   it a rule; the skill keeps the procedure.
5. A reference nobody opens → no `## References` line names its condition → add the line, or merge
   the file away.
6. A version number in prose → it rots on the next release → say how to detect the version.
7. MCP-first or bash-first instructions → CLI first (`az`, `gh`, `dotnet`, `docker`), the fallback
   stated; PowerShell examples unless bash is genuinely better.

## References

- `references/asset-templates.md` — writing a new asset: skeletons for auto, user-invoked and fork
  skills, rule, agent, hook; the eval section; the README row; the finish checklist.
- `references/description-craft.md` — a skill misfires or never fires, or a description is being
  written: the shape, false-negative and false-positive patterns, the eval cases.
- `references/writing-for-agents.md` — wording any asset: pointers, completion criteria, leading
  words, positive phrasing, pruning no-ops.
