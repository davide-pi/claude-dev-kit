---
name: pr-create
description: >-
  Conventions for opening a Pull Request on GitHub. Use when creating a PR (e.g. `gh pr create`) or
  writing a PR title or description. Requires an English, concise, clear title and description;
  targets the protected `main` branch. Pairs with the `git-branching` skill.
---

# Pull Request Conventions

**Title and description are ALWAYS in English**, concise and clear — regardless of the language used
in chat.

## Title

- A one-line **imperative** summary.
- **No trailing period.**
- Example: `Add Netlify MCP and prune old deploys`

## Description

- **Short but complete**: what changed and why, as a few bullet points.
- Include **only what a reviewer needs** — never pad to fill a template.

## Target

- The PR always targets **`main`** (the protected branch).

## Procedure

1. Ensure the branch is pushed:

   ```bash
   git push -u origin <branch>
   ```

2. Open the PR (pass the body via a file or heredoc to preserve formatting):

   ```bash
   gh pr create --base main --title "<title>" --body "<body>"
   ```

3. **Report the PR URL** back to the user.

## When Claude opens the PR

End the body with the trailer line:

```
🤖 Opened with [Claude Code](https://claude.com/claude-code)
```

See the **`git-branching`** skill for branch naming and the merge gates (CI green + one approval,
squash and merge, delete after merge).
