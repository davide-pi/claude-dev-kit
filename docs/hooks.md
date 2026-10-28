# Hooks — the safety net, by design

The catalogue (each hook, its event and what it does) is the README's "Hooks" table. The rules for writing
one are in `skills/skill-forge/references/asset-templates.md` § Hook. This page explains the choices those
two assume.

## Why a hook, and not a sentence

A rule that a regex or a file check can decide does not belong in `CLAUDE.md`: a sentence is paid on every
turn and still gets forgotten. It becomes, in this order of preference:

| Layer | When | Example |
| --- | --- | --- |
| permission rule (`settings.json`) | a command prefix is enough to decide | `az account set` denied |
| `PreToolUse` hook that asks or denies | the decision needs the arguments, a nested command or a lookup | a PR without `--work-items` (`lib/alm-contract.js`), a raw SQL client aimed at a non-dev host (`lib/sql-target.js`) |
| `PreToolUse` hook that rewrites | the command is right but its output would flood the context | `dotnet test` through the failure filter (`lib/output-filter.js`) |
| nudge (`PostToolUse`) | a judgement the model must make, at the moment it matters | the third inline edit (`edit-nudge.js`), an edit outside the perimeter (`scope-guard.js`) |
| `Stop` gate | a claim checked against the turn's own evidence | `done-claim.js` |

Permission rules and hooks must agree: the deny list carries what a prefix can see, the hook carries the rest.

## Fail open, with two exceptions

A broken hook must never stop work, so every hook exits 0 on an internal error. The exceptions are deliberate:

| Hook | Behaviour | Why |
| --- | --- | --- |
| `guard-shell.js`, `secret-scan.js` | `onFailure: "block"`: a missing or unloadable script blocks the call; a runtime error inside still approves | a guard that silently disappears is worse than a blocked call |
| `worktree-root.js` | fails loudly | a silent failure leaves the session in a worktree that does not exist |

## Cost

- **Node for anything on the tool-call path.** A Node hook starts in about 150 ms, pwsh in about 500 ms.
  pwsh only where a Windows API is needed, behind a node fast path (`edge-cdp.js` probes the port, and only a
  closed port starts `ensure-edge-cdp.ps1`).
- **One process per event.** `nudges.js` is the only entry `settings.json` wires on `PostToolUse` (and on
  `UserPromptSubmit` only when the opt-in `context-nudge.js` is turned on: no node per prompt by default). It
  reads the payload once and runs every nudge for that event in the same process.
- **No network and no model calls.** Hooks read local files. Git state is read from disk where possible, and
  what is expensive is cached under `~/.claude/.cache/` (the session brief, the context snapshot `statusline.js`
  writes for `context-nudge.js`).
- **Command hooks, not prompt hooks.** A prompt hook spends tokens on every firing; it is used only where a
  regex cannot decide.

## Shared state

Hooks cooperate through files, never through each other's code:

| File | Written by | Read by |
| --- | --- | --- |
| `<git dir>/deliver/perimeter.md` | `scripts/perimeter.ps1` | `scope-guard.js`, `done-claim.js`, the cockpit |
| `<git dir>/deliver/findings.jsonl` | `perimeter.ps1 -Close` | `session-brief.js`, `/retro` |
| `~/.claude/.cache/context-<session>.json` | `statusline.js` | `context-nudge.js` |
| `~/.claude/.cache/edits-<session>.json` | `edit-nudge.js` | itself, reset on each prompt |
| `~/.claude/.cache/done-claim.log` | `done-claim.js` | the cockpit, `tools/cost-audit.mjs` |

## Tests

Every Node hook entry point has a dependency-free test in `tools/`; the libraries are tested on their own or
through the hooks that use them. The false positives
matter as much as the true ones: a guard that fires on a comment, a path or a dry run gets switched off.
A new check is seen failing once before it counts.
