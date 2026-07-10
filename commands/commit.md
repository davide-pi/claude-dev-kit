---
description: Commit current changes with a concise, generated message — on the current, a specific, or a new branch.
argument-hint: "[branch] | -b [new-branch] | -m \"message\""
---

Create a git commit from the current changes. Parse "$ARGUMENTS" to decide the **target branch** and
whether the **message** is overridden; otherwise generate the message from the diff.

## Argument grammar

- **(empty)** → commit on the **current** branch.
- **`<name>`** (bare word) → commit on the **existing** branch `<name>`. If it does **not** exist, STOP
  and tell the user to use `-b <name>` to create it (guards against typos silently forking).
- **`-b [name]`** → **create a new** branch from the current `HEAD` and commit there. If `name` is
  omitted, generate a short kebab-case name from the commit summary (e.g. `docs/wiki-split`).
- **`-m "message"`** → use this exact message instead of generating one. Combinable with the above.

## Steps (run in order)

1. **Inspect** — `git status --short` and `git diff --stat` (plus `git diff` as needed) to see what
   changed and to craft the message. If there is **nothing to commit**, stop and say so.
2. **Staging** — if anything is **already staged**, commit **only** the staged changes (respect the
   user's intent). Otherwise stage everything pending, including new files (`git add -A`). Always list
   the files that will be included before committing so unrelated work isn't swept in unnoticed.
3. **Target branch:**
   - current → no switch.
   - existing `<name>` → `git switch <name>` (carries the working-tree changes along). If the switch
     fails (conflict), report and stop — don't force.
   - new (`-b`) → `git switch -c <name>`.
   - Note in the report if the target is the repo's **default branch** (`main`/`master`) — i.e. you're
     committing straight to it.
4. **Message** — use `-m` if provided; else generate per the rules below.
5. **Commit** — `git commit -m "<subject>"` (add extra `-m "<body line>"` flags for a body; avoid
   heredocs so it works in both PowerShell and bash). Never use `--no-verify` or skip hooks.
6. **Report** — one block: branch, short hash, files count, and the final message. If a hook failed,
   surface its output and stop — don't retry with hooks disabled.

## Message rules

- One **concise imperative subject** (~50–72 chars): what changed, not how. Match the repo's existing
  commit style (skim `git log --oneline -10` if unsure).
- Reference the concrete area (module / file / feature) — no vague summaries.
- No marketing words (seamlessly, robust, powerful, enhance). No AI/tool footer.
- Add a short body (a few `-m` bullet lines) **only** when the change spans multiple areas or needs a
  non-obvious "why". Otherwise subject-only.

## Guardrails

- Commit only — never `git push`. Pushing is outward-facing; do it only if separately asked.
- Do not amend or rebase existing commits.
- Don't build or run anything; this command just commits.
