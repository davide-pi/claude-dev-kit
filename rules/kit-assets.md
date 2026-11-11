---
paths: "**/.claude/**,**/skills/*/SKILL.md,**/skills/*/references/*.md,**/agents/*.md,**/rules/*.md,**/output-styles/*.md,**/workflows/*.js,**/hooks/*.js,**/hooks/lib/*.js"
---
# Kit assets — the facts every edit needs

- Rules: frontmatter `paths: "glob1,glob2"`, one comma-separated string (a YAML list is ignored).
- Prose the model reads is English with readable contractions (`don't`, `it's`); each asset states the
  language of the output it produces.
- Public repo: no org, project, email, machine path or token — placeholders (`<org>`); real values
  live in local-only files (`workspaces.json`, `db-targets.json`).
- No version numbers in prose: say how to detect the version.
- Before calling an asset done: `node tools/validate.mjs` and `node --test tools/*.test.mjs`.

Shapes, skeleton, caps, description and the finish checklist: Read `~/.claude/skills/skill-forge/SKILL.md` § 2.
