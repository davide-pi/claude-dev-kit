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

### 2. The contract — the only copy (`rules/kit-assets.md` points here)

| Rule | Value | Enforced by |
| --- | --- | --- |
| Folder | `skills/<name>/SKILL.md`, `references/*.md`, scripts beside `SKILL.md` | convention |
| `name` | identical to the folder | validator |
| Description | ≤ 25 words, third person, opens `Use when`, trigger terms first, never a content summary; a user-invoked skill names `/<name>` | validator, review |
| Contract line | first line after the title: `**Contract.** <produces> · <never does> · <output language>` | validator |
| Skeleton | title, contract, `## When`, `## Decide`, `## Do`, `## Traps`, `## References`; `## When` holds `Not for:` (≤ 3 items) and a bullet only for what the description cannot carry (an argument grammar) — never a restatement of the description, already read when the body loads | validator |
| Caps | SKILL.md 120 lines · reference 200, one topic · rule 25 · agent body 110 · bytes: SKILL.md 7,000, agent 8,000 (`code-reviewer` 9,500), output style 2,500, `CLAUDE.md` 2,750 | validator |
| Compaction | an invoked body re-injects capped at ~5 k tokens, cut from the bottom: `## Decide` near the top, nothing load-bearing after `## Do` | review |
| Phrasing | the outcome, where the model already knows how; procedure only where the house way differs; the body is the 20 % of paths that cover 80 % of cases, rare branches go to a reference — every section earns its tokens | review |
| Drop | restated `CLAUDE.md` rules (language, 80/20, change scope), version numbers, Traps restating a Decide row, why-prose a row already carries | review |
| Identity | placeholders (`<org>`, `<project>`) for org, project, address, machine path, token | validator |
| Cross-refs | bare asset names; never a link to a file not yet committed; a hook not yet shipped is named by its bare file name | validator |
| Shadowing | no project `.claude/skills/<name>` reuses a kit skill's name — it replaces the kit skill there | review |

Over a cap, first delete what the model already knows (generic material, restated defaults);
split into a reference only what is house-specific and rare. A thin `## Decide` means the skill is not
needed.

### 3. Frontmatter and the listing budget

`disable-model-invocation` (0 bytes listed) for every skill that posts, writes or logs; `context: fork` +
`agent:` + `background: false` for noisy work (the body restates every input); `model:` on fork skills only;
`paths:` hides a skill until a matching file is read. Budget ~8 k characters listed, 1,536 per description,
overflow drops silently: `references/frontmatter-and-budget.md`.

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

## References

- `references/frontmatter-and-budget.md` — a frontmatter field or the listing budget is in question: effect and rule per field, byte caps.
- `references/asset-templates.md` — writing a new asset: skeletons for auto, user-invoked and fork
  skills, rule, agent, hook; the eval section; the README row; the finish checklist.
- `references/description-craft.md` — a skill misfires or never fires, or a description is being
  written: the shape, false-negative and false-positive patterns, the eval cases.
- `references/writing-for-agents.md` — wording any asset: pointers, completion criteria, leading
  words, positive phrasing, pruning no-ops.
