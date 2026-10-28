---
paths: "**/.claude/skills/**,**/.claude/agents/**,**/.claude/hooks/**,**/claude-dev-kit*/**"
---
# Kit assets — the facts every edit needs

- Rules: frontmatter `paths: "glob1,glob2"`, one comma-separated string (a YAML list is ignored).
- An asset says which output language to produce.
- Public repo: no org, project, email, machine path or token — placeholders (`<org>`); real values
  live in local-only files (`workspaces.json`, `db-targets.json`).
- No version numbers in prose: say how to detect the version.
- Before calling an asset done: `node tools/validate.mjs` and `node --test tools/*.test.mjs`.

Shapes, skeleton, caps, description and the finish checklist: skill `skill-forge` § 2.
