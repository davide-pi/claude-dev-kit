---
paths: "**/.claude/skills/**,**/.claude/agents/**,**/.claude/hooks/**,**/claude-dev-kit*/**"
---
# Kit assets — the contract

- Shapes: skill (`skills/<name>/SKILL.md` + `references/`), agent, hook, rule (`rules/*.md`),
  settings. A user-invoked skill carries `disable-model-invocation: true`.
- Skill skeleton: title, `## When` (+ `Not for:`), `## Decide`, `## Do`, `## Traps`,
  `## References`; caps: SKILL.md 120 lines, reference 200, rule 25, agent body 110; bytes: SKILL.md 7,000,
  output style 2,500, `CLAUDE.md` 2,700.
- Description: opens `Use when`, trigger terms first, third person, short; never a content summary.
- Rules: frontmatter `paths: "glob1,glob2"`, one comma-separated string (a YAML list is ignored);
  facts only, nothing that must survive `/compact`.
- Asset prose in English; it says which output language to produce.
- Public repo: no org, project, email, machine path or token — placeholders (`<org>`); real values
  live in local-only files (`workspaces.json`, `db-targets.json`).
- No version numbers in prose: say how to detect the version.
- Body = the 20 % of paths that cover 80 % of cases; rare branches go to a reference; every section
  earns its tokens.
- Before calling an asset done: `node tools/validate.mjs` and `node --test tools/*.test.mjs`, and see
  each new test or hook fail once on a bad input — a check never seen failing proves nothing.

Procedure: skill `skill-forge`.
